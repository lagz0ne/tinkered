# 0138 A member carries its key; the review answers for keyed data

Date: 2026-11-10. Status: accepted; built; released in 0.17.0.
Accepted: Duke, 2026-11-10 23:49 UTC.
Changes: 0135 decisions 2 and 5 (the key).
Accepts: the drafts of 0135 and 0137.
Closes: 0137 open items 1 and 4.
Leaves open: order (0135 open 2).

## What the user said

- 16:43: "rewrite the artifact @Data family design
  to match with the ADR, put that in stttressed
  detail to get reviewed".
- 23:49: "Agreed with all of recommendations".

The page had 6 drafts (D1 to D6) and 15 points
that were not decided (N1 to N15). Each had one
pick. This record holds the 21 picks.

## Context

ADR 0135 gave the key at the write:

```ts
items.set({ project, id }, task);
```

Then the key and the member can disagree: a task
of project p2 under a key of project p1. An answer
on the wire must carry pairs. A read gives pairs
too.

## Precedent

- **TanStack DB.** `getKey: (row) => row.id`. An
  update that changes the key is refused.
- **Redux Toolkit.** `selectId` of an entity
  adapter.
- **Meteor.** Each document has `_id`.
- **Redis hash.** The field is given at the write.
  It is the form of 0135.

## Decision: the key

1. A keyed cell reads the key from the member.
   `key` is a function. Its answer is a string, or
   a flat object of strings and numbers (0135,
   decision 3).

   ```ts
   const tasks = data({
     label: "task.items",
     mode: "keyed",
     parse: Task,
     key: (t) =>
       ({ project: t.project, id: t.id }),
   });
   ```

2. `set` takes the member. `update` and `delete`
   take the key.

   ```ts
   items.set(task);
   items.update(key, (t) => ({ ...t, done: true }));
   items.delete(key);
   ```

3. A read gives plain members, not pairs.

   ```ts
   tasks.where({ project }) // readonly Task[]
   tasks.of({ project, id }) // Task | undefined
   ```

4. An `update` of a key that is not there is a
   named error. It is not a silent no-op.
5. A number in a key must be finite. `NaN` and
   `Infinity` are refused: JSON writes both as
   `null`. `1` and `"1"` stay two keys, as in
   TanStack Query.
6. The controller has the same `of` and `where`.
   So an op can read one member.

   ```ts
   depends: { items: tasks.controller },
   run: ({ items }, { input }) =>
     items.of(input.key).get(),
   ```

One rule was not on the page. It follows from 1
and from TanStack DB: an `update` whose result has
another key is refused too. Duke has not seen it.

## Decision: the names

7. The names stay: `"single"`, `of`, `where`.
8. `load` is the new name of `fill`.

## Decision: the wire

9. The server sends a signal with no data.
   `invalidate` on the server sends it to each
   reader of the part.

   ```ts
   board.invalidate({ project, id });
   ```

10. The signal names a key or a part. The client
    asks for what it names.

    ```ts
    { dirty: { project, id } } // ask 1 member
    { dirty: { project } }     // ask the part
    ```

11. One key in a pass: one signal for that key.
    More than one key of a reader's part in one
    pass: one signal for the part.
12. A board with no `load` serves its cell. The
    server's cell is the truth. A set marks that
    key dirty.
13. The input type of `load` says which fields a
    part must have. An ask with less is refused
    before the guard.
14. The guard runs at each ask, not only at the
    join.
15. A served keyed cell lives at the root only. No
    session and no namespace keeps a copy. A keyed
    cell that is not served follows the rules of
    a single cell.
16. A part with no reader is dropped at once. A
    reader that comes back asks again.
17. When the store cut its log of notices past the
    projector's place, every part in use is dirty.
    This rule goes in the guide for a projector.
    The retry of a failed pass stays in the app.

## Accepted limits

- A store with no notices: the op calls
  `invalidate` after its commit. Cases 2 and 3 of
  ADR 0137 are open again there. It is accepted
  for a small app. The template's README says so.

  ```ts
  await db.insert(todo).values(row);
  board.invalidate({ id: row.id });
  ```

- The writer's own ask and the signal both arrive:
  two asks for one write. `await invalidate` is
  optional when the server signals. It is for a
  caller that must read its own write.
- One answer holds all members of a part. No limit
  in the first build. Measure in Hedl.
- A server render is out of the first build.

## Not decided

Order, and a read with a limit. Hedl's Tasks panel
reads the newest 50 tasks of a project:

```ts
list.run({ input:
  { project, status: null, limit: 50 } });
```

ADR 0136 does not build an order with a limit. And
the board's value has two more fields:
`{ tasks, engine, lease_minutes }`.

The accepted pick: build k01 to k06 first. Decide
this before k07. Three ways are known:

- the panel shows all open tasks of the project;
- an order option comes first (a member field, as
  a Redis sorted set);
- the tasks board stays a single cell.

## Proof

The model in the project files (plain JavaScript,
not Core). 300 writes in one pass, 5 readers of a
part of 301:

```text
signal        client asks   rows     sent
each key      each member   1,500   208,350 B
the part      the part      1,505   100,000 B
each key      the part    451,500   172,765 B
```

A store that cut its log: a design that sends
steps from the log is stale. Decision 17 keeps
this one fresh.

Decisions 1 to 6 have no run yet. Card k01 proves
them.

## Consequences

- ADR 0135 decision 2 took a schema as `key`. It
  is a function now. The key type comes from the
  function's answer, so `where` on a field that is
  not in the key is still refused by type.
- An answer on the wire is a list of members. The
  client finds each key with the same function.
- `parse` runs before `key` on a member from the
  wire.
- Cost: the guard runs once for each ask.
- Cost: a part that loses its last reader for a
  moment is asked again.
