# 0135 `data` has a mode; a keyed cell holds members

Date: 2026-11-10. Status: accepted in part; not built.
Accepted: Duke, 2026-11-10 UTC, in three notes:
05:34 (the key), 05:38 (the mode), 08:49 (the member).
Open: order. ADR 0137 closes the two others.
Refined by: 0136 (the reads), 0137 (the wire).
Replaces: `family()` of ADR 0048 (gone with `@tinker/sync`).

## What the user said

- 03:26: "data family is in the data. might be
  consider making it to remote-data, so that'll be
  first-class operation (like Array, like Map etc)".
- 04:37: "keyed, or indexed value", on "both sides",
  to "help with the delta model rather than just
  direct".
- 05:34: "do the same as tanstack query, they sort
  key and serialize object".
- 05:38: "what if we add mode to data, and that's
  it? default to be singular, other might be
  discriminated".
- 08:49: "with composite key, whatever support, we
  go with that".

## Context

A cell holds one value. A list in a cell is one
value too, so each change sends all of it.

```ts
const todos = data({
  label: "todo.list",
  initial: [] as Todo[],
});
// one toggle: remoteData sends every todo
```

Measured on Core 0.16.1, 1,000 todos, one toggle
and one remove:

```text
whole value   123,284 B
per member        105 B
```

A keyed `remoteData` board holds one value per
project. Core does not know that: `remote-data.ts`
keeps its own maps on each side (`held`, `entries`).
It is a family made by hand.

Hedl has 146 cells (commit `d6c84b5`):

- 119 hold one value;
- 10 are a `Record<string, X>`;
- 7 are an array of rows with an id;
- 3 are an array that appends, then cuts;
- 7 are a short list.

## Precedent

- **Tinker rpc.** `mode?: "reply" | "stream"`. No
  mode means `"reply"`. The mode sets the type of
  the answer.
- **Redis.** Each key has a type: string, hash,
  list, sorted set. Each type has its own commands.
  A command on the wrong type is refused.
- **TanStack Query.** A key part can be an object.
  Its fields are sorted, then serialized. A filter
  matches each key that holds its fields.
- **Meteor DDP, TanStack DB.** One collection; a
  message per member: added, changed, removed.
- **Jotai `atomFamily`, ADR 0048.** One cell per
  key. A member stays until someone removes it:
  a leak by default.

Ours is simpler than Redis: two modes, not six.

## Decision

1. `data` takes a `mode`. No mode means `"single"`:
   the cell of today. No call changes.
2. `mode: "keyed"` makes a keyed cell. It takes a
   `key` and a `parse` for one member. It takes no
   `initial`: it starts empty.

   ```ts
   const tasks = data({
     label: "task.items",
     mode: "keyed",
     key: z.object({
       project: z.string(),
       id: z.string(),
     }),
     parse: Task,
   });
   ```

3. A key is a string, or a flat object of strings
   and numbers. Core sorts the fields, then
   serializes. That text names the member. So
   `{ id, project }` and `{ project, id }` are one
   member.
4. A member is an entry in the one cell. It has no
   storage bucket of its own. A delete leaves
   nothing to release.
5. A keyed controller writes one member:

   ```ts
   items.set(key, task);
   items.update(key, (t) => ({ ...t, done: true }));
   items.delete(key);
   ```

6. A keyed cell has three reads:

   ```ts
   tasks                          // all members
   tasks.of({ project, id })      // one member
   tasks.where({ project })       // a part
   ```

   A part names some fields of the key. It matches
   each member whose key holds them.

## Shown to Duke, no word yet

- The names `"single"` (his word: "singular"),
  `of`, and `where`.
- The wire: `remoteData` sends a keyed cell as
  steps on an rpc stream. rpc gets no new mode.

  ```ts
  type Delta<K, V> =
    | { op: "all"; entries: [K, V][] }
    | { op: "set"; key: K; value: V }
    | { op: "delete"; key: K };
  ```

- A later mode `"log"`: append, then cut.

## Proof so far

Scratch runs on Core 0.16.1 as built. No Core change.
They are in the project files, not in this repo.

- A keyed map in one cell, with a step per write:
  the 105 B above.
- An object key with sorted fields: 901 tasks, four
  readers, four writes. A reader of one project got
  2 steps; a reader of one task got 1. A write with
  the fields in the other order made no new member.
  A write looked up 4 parts and read no member.
- The types, with `tsc`: today's calls compile. A
  keyed cell with no `key`, or with `initial`, is
  refused. So is `where` on a field not in the key.

## Open

1. On the server, where a part's members come from:
   the cell holds all, or a `fill` loads a part for
   its first reader. Asked 2026-11-10 08:55.
   Closed by ADR 0137: the client asks for a part.
2. Order, for an "indexed" value: by a field of the
   member, as a Redis sorted set.
3. Reconnect: the full set again, or from a version.
   Closed by ADR 0137: a client that returns asks
   again.

The wire in "Shown to Duke, no word yet" is replaced
by ADR 0137.

## Consequences

- The keyed board of `remoteData` (`config`, session
  tags, `held`, `entries`) has a successor. It stays
  until Hedl's three boards move.
- A value that changes as one piece stays a single
  cell.
- Cost: `parse` and `eq` keep their names, but mean
  one member in a keyed cell.
- Cost: a write copies the map. Rough: 1 ms at
  10,000 members.
