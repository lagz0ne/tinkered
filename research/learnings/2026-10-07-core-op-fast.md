# Core run and close costs

Use a default-engine trace to prove the hot constructor inlines.
A flag that turns Maglev off would hide this study's problem.
The final build inlines `OperationCtx` into `runOnce` on Node 24.21.0.
No engine budget was changed.

Move the parked dependency tail out of the hot body.
Keep run hook access windows, order, and `next()` behavior.
Make an operation's defer function on its first read and keep it.
The kept arrow function still works when a caller takes it out of the context.
Pass the run's returned value to settle without a new wrapper function.
Read the call signal before the run, outside the catch boundary.
Moving that read can turn a real failure into cancellation.
Two public-seam tests caught that change in the study patch.

A close with no body, child, or pending work needs no extra wait for sync cleanup.
Drain sync cleanup in one promise job, in the same LIFO order.
Wait as soon as a cleanup returns a promise.
Keep the first close request's mode and result.
A shared closing reason avoids a stack for each close.
Keep web abort code 20: the HTTP caller reports that code.

The queue ran 61 pairs for each shared-probe scenario.
Median ns per call, main to the fix:

- `op`: 64.2 to 57.7; b is faster.
- `run`: 75.5 to 71.7; b is faster.
- `tagged`: 208.6 to 179.6; b is faster.
- `session`: 509.2 to 510.4; no difference we can see.
- `lifecycle`: 849.8 to 854.0; no difference we can see.

Two whole-process checks ran ten pairs each through the queue.
Two million settle calls: 396 to 283 ms; verdict: b is faster.
100,000 forced closes with sync cleanup:
437 to 367 ms; verdict: b is faster.

Runtime gzip grows from 15,367 to 15,724 bytes, a cost of 357 bytes.
The cap is 16,384 bytes.
The hot-name map ends at V8 slot 255, with no slot headroom.
The ticket makes no measured heap-byte claim.

[Full proof](../../docs/roadmap/core-v1/PROGRESS.md#coreop-fast).
