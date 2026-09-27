# 0069 A closed session frees its data unless the closer asks `withData`

Date: 2026-09-27. Status: accepted.

## Context

A session's writes stay in the session (it inherits and shadows on write). At close, core frees
the session's data (`nodes.clear()`), and a read after close throws `Disposed`. So there was no
moment to read a session's final data: before close, work may still run; after close, the data
is gone. The user's goal (2026-09-27): waste nothing when nobody cares, and still hand the data
over when someone does.

## Decision

The precedent is POSIX process exit. A parent either collects a child's exit status with
`wait`, or the kernel frees the child at once; a SIGCHLD handler can still read the child
before it is freed.

- **Off by default.** A closing session frees its data, as today. Nobody pays for a copy.
- **`close({ withData: true })`** moves the session's own data store into the close `Result` as
  `data`, instead of freeing it. Nothing is copied or filtered.
- **`data.get(cell)`** returns a `Presence`: present when the session itself wrote that cell,
  absent otherwise. Inherited values are not kept; the parent still holds them.
- **Every ending** carries `data` when asked: `success`, `cancelled`, and `failed`. The caller
  reads `status` next to it.
- **Extensions need no flag.** Core frees the data only after the `session` hooks return, so a
  hook reads the session's data cells through its own handle after `next()`. Writes and
  resource reads there still throw: the session is closed and its resources are torn down.
- Only data cells are readable. `scope.session(fn)` is unchanged: `fn`'s return value is its
  way out.

## Options considered

- A list of cells to keep (`keep: [draft]`), like SQL `RETURNING`: rejected as too refined; an
  on/off switch is enough to avoid waste.
- An extension flag (`next({ keep: true })`): rejected; the hook reads the session directly.
- Keeping inherited values too: rejected; it copies what the parent already holds.

## As built

- core/with-data (2026-09-27): a session's tags stay readable in the hook window too. Core frees
  them at the same step as its data.
- `data.get(cell, { ns })` picks the bucket a controller on that scope picks: the ns chain in
  order, then the default bucket. Without `ns`, the scope's own `ns` applies.
- `withData` is read from the first close call, like `graceful`; a later call joins that close.
- In the hook window only `resolve` reads; `controller(cell)` still throws `Disposed`.

## Consequences

- A closed session's data cells stay readable until its `session` hooks finish; only
  extensions run in that window.
- The default close path must not get slower (timed through benchd at landing).
