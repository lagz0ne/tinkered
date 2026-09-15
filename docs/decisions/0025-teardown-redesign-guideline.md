# 0025 Teardown redesign guideline

Status: **proposed — design input, not implementation approval**. Date: 2026-09-15.
Refines [0011](0011-close-is-structured-and-total.md),
[0014](0014-release-cascades-downstream.md), and
[0017](0017-outcome-outside-in-success-inside-out-failure.md).
Keeps the public API of [0024](0024-converged-lifetime-signal-and-defer.md).
The reviewed implementation has since been reverted to `core/tag-meta`; the
[bug ledger](../roadmap/core-v1/teardown-redesign.md) preserves all four rounds.

## Recommendation

Use **one graph of concrete lifetimes, one record per defer, and one shared scheduling
rule** for close, release, operation completion, and abandoned builds. Separate selecting
what must end, deciding its outcome, and running its callbacks.

```text
select + reserve → settle work → run eligible defers → finish owners
```

Advance per lifetime: a parent body may await child teardown, so child callbacks must
remain runnable while the parent waits.

Keep `ctx.defer(end => …)` and `ctx.signal` on operation and resource contexts, with
`success | failed | cancelled | released`. Keep `close`, `release`, and `onClose` signatures.

## 1. Model and invariants

| Record            | What it owns                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer             | Parent/children, signal, body and owned work, close request, final result, outstanding teardown claims.                                        |
| Lifetime          | One resource **generation at its actual owner**, or one operation invocation. Build attempts exist before factory execution.                   |
| Defer             | Callback, lifetime/owner, registration sequence, and `registered → queued → running → done` state. `onClose` is an ordinary owner-bound defer. |
| Use edge          | The exact dependent lifetime and dependency generation it received. Forward and reverse indexes.                                               |
| Completion marker | An internal prerequisite with no user callback: work settled, registration finished, lifetime finished, or child closed.                       |

**Required properties:**

1. Every accepted defer runs once. A throw still completes that record; later defers run.
2. A dependency's callbacks start only after every relevant dependent's callbacks finish.
   A lifetime with no defers still has a completion marker and carries ordering edges.
3. Stamp sequence numbers **at the call to `defer` or `onClose`**, using one counter per
   root. Never reconstruct registration order from build start, completion, or map order.
   Never group one resource's defers into an indivisible block.
4. Dependencies and child-close constraints are hard prerequisites. Among eligible
   callbacks, choose the greatest sequence number: **latest eligible registration first**.
5. One callback runs at a time within a root's teardown dispatcher, including across
   release/close requests and owners. Different roots need no shared global lock.
6. Reserve queued teardown against **every affected owner before invoking any callback**.
   Closing an owner joins its queued and running work, not merely promises already started.
7. Finalize a layer only after its body, owned executions, children, and teardown claims
   finish. Record errors before releasing claims. Keep the final close result for repeat calls.
8. Use loops/worklists for graph walks, readiness propagation, owner walks, and signal
   propagation. A 10k+ chain must not consume the JavaScript call stack.

### Make the LIFO rule precise

Unconditional LIFO for every unrelated pair can contradict dependency order. Suppose
registration order is `D, U, B`, and D uses B. Pairwise LIFO asks for B before U and U
before D; dependency safety asks for D before B. Those requirements form a cycle.

**Recommended interpretation:** dependencies win; LIFO chooses among callbacks that can
run now. Here the result is `U, D, B`. With no dependency constraint, registration
`r.first, onClose, r.last` produces exactly `r.last, onClose, r.first`.
This definition must be accepted explicitly; no scheduler can satisfy the contradictory
pairwise interpretation.

## 2. Data structures

Keep/adapt the data invalidation index, but make lifetime edges identify
`(resource handle, owner, generation)`; operation uses identify an invocation. Record
edges when dependencies are delivered, including async builds before their promise settles.
Scope resources point to their root-owned generation even when resolved through a child.
Track declared/engine-delivered uses; arbitrary references captured by user code are not
inferable dependency edges. Data reset does not create a resource borrow or cancel producers.

Maintain both edge directions: reverse for release selection; forward for completion and
pruning. An obsolete build must never remove a replacement generation's edges. Retain old
edges until its teardown finishes. **No separate build-order list is needed.**

Use prerequisite counts, a worklist for markers, and a max-heap of ready callbacks keyed
by sequence. Owner claims use counters and lazy waiters, preserving the zero-promise sync
lane. Target O(V + E + H) storage and O(V + E + H log H) scheduling; H counts hooks.
Shared markers avoid all-pairs edges between callbacks.

## 3. Shared algorithm

### A. Admit an end request atomically

**Close:** seal the requested subtree against new public work. Propagate abort iteratively
parent-to-child, preserving the reason's identity. Let already admitted bodies/builds settle
and register defers until their work ends. Add child-completion prerequisites before
parent resource/onClose teardown; do not make child teardown wait for the parent's body.

