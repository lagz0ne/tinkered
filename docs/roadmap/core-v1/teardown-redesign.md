# Teardown / lifetime redesign — requirements & bug ledger

Status: **design phase.** The converged API is settled (see below); the first _implementation_ of it
grew too fast and hit ~20 ordering bugs over 4 adversarial-review rounds, so the patchy impl was
**reverted** to `core/tag-meta` (proven two-phase `cleanup`/`onOutcome`). This file is the durable
input to the redesign: the API we keep, the invariants, and every failure mode found (each becomes a
regression test in the redesign tickets). Flow: astra redesign guideline → grill → ADR → to-tickets → build.

## API (settled — keep; ADR 0024)

Both operation and resource ctx expose one lifetime pair:

- `ctx.defer(fn: (end: Scope.End) => void | PromiseLike<void>)` — one end-hook, replaces `cleanup` +
  `onOutcome`. `end.status = "success" | "failed" | "cancelled" | "released"`. One handler does
  commit/rollback _then_ release, top-to-bottom.
- `ctx.signal: AbortSignal` — cancel channel; hand to `fetch`/an SDK.

`Scope.Outcome = success | failed | cancelled`. `Scope.End = Outcome | { released }`.
Streaming needs no new primitive: an async op write-deps a `data` cell, writes it over time, honors
`ctx.signal`; consumers `watch`.

## Invariants the redesign MUST satisfy (all together, not as separate patches)

1. **Dependency-ordered teardown** — a dependent's `defer` runs before the dependency it used, for
   BOTH close and release (unify them). Correct for diamonds and chains regardless of sync/async
   build timing.
2. **LIFO among independents** — unrelated units tear down last-registered-first (ADR 0011), and
   `onClose` keeps its registration position interleaved with resource defers, even when registered
   inside a factory between that factory's own defers.
3. **Awaited sequential teardown** — each defer completes before the next runs (no concurrency),
   across owners too; every queued defer (incl. cross-owner) is joined by its owner's close, so close
   never finishes before queued teardown runs and a late throw is never lost.
4. **Cancellation** — `signal` chains parent→child; an abort-caused rejection (`error === signal.reason`)
   is a clean cancel, a real error still surfaces; a cancelled layer settles `cancelled`; a real
   owned-work failure wins over cancel; a cancelled session rejects with the abort reason (propagates
   cleanly up nested sessions).
5. **Robustness** — no recursion/stack-overflow on deep (10k+) dependency chains — iterative traversal.
6. **Cross-owner** — `scope`-target resources (owned at root, resolved through child sessions) tear
   down in the right order relative to session-owned dependents; children close first.

## Failure-mode ledger (each → a regression test)

Discovered across 4 review rounds of the reverted impl. The redesign's test suite must cover every one.

Round 1:

