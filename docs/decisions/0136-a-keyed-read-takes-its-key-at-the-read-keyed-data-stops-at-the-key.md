# 0136 A keyed read takes its key at the read; keyed data stops at the key

Date: 2026-11-10. Status: accepted; built; released in 0.17.0.
Accepted: Duke, 2026-11-10 15:44 UTC.
Refines: 0135 (the reads `of` and `where`).

## What the user said

- 15:28: "The problem with the keyed data is the
  key is dynamic at runtime, how might we actually
  tackle that".
- 15:29: "We technically stepping onto tanstack db
  space".
- 15:44: "yeah, then let's refine that to ADR and
  prepare to roll". This answered two options:
  use TanStack DB in the client, or keep keyed
  data in Core and stop at the key.

## Context

Core declares each unit one time, at module level.
A key is known only when a caller reads.

Today Tinker binds the key in a scope. The board
names a tag. A session binds the tag. The server
writes in a call that carries the tag.

```tsx
remoteData({ report },
  { config: { project: checksProject } });

<SessionProvider key={project}
  options={{ tags: [checksProject(project)] }}>
```

So a session reads one key. Two projects on one
page need two sessions. Each session keeps its own
copy of the cell, because a cell holds one value.

## Precedent

There are three known ways to give a runtime key
to a thing that is declared one time.

- **A unit per key.** Jotai `atomFamily(param)`,
  the `family()` of ADR 0048. Units are made at
  runtime. A member stays until someone removes it.
- **Bound in a scope.** React Context, a Core tag.
  Tinker today.
- **An argument of the read.** A TanStack Query
  key, a TanStack DB live query, Redux
  `useSelector`. One container is declared one
  time. The value is given where the read is.

TanStack DB has the same parts as ADR 0135:

- a collection is a keyed cell;
- a live query with a runtime value is `where`;
- `loadSubset` and `unloadSubset` are a reader
  that joins and leaves a part.

TanStack DB adds a query engine in the client:
predicates, joins, order with a limit, and
optimistic writes.

## Decision

1. A keyed read takes its key, or its part, where
   the read is.

   ```tsx
   useData(tasks.where({ project }));
   useData(tasks.of({ project, id }));
   ```

2. `of` and `where` make no unit. Each gives a
   value that names the cell and the part.
3. Readers are counted by the text of the part.
   The first reader joins the part. The last reader
   leaves it. Nothing stays for a part with no
   reader.
4. A keyed cell does not use the session way. No
   tag binds its key, and no session keeps a copy.
5. A part names fields of the key, with equal
   values. A read names nothing else.
6. Keyed data stays in Core. We do not use
   TanStack DB in the client.

## What we do not build

- A predicate other than "equal": greater, less,
  like.
- A join or an aggregate.
- An order with a limit that loads in windows.
- An optimistic write with a rollback. The server
  is the only writer, by rpc.

A filter on a field that is not in the key is a
selector in the client, or a view that the server
makes.

## Options considered

- **TanStack DB in the client**, with one adapter
  over rpc. It gives joins and predicates now. It
  is a second state system: its own store and its
  own hooks. A component would read it, and not a
  capsule's export (ADR 0123). The server side
  would stay our work. Not chosen.
- **Keyed data in Core, stop at the key.** Chosen.
  The first option stays possible later: an adapter
  can read a keyed cell.

## Proof

A browser test on built Core and React, with a
draft hook. It is in the project files, not in
this repo.

- Three panels read two projects from one cell:
  two joins.
- A write to one project did not render the panels
  of the other.
- The panels changed project: the old part was
  left.
- The page closed: no part stayed in use.

`useData(cell, selector)` takes a new function at
each render today. So a runtime value at the read
is not new in Core.

## Consequences

- The table of parts in use is runtime state. Its
  size follows the readers.
- Hedl needs little more: 9 of its 11 reads take
  `project`.
- Cost: a page that needs a join gets it from the
  server, as a view.