**Release:** collect the affected generations iteratively through reverse edges, including
diamonds and cross-owner dependents. Reserve all of them; snapshot their ordering edges;
invalidate every selected cache/generation before notifying watchers or running callbacks.
New resolves may build replacement generations. Do not erase the retired graph yet.

Claim each lifetime once; overlapping requests join its existing completion. A closing
child remains a prerequisite for releasing the root generation it uses; skipping it is unsafe.

Reserve a whole lifetime even if its pending build has not registered all hooks yet. Late
hooks attach to that existing claim. Work settlement closes registration, determines its
end, and enables scheduling. Failed and superseded builds use the same executor and their
own attempt records. Late obsolete-build failures cannot poison replacement work.

### B. Encode prerequisites, not a reversed traversal

For each ending lifetime, create a start marker and a finish marker:

- Start requires an end request, finished work/registration, and a recorded final end.
  A resource built successfully is still live. Close-resource starts wait for their owner's
  settled outcome; operation starts need only their invocation outcome. Release starts wait
  for the retired build and applicable borrowers, not unrelated owner work.
- Start enables its individual callback records; all callbacks must complete before finish.
- A zero-hook lifetime connects start directly to finish.
- For a use edge `D uses B`, connect **finish(D) before start(B)**.
- For close, child-layer completion gates parent resource/onClose callbacks. Use owner
  markers, not an edge between every pair of child and parent callbacks.

For dependencies outside the end selection, do not end them. For an active borrower outside
it, keep an external completion prerequisite: physical resource teardown waits for that
borrower to finish. See the active-operation decision below. Dynamic requests must attach
prerequisites before a record becomes runnable; never add a new prerequisite retroactively
to a running callback.

```text
request end(selection):
  claim selected lifetimes at all owners
  attach work, dependency, and ownership prerequisites
  invalidate selected caches if this is release
  activate dispatcher

advance():
  drain all ready completion markers with a worklist
  if a callback is already running: return
  if no callback is eligible: wait for work/completion events
  take eligible callback with greatest registration sequence
  mark running; invoke it with its lifetime's final end
  if synchronous: complete it and continue the loop
  if async: resume only after fulfillment or rejection

complete(callback, possible error):
  record error at its owner, once
  mark done; unlock successors
  finish satisfied lifetime claims; wake their owners
  continue advance without recursive calls
```

External work waits never occupy the callback slot. Operation/child defers can unblock
parent bodies. Drain ready markers before choosing a callback, so walk order cannot change
LIFO. Keep execution-work joins separate from teardown joins: an owner must not wait for
its own resource teardown in order to decide the outcome that enables that teardown.

Validate a prepared graph for cycles iteratively. If unfinished work has no ready node,
distinguish a real external work prerequisite from a cycle; never interpret an empty ready
queue as successful completion. Reject cyclic resource construction before publication.

## 4. Settlement, cancellation, and errors

**Signal state and final outcome are different facts.** Normal auto-close aborts remaining
work after a successful body; that abort must not rewrite an already-recorded success.
An explicit cancellation, inherited cancellation, or interrupted session body records a
cancel fact. Record body settlement once when the engine observes it; a body returning
under an already-observed interrupt is cancelled. Identity comparison with the owner's
`signal.reason` recognizes a clean abort rejection; any different error remains real.

Use one final-outcome reducer after relevant owned execution work has settled:

```text
real body failure, else real owned-work failure → failed(primary cause)
otherwise cancellation fact                    → cancelled(saved abort reason)
otherwise                                      → success(saved result)
```

An explicit failed close request is also a failure input. Preserve body-primary precedence;
settle precedence among multiple real causes explicitly. Teardown errors are secondary and
never change a resource's frozen end. A retired build's failure belongs to that attempt,
not a replacement; its cleanup errors still belong to its owner.

The **same final result** supplies resource ends and session settlement:

| Final result                  | Session result                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Success, no teardown errors   | Return the body's value.                                                                                              |
| Failure, no teardown errors   | Reject with the primary real cause.                                                                                   |
| Cancelled, no teardown errors | Reject with the exact saved abort reason.                                                                             |
| Teardown errors present       | Reject `TeardownFailed`: primary failure or cancel reason first, if present, then teardown causes in execution order. |

Keep error-event identity when sharing completion across requests, so the same child error
is not added once via the child close and again via the awaited session. Two callbacks
throwing the same Error object are still two events. Preserve current `close()` failure
reporting semantics; this table describes `session(fn)`, not a new rejection rule for close.

Keep ADR 0017: later failures cannot rewrite an already-settled child/sibling.

## 5. Assumptions to remove

