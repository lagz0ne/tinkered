# 0123 A capsule's cell export is read-only

Date: 2026-11-05. Status: accepted.
Accepted: Duke, 2026-11-05 05:33 UTC:
"I think we are good, let's do the work".
Amends: 0121 section 7.

## What the user said

- 04:13: other features watch the data; how the
  data forms stays in the capsule's watchers.
- 04:18: an export states its intent. Read-only
  is the default: "not sure why we want it to
  be writable".
- 04:21: control at the edge; a run-time error
  is enough, as `CapsuleMissing` is. A raw cell
  stays editable, as today.
- 04:47: a lint and a run-time error. No more
  restrictions than those.
- 05:02: lose the controller from the export,
  "so no longer guess there".
- 05:23: no `owns` list: `exports` already says
  it. "Don't let the same mistake crawl in."

## Words

- **read view**: what a capsule exports for a
  cell. It has no `controller`.
- **reader**: what a read view hands a unit:
  `get()` and `watch()`.

## Precedent

- **Erlang ETS `protected`.** The owner process
  writes; any process reads.
- **Kotlin `StateFlow`.** A view model keeps the
  `MutableStateFlow` private and shows a
  read-only `StateFlow`.
- **Elm.** Read the state; change it by sending
  a message to the one update function.

Where ours is simpler:

- No access levels. `exports` is the only list.
- No owner check. The edge carries the rule.

## Evidence

Hedl `061b207`, `src/frontend`, 139 cells:

- 28 edges took another feature's controller.
- 26 of them only read or watched.
  Only the controller had `watch`.
- 2 wrote. Each becomes one exported op.

## Decision

1. A cell in `exports` shows on the handle and
   on each binding as a read view, not the cell.
2. A read view has no `controller` and no path
   to the cell.
3. `depends: { p: talk.point }` hands a reader.
4. `scope.resolve(talk.point)` answers the same
   reader each time, without `ns`. With `ns`,
   each call answers a fresh reader, as
   `controller(cell, { ns })` does.
5. A hook's `load(talk.point, meta)` answers a
   reader.
6. `useData(talk.point)` reads it in React.
   It has no writable pair.
7. A `depends` that names
   `talk.point.controller` is a type error. At
   first touch it raises `InvalidDependency`,
   before any work.
8. A read view needs its capsule:
   `CapsuleMissing`, as any export.
9. The raw cell keeps full power.
10. The way to change a capsule's cell from
    outside is an op the capsule exports.
11. Lint `tinker/cell-write` (warn):
    `.controller` on a cell that another
    capsule's folder declares.

## Consequences

- `mail.outbox === outbox` is now false for a
  cell export. Ops, resources, and tags keep
  the same object.
- A family read works through the view with
  `{ ns }`, as on the cell.
- No new error name.