- Normal close swallowed a real late owned failure (cancel-clean check was "any rejection after
  abort" — too broad; must be `error === signal.reason`).
- Parent cancel deadlocked: parent joined its body before closing children, and a child's signal only
  aborted when the child closed → work awaited in a child never unblocked. (Chain child aborts to parent.)
- Async `defer`s drained in registration order, not dependency order → dependent released after its
  dependency.
- Clean cancel became `failed` through `finishAsyncBuild` (recorded abort rejection as primary) and
  through a session body join.
- ADR over-claimed that releasing a downstream cell cancels an upstream producer (it does not; only
  closing the producer's scope does).
- Operation `defer`s ran concurrently (not awaited between).

Round 2:

- A cancelled nested session committed on a **clean return** (body returned normally under an aborted
  signal → wrongly `success`).
- Build-completion order ≠ dependency order: a sync dependent holding an async dependency's promise
  (unawaited) settles first → released before the dependent.
- A build finishing **during** close got `released` instead of the close outcome (`failed`/`cancelled`).
- Local (superseded/failed-build) resource defers ran concurrently.

Round 3:

- Graph ordering skipped resources **without** defers (A→B→C, B no defer → C ran before A). Must
  traverse through no-defer resources.
- Moving `onClose` last broke ADR 0011 layer-wide LIFO (an onClose that uses a resource ran after the
  resource's teardown).
- Independent resources closed FIFO instead of LIFO.
- Published-resource **release** still ran async defers concurrently.
- A cancelled `session()` resolved `undefined` typed as `R` (unsound). Must reject with the abort
  reason (propagates cleanly; keeps `Promise<R>` honest).

Round 4:

- **Cross-owner release**: close finished before queued release work ran (pending tracked only the
  currently-running callback's owner, not queued owners) → a late throw could be lost.
- **Cancellation masked a real owned-work failure** (abort reason chosen before `child.failure`).
- **Deep no-defer chains** (10k+) overflowed the recursive teardown walk → `close()` threw `RangeError`.
- `onClose` registered **inside a factory** between that factory's own defers lost its LIFO position
  (resource defers were grouped at build-completion).
- Siblings pulled forward by a shared dependency ran FIFO, not LIFO.

Rounds 6–9 (lt1 rebuild — all one class: **outcome precedence** across nested self-closing sessions):

- R6: inherited `cancelled` shadowed a parent's real `failed` → `moreSevere(inheritedEnd, outcome)`
  combines an inherited end with the close request by severity (failed > cancelled > success).
- R7–R9: an attempt to make owned-work win over a body that _surfaced_ an inherited failure. Fixed and
  re-broken three times (identity match → `WeakSet` of propagated causes → per-layer set snapshotted
  at body-settle). R9 proved the whole idea unsound: `await child.close({failed, X}); throw X` marks
  `X`, then the body's own `throw X` is misread as propagated — worst case a real body failure settled
  as **success** (could commit work after failure). **Resolution: drop the distinction entirely.** The
  settlement reducer is applied literally — any real body rejection wins as the body cause (ADR 0026,
  "no own-vs-propagated"). This removed the `propagatedCauses`/`bodyOwnFailure`/`ownBodyFailure`
  machinery; two prior regression tests that encoded the non-ADR "owned beats surfaced-body" model
  were re-specified to the ADR result (the surfaced body cause wins; a _caught_ owned error never
  overrides the body's outcome).

Rounds 10–14 (lt1 rebuild — **concurrent / overlapping close propagation**: two+ `close()` on
different layers in one turn, interacting through `inheritedEnd`/severity/abort reasons):

- R10: `abortSubtree` overwrote a descendant's `inheritedEnd` unconditionally → a later ancestor
  `cancelled` erased an earlier inherited `failed`. Fix: `moreSevere(layer.inheritedEnd, inherited)`.
- R11: cancellation was recognized only by exact reason identity, so a parent whose body awaited a
  separately-cancelled child rejected with the child's reason and misread it as a real failure. Fix:
  **brand** every abort reason (`makeCancelReason`/`isCancelReason`); `isCancel` = aborted && branded.
- R12: `startClose` used a start-of-close `requested` snapshot at settlement, missing a concurrent
  ancestor upgrade to `inheritedEnd` during the body-join. Fix: re-read the live `inheritedEnd`
  (merged by `moreSevere`) at settlement.
- R13: `closeLayer` on an already-closing (not-yet-settled) child ignored a more-severe incoming
  outcome, so a parent body failure passed via `closeChildren` was dropped. Fix: merge the outcome
  into the child's live `inheritedEnd` and re-propagate.
- R14: **CONFIRM CLEAN** for lt1's scope (768-case 4-layer overlap matrix across all 24 orders +
  branding, double-upgrade, and failure-after-settlement probes). lt1 landed.

Deferred to lt4 (ordering polish — both errors ARE reported, only their order can be off):

- A child's teardown errors enter the parent's `secondary` bucket only when the whole child close
  settles; a parent operation `defer` that throws in between (its owned op unblocked by the child's
  own `onClose`) is recorded first, so `TeardownFailed.causes` can list the parent-op error before the
  earlier child error. Deterministic execution-order across owners is lt4's Q6 work.

Pre-existing (exists on `core/tag-meta` too — NOT introduced by this work):

- **Diamond release** violates dependency order (releasing a shared base reverses the traversal and
  releases a dependent's dependency before the dependent). Teardown ordering was never fully correct;
  the redesign should fix close AND release through one correct mechanism.

## Regression scenarios to re-create as tests (from the reverted WIP)

Behavior tests worth restoring once the redesign lands: streaming op writes a cell over time + watcher
sees it grow; `close()` aborts `ctx.signal` so a parked op stops cleanly; op `defer` sees
success/failed/cancelled; resource `defer` sees cancelled on `close({cancelled})` and released on
`release`; a data preset seen downstream; the cross-owner, diamond, no-defer-chain, deep-chain,
onClose-interleaving, sibling-LIFO, cancel-masks-failure, and cancelled-session-rejects cases above.

## Next

- astra redesign guideline (agent dd5b5c47) → model + algorithm + open questions + ticket breakdown.
- Grill the open questions → redesign ADR (supersedes the impl consequences of 0024; keeps its API).
- to-tickets in `PROGRESS.md`; build each to astra-clean via the gate.
