# 0134 A stop during start ends the start

Date: 2026-11-10. Status: proposed; built.
Changes: ADR 0085 decision 2 (a stop during start).
Found by: the Hedl thread, on 0.16.1 (test N2c).

## Context

`serve` is a capsule (ADR 0132).
Its start listens after `next()`:

```ts
async start({ next }) {
  await next();
  Bun.serve({ ... });
}
```

Two bugs, on 0.16.1:

- A stop signal during start:
  `serve` listens, then closes.
  ADR 0085 said: the close begins once `ready` resolves.
- A `close()` during start is worse.
  The close hooks run first.
  Then `serve` listens, and nothing closes the port.

In both cases `next()` resolves as usual.
So a start hook cannot tell that the start was stopped.

## Precedent

- **Node `server.listen({ signal })`.**
  An already aborted signal: it does not listen.
  ADR 0085 cites this precedent already.
- **systemd.** A stop job cancels a start job
  that is still running.
- **Effect.** An interrupt during a layer build
  stops the build. The build's finalizers run.
- **.NET `IHostedService.StartAsync(token)`.**
  The token tells a start that the host stops.

Ours is simpler: Core does not stop a hook that runs.
It waits for it, as a close during start does.

## Decision

1. **After a stop, `next()` rejects.**
   - A stop is a close, a stop signal, or a start timeout.
   - `next()` rejects with Core's closing reason
     (`code: 20`).
   - So no hook does the work after its `next()`.
   - A hook that has not started does not start.
2. **A stop signal during start ends the start.**
   - Core waits for the hooks that run.
   - The close is forced, as for a failed start.
     The close hooks run.
   - Then `ready` rejects with the signal's reason.
   - `closed` is `cancelled`.
   - A start error that comes first still wins.
   - A hook that catches `next()` does not keep the start.
3. **A signal that aborted before start: no hook runs.**
   With no start hook, nothing waits:
   `ready` resolves, and the close is graceful (ADR 0085).
4. **`run` exits with the signal's code, and logs nothing.**
   It already treats the signal's reason as a stop.

## Results

- Hedl can remove its gate capsule after `serve`.
- Any capsule that opens something after `next()`
  is safe, with no check of its own.

A hook must await or return `next()`.
A hook that drops it gets no unhandled rejection
from a stop.

## Rejected

- **`serve` checks a signal after `next()`.**
  Each capsule that opens something needs the same check.
- **`closing` aborts at a stop during start.**
  `closing` means "a close has begun".
  And each hook must check it after `next()`.
