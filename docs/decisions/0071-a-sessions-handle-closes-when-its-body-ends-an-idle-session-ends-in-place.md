# 0071 A session's handle closes when its body ends; an idle session ends in place

Date: 2026-09-29. Status: accepted. Refines: 0038 (a tagged call is a session), 0027 and 0028
(close), 0069 (`withData`).

## Context

A session whose body returned and left nothing to clean up still ran the whole close protocol.
That took about ten empty async steps and most of a tagged call's 17 promises.
`tagged` was 2130 ns against a 2000 ns budget; `session` was 1680 ns.

During those empty steps the session's handle stayed open by accident.
Code that kept the handle could still call `onClose`, `resolve`, or `close({ withData: true })`
after the body had returned.
No ADR or doc promised that window.

The perf/tagged-close work (branch fp2/fable) ends such a session at once.
Screened through benchd: `tagged` 2130 → 992 ns, `session` 1680 → 660 ns, promises 17 → 2.
A check that ran the same programs on main and the branch (433 schedules) showed the window
was the one outcome that could not be kept without losing the gain for `session()`.

The user chose (2026-09-29) to close the handle when the body ends.

## Decision

The precedent is a database transaction callback, as in knex or drizzle:
the `tx` handle is dead once the callback returns.

- **The handle lives while the body runs.**
  Once the body has returned (a plain value) or its promise has settled, the handle is closed.
  `onClose`, `resolve`, `run`, and `close` on it throw `Disposed`.
- **To keep a session's data, ask inside the body.**
  `close({ withData: true })` from the body, or a `session` hook (ADR 0069), still hands the
  data over.
- **An idle session ends in place.**
  Idle means the body left no cleanup step, resource, child, pending work, watcher, or failure;
  no signal was handed out; and no ancestor close is in flight.
  An idle session skips the close protocol.
  Anything else takes the full close path, unchanged (ADR 0026 order, ADR 0028 modes).
- **A signal read after the end is aborted.**
  A session that ended in place leaves its signal aborted, as a forced close does (ADR 0028).
- **A tagged call still returns a native promise** (ADR 0038).
  Only the number of microtask turns before it settles changes.
  No ADR promises a turn count.

## Consequences

- A handle that escaped its body and is used later gets `Disposed`.
  Before, that worked for about ten microtask turns.
- The session promise settles sooner.
  Code that raced it against other promises by turn count may see a new order.
- Tagged calls never hand out their handle, so the window never applied to them.

## Options considered

- **Keep the window for `session()`; end in place only for tagged calls.**
  `tagged` keeps its gain, `session()` stays near 1500 ns, and the accidental window stays.
  Rejected: nothing promised the window, and a transaction callback is the known model.
- **Tags as plain values, with no child session** (measured: 220 ns per tagged call).
  Rejected: it undoes ADR 0038's per-call cleanup, panic isolation, and session hooks.
- **A tagged call returns its value directly when it ended in place** (measured: 811 ns).
  Rejected: it breaks ADR 0038's "always async".