| Reviewed implementation assumption                               | Replacement / bug classes covered                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Reverse release DFS is teardown order                            | Dependency prerequisites: diamond and shared-path correctness for both close and release.                             |
| Only hook-bearing nodes matter; recursive DFS is cheap           | Zero-hook completion markers and iterative walks: missing transitive order and stack overflow.                        |
| Resource groups/build completion preserve LIFO                   | Per-callback registration sequence: onClose interleaving, independent and pulled-forward sibling LIFO.                |
| Three separate defer runners can share conventions               | One executor: sequential operation, release, failed-build and close teardown; errors cannot skip later hooks.         |
| Tracking the current async continuation is enough                | Claims from admission: sibling early-close, dropped late errors and close/release overlaps.                           |
| Deleting caches permits deleting lifetime state                  | Separate invalidation from retirement: late completion, double execution, replacement edges and generation isolation. |
| `signal.aborted` or a local cancelled flag determines everything | One final result: real late failures beat cancellation; cancelled sessions never resolve an invented `undefined`.     |
| Parent close can wait for its body before waking children        | Early iterative abort and independent readiness: nested-session cancellation and teardown progress.                   |

## 6. Open decisions for the interview

1. **Exact LIFO meaning.** Accept latest-eligible-first as defined above? Recommended;
   it is deterministic and compatible with hard dependency constraints.
2. **Active operations during resource release.** Recommend recording generation borrows:
   invalidate immediately, but wait for borrowers' completion/defers before physical teardown.
   This does not cancel operations or cascade data resets into producers. It does mean
   release cleanup may wait for a long-running operation. Is that behavior acceptable?
3. **Re-entry under strict serialization.** A callback awaiting teardown queued behind
   itself cannot finish. Recommend preserving synchronous owner/ancestor `close()` re-entry
   as request-only acknowledgement, while declaring async self/ancestor and same-root
   teardown waits unsupported. Different roots remain independent. A scheduler cannot
   infer arbitrary user-promise wait cycles without async context. Set this contract before
   implementing; do not make every concurrent close return an already-resolved promise.
4. **Release versus close and late-build ends.** Recommend the first accepted end request
   owns an attempt: successful release-selected builds end `released`, even if close joins
   later; real build rejection gets `failed`, abort rejection gets `cancelled`. Completed
   attempts keep their end. Confirm this precedence and obsolete-build failure reporting.
5. **Cancellation timing and rollback scope.** Recommend body settlement observed before
   interruption keeps its value; observed after interruption cancels it. Normal auto-close
   cannot cancel its own saved success. Keep ADR 0017's no-retroactive-rollback boundary rule.
   Confirm these choices with explicit race examples before claiming all outcomes settled.
6. **Sibling order and multiple errors.** Recommend latest-eligible sequence across sibling
   owners, with child-before-parent constraints; body cause first, then the first recorded
   real owned-work cause. Keep distinct error events, deterministic teardown-cause order,
   and current public reporting of additional work failures. Confirm the tie/precedence rules.

## 7. Suggested implementation tickets

Draft slices, **not published/ready tickets**. Resolve the decisions above before execution.
Work on one integration branch; each completed slice must pass its acceptance and existing
checks. Do not leave separate permanent close/release schedulers after migration.

| Ticket                                                 | Blocked by         | Delivers                                                                                                                  | Acceptance                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 — Give hooks and builds durable identity            | Accepted decisions | Registration-time hook records and generation-owned edges, wired through existing public paths.                           | `first/onClose/last` reverses correctly; async timing cannot reorder independent hooks; old builds never delete replacement edges or run hooks twice.                                                                                                                                 |
| L2 — Order close through one iterative executor        | L1                 | Completion markers, ready LIFO queue, sequential callback execution and close integration.                                | Diamond and no-hook chains obey every edge; shared-base siblings retain ready LIFO; each hook runs once; 10k+ resource chains close without overflow; synchronous operation defers stay synchronous when ready.                                                                       |
| L3 — Unify release and cross-owner joining             | L2                 | Release uses that executor; atomic claims, retained generation edges, active-borrow policy and overlapping-request joins. | Diamond release is correct; sibling close waits for queued release hooks and receives their late errors; closing children cannot be skipped ahead of root dependencies; release/close/rebuild overlap has no duplicate cleanup.                                                       |
| L4 — Settle outcomes once and propagate cancellation   | L3                 | Shared result reducer; iterative signal/owner handling; operation and abandoned-build paths fully migrated.               | Success/failed/cancelled × owned failure × teardown failure matrix; exact abort identity through nested sessions; late real failure wins; interrupted bodies and parent-awaits-child teardown terminate; failed/superseded build hooks finish once; deep owner trees do not overflow. |
| L5 — Prove the lifecycle contract and remove old paths | L4                 | Permanent public-seam conformance suite, old runner removal, budget checks and final ADR/ticket updates.                  | All review bug classes covered by deterministic regressions; vary graph shape, registration and settlement order, owner layout, and overlapping end requests; re-entry contract tested; size, promise, retained-heap and normal project gates pass.                                   |

Each ticket needs observed public-seam evidence, using explicit promises/handshakes rather
than sleeps. Done means one close/release execution rule, all six invariants proved under
the accepted interpretations, and no old path bypassing claims or final settlement.
