# 0126 An edge picks the layer a write lands on

Date: 2026-11-06. Status: accepted shape; implementation open.
Accepted: Duke, 2026-11-06 14:39 UTC: "Yeah, go adr".
Builds on: 0064, 0090, 0123.

## What the user said

- 11:55: "the data we want to have a "target"
  but that should not be escalated".
- 11:58: "Data should be by usage rather than
  at declaration".
- 12:00: "At the edge".
- 12:33: "The held might have an option to
  choose the layer it should be written to".
- 14:01: the form is `atScope`, with the
  existing edge name after it (14:05: `controller`).
- 14:07: a capsule export must not be able to
  pick a layer at its edge.
- 14:57: "Yes" to three placements: own layer,
  `atNamespace`, `atScope`.

## Context

A call with `signal` or `tags` runs in a child
session (ADR 0090, ADR 0038).
A plain `cell.controller` write inside it stays
in that child.
That is right for most writes.

Some writes belong to the root.
Example: a client token cache.
The transport runs `meta` and `renew` inside
calls that carry a `signal`.
A token written there is lost when the call ends.

Today an app gets the root in one of two ways:

- a capsule keeps the root controller from its
  `start` and its ops write through it;
- a `scope`-target resource takes the controller,
  and its dependencies bind at the root
  (glossary "resource target").

Both work. Both hide a plain intent behind a unit
that exists only to place one write.

## Precedent

- **Jotai.** An atom is declared once with no
  store. The store is picked where it is used.
- **React, "lifting state up".** The state lives
  where a component chooses to hold it, not where
  its shape is declared.
- **ADR 0123.** "The edge carries the rule."
  Read or write is already chosen at the edge.
- **ADR 0064.** Resource targets already name
  three owners: `scope`, `namespace`, `session`.
  The edge borrows those words.

Where ours is simpler:

- Three placements, no store objects.
- The cell declares nothing. Each edge picks.

## Decision

1. A cell's write-mode edge has three
   placements, named as resource targets:
   - `cell.controller`: the caller's own layer
     (as `session`). It does not change.
   - `cell.atNamespace.controller`: the root, in
     the caller's namespace (as `namespace`).
   - `cell.atScope.controller`: the root, outside
     any namespace (as `scope`).
2. A placed edge works from any layer below the
   root: a session, a tagged call, a call with a
   `signal`.
3. Nothing climbs by itself.
   A write lands at the root only through an edge
   that says `atScope` or `atNamespace`.
   A session's own write never escalates.
4. A read view has neither
   (ADR 0123: no `controller`, no path to the
   cell). A capsule export cannot pick a layer.
5. A `data()` call takes no placement option.

```ts
const held = data({ initial: null });

const renew = operation({
  depends: { tokens: held.atScope.controller },
  run: async ({ tokens }) => {
    tokens.set(await refresh());
  },
});
```

## Evidence

A scratch copy of the v0.11.0 source took two
properties on `data()` and one branch where a
controller edge resolves.

- The remote todo stress app: 71 of 71 tests,
  3 runs. The OAuth token cache is one edge.
- A write through `atScope` reaches the root from
  a child session and from a call two levels down.
- `cell.controller` still writes its own layer.
- From a signal call in a session with namespace
  `ann`: `atNamespace` lands under `ann` only;
  `bob` does not see it. `atScope` lands in the
  root's own bucket; every namespace sees it
  unless it holds its own value.
- A capsule's exported cell has no `atScope`,
  at run time and in the types.
- Core's own tests under Bun: 683 pass and the
  same 8 fail on the base and the changed source.
  Three files hang under Bun on both. So the full
  `vp test` run is still owed.

Code and diff:
`/mnt/project-files/tinkered/plans/remote-cell/`
`todo-atscope/`.

## Open

- The `tinker/cell-write` lint sees only
  `x.controller`. It must also flag
  `x.atScope.controller` and
  `x.atNamespace.controller` on another
  capsule's raw cell.
- Proof at landing: `vp test` for Core and React,
  mutation on the changed lines, and the size cap.
- No placement names "the nearest session above
  this call" (a panel's `SessionProvider` seen
  from a signal call). Core makes call children
  and `createSession` children the same way, with
  no mark. It waits for a caller.
