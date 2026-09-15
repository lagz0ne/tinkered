# 0026 Teardown is reverse-registration LIFO, not a dependency scheduler

Date: 2026-09-15. Status: accepted. Supersedes the scheduler _recommendation_ of
[0025](0025-teardown-redesign-guideline.md) (0025 stays as the analysis + bug-class map).
Refines [0011](0011-close-is-structured-and-total.md),
[0014](0014-release-cascades-downstream.md),
[0017](0017-outcome-outside-in-success-inside-out-failure.md); keeps the API of
[0024](0024-converged-lifetime-signal-and-defer.md).

## Context

The converged API (`ctx.defer(end)` + `ctx.signal`) is settled. Its first implementation grew a
dependency-ordered _scheduler_ (topological ordering, completion markers, a max-heap) to guarantee
"a dependent's cleanup runs before its dependency's." That scheduler took 4 review rounds and ~20
ordering bugs and still wasn't clean. The decision: **don't build the scheduler.** Teardown order is
the reverse of the order defers were registered — deterministic, programmatic, and dependency-correct
for natural code without any graph.

## Decision

**Teardown runs a layer's `defer`s (and `onClose`, which is just a defer) in reverse registration
order (LIFO), one at a time, awaited.** There is no topological/dependency ordering pass.

Why this is dependency-correct without a scheduler: a dependency is built — and registers its
`defer` — before its dependent's factory runs, so in registration order the dependency precedes the
dependent, and the reverse (teardown) runs the dependent first. This holds for sync deps and for
async deps that the dependent **awaits before registering its cleanup** (the natural pattern: you
register cleanup for a thing after you acquire it). Registering a cleanup _before_ awaiting an async
dependency is the one shape that can misorder; that is a documented usage caveat, not an engine
guarantee. Diamonds and chains fall out of registration order correctly and are torn down by list
reversal (iterative — no recursion, no stack overflow on deep chains).

The six behavior decisions (from 0025 §6):

1. **LIFO meaning (Q1).** Teardown = reverse of `defer`/`onClose` registration order. No dependency
   scheduler. Dependency correctness emerges from registration order per above.
2. **Active operation during resource release (Q2).** On `release`, invalidate the cache immediately,
   but wait for in-flight operations that borrowed the resource to finish (and run their defers)
   before physically tearing it down. Release cleanup may therefore wait for a long-running op; it
   does **not** cancel that op or reset data into producers.
3. **Re-entrant teardown → detect and kill (Q3).** A synchronous `close()` on the same/ancestor
   scope from within teardown is a request-only acknowledgement (no hang). A teardown callback that
   would **await its own or an ancestor's same-root teardown queued behind itself is a deadlock**:
   the engine detects it and rejects it (kills it), never hangs. Different scopes are independent.
4. **One end per lifetime; wrong state throws (Q4).** Each lifetime (resource generation / operation
   invocation) has a single end. The first accepted end-request owns the outcome: a release-selected
   build ends `released` even if a `close` joins later; a real build rejection ends `failed`; an
   abort rejection ends `cancelled`; a completed attempt keeps its end. An invalid transition (ending
   what is already ended, or a conflicting request) throws — guarantee the current lifetime's state
   rather than reconciling competing requests.
5. **Cancellation timing (Q5).** "Cancel" means _the result is no longer wanted._ A body whose result
   settled **before** the interrupt keeps its value; settled **after** → `cancelled`. A normal
   auto-close cannot cancel its own already-saved success. Keep 0017's no-retroactive-rollback rule.
6. **Sibling order + multiple errors (Q6).** Reverse-registration across siblings, children before
   parents. On failure the **body cause wins, then the first recorded owned-work cause**; teardown
   errors stay secondary in deterministic (execution) order; two throws of the same Error are two
   events.

Settlement reducer (unchanged from 0025 §4), applied once per lifetime after owned work settles:
`real body failure → real owned-work failure → cancellation fact → success`.

**A body failure is a body failure — no "own vs propagated" distinction (lt1, rounds 7–9).** During
lt1 we tried to make an owned-work failure win over a body that _merely surfaced_ an inherited/ancestor
failure it awaited (so a child would report its own bug rather than the force-close cause). This is
**unsound**: whether a body's rejection "came from" a descendant vs was thrown directly is only
knowable by the error _value_, and value cannot prove origin — a body can `throw` the very object an
ancestor failed with, or `await child.close({failed, X})` then `throw X`. Every value-based scheme
(identity match, a `WeakSet` of propagated causes, a per-layer set snapshotted at body-settle) either
demoted a real own failure or, worst case, turned a real body failure into `success`. So we follow the
reducer literally: **any real (non-cancel) body rejection wins, and its cause is the outcome**,
regardless of where it came from. A caught owned-work error is not the body's outcome and does not
override it; an uncaught owned-work error _is_ the body's rejection and wins as the body cause.

## Consequences

- The teardown implementation is a **single per-layer defer list drained in reverse, sequentially,
  awaited**, with cross-owner claims so an owner's close joins queued (incl. cross-owner) release
  work and never drops a late throw. No graph scheduler, no completion markers, no heap.
- `close` and `release` share the one reverse-registration drain; `release` uses the `dependents`
  graph only to **select** the affected set, not to order it.
- Cancellation: `signal` chains parent→child iteratively; `error === signal.reason` is a clean cancel,
  any other error is real; a cancelled session rejects with the abort reason (propagates cleanly).
- Deep chains are safe (list reversal, iterative). Deadlocks are killed, not hung.
- Breaking ctx change (`cleanup`/`onOutcome` → `defer`); acceptable pre-v1. Built as tracked tickets
  (see `docs/roadmap/core-v1/PROGRESS.md`), each landing astra-clean, against the bug ledger in
  `docs/roadmap/core-v1/teardown-redesign.md`.
