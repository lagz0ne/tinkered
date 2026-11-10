# 0133 A call stopped by its own signal is cancelled for its caller

Date: 2026-11-10. Status: accepted; built.
Accepted: Duke, 2026-11-10 04:25 UTC: "agree"
(change the Core rule, not rpc and remoteData).
Refines: ADR 0067 (panic), ADR 0090 (call signal).

## What the user said

- 03:22: "creating data in mass can cause memory
  leak".
- 03:33: "it might not be the first and the only
  cause. Need to go deeper to find the cause".

## Context

A call with a `signal` runs in its own child
session (ADR 0090). An abort ends the child. The
child rejects with the signal's reason.

The caller's layer then asked "is this a cancel?"
about itself. It was not aborted. So the reason
became a panic on the caller's layer (ADR 0067).

```ts
const stop = new AbortController();
const running = sub.run({ signal: stop.signal });
stop.abort();
await running.catch(() => undefined);
// before: the caller's root keeps a panic
```

Two results, on Core 0.16.0:

- the root's `close()` reported `failed`;
- each stop kept its reason on the root: a leak.

rpc stops every stream this way, and a keyed
`remoteData` stops a project's watch this way. So
each stream a reader left, and each session that
opened a project, added one panic to the tab.

A second cause, on Node only:
`AbortSignal.any([short, long])` keeps a record on
the long-lived signal for each call (about 180 B).
Bun 1.4 and Chromium 153 do not.

## Precedent

- **.NET `Task`.** A task ends `Canceled`, not
  `Faulted`, when its error carries the task's own
  token and that token is cancelled.
- **Kotlin.** A child's `CancellationException`
  never fails its parent.
- **ADR 0090.** "A handled cancelled result leaves
  the caller's owner alive." `settle` did this;
  `run` plus `catch` did not.

Ours is simpler: no exception type, no token on
the error. The check is identity with the reason.

## Decision

1. A call given a `signal` that rejects with that
   signal's reason, while the signal is aborted,
   is a cancellation for its caller. It does not
   stick as a panic.
2. Any other rejection of that call keeps the
   rule of ADR 0067: a panic sticks.
3. An error that wraps the reason is another
   error. It sticks.
4. Core code makes no `AbortSignal.any` over a
   signal that outlives the call.
   - rpc gives a watch only its own stop signal.
     The caller's signal already stops it: the
     call's child session owns the watch.
   - A keyed entry puts one listener on the root's
     signal, removed when the entry stops.

## Proof

- Tests that fail on 0.16.0:
  a caught subflow stopped by its signal; a stream
  left by `break`; a keyed session that opens and
  closes. Each then closes its root
  with no failure.
- A test for the rpc change: a caller's signal
  still ends the stream it opened.
- `bench/heap-stop.mjs`, in `pnpm validate`, on
  Node 22: heap kept per stop, budget 64 B.

```text
                       0.16.0   rule   rule+4
stream, break          4011 B    6 B     7 B
stream, long signal     183 B  184 B     6 B
keyed session          3846 B  181 B     5 B
```

## Not done here

- `ctx.closing` still joins its ancestors with
  `AbortSignal.any` (`closingOf`). A session
  resource that reads it pays the Node record.
  Card `core/closing-no-any`.
- A local stream key called with a `signal` never
  answers. Card `core/local-stream-signal`.
