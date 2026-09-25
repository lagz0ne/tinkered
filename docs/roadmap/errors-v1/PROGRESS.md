# errors-v1 progress

The track for ADR 0067: an error is a value, a panic
is stamped at its origin, and `settle` recovers.

## errors/t01 — no cooked promise; settle, origin, raise

- **Done in** branch `errors/t01`.
- Every run returns a native promise.
- `settle` returns a `RunResult` and never throws.
- `originOf` reads `{ label, span?, path }`.
- `ctx.raise` throws a managed error, stamped at
  its ctx.
- A path grows only while the error is in flight.
  The flight ends at a root run or a `settle`.

## For errors/t03: the interim gap

Until t03, a subflow failure goes to its caller.
A caller that drops it while it still runs loses
it. Only the failed span shows it.

- **It depends on microtask timing.** The same
  `void sub.run()` in an async caller fails the
  layer under an async `run` hook (extra ticks),
  and vanishes without one.
- **A dropped panic vanishes too**, not only a
  managed error.
- Probe (the session closes `success`):

  ```ts
  run: async ({ boom }) => {
    void boom.run(); // boom rejects at once
    return "ok";
  },
  ```

- t03's sticky panic covers the panic case.
- A dropped managed error still needs a decision.
