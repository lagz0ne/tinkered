# Teardown / lifetime redesign — requirements & bug ledger

Status: **COMPLETE** — realized in `core/lt1`–`core/lt4` (ADR 0024/0026/0027/0028/0029). This file is
the durable HISTORY: the invariants, every failure mode found across the review rounds (each became a
regression test), and the design pivots. The headline outcome: `close()` became a shutdown MODE, not a
wished outcome (ADR 0028), which dissolved the wish/severity bug class and shrank the engine. Accepted
v1 limitations live in ADR 0029. Kept for provenance; not a live worklist.

Original framing (for context): the converged API (below) was settled first; an early implementation
grew too fast and hit ~20 ordering bugs over 4 review rounds and was reverted to `core/tag-meta`, then
rebuilt ticket-by-ticket to the ledger below.

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

lt2 (release + cross-owner + borrow) — SCOPE DECISION after a 14-round drift:

- lt2's contract is: diamond release order (within an owner, reverse-registration); cross-owner
  order = **children/descendants first** (ledger invariant 6) via **depth-ordered** owner draining
  (NOT owner-encounter order, which is arbitrary — r15); the **op** borrow policy (ADR 0026 Q2: a
  release waits for in-flight OPERATIONS that borrowed the released resource, incl. across the op's
  own defer drain); superseded/failed builds run their defers once; extraction up front so a rebuild
  during cleanup isn't swept in.
- Rounds 8/11/13/14 built a **resource-cleanup dependency-borrow** (a resource's cleanup borrows its
  dependency closure so a SEPARATELY-released dependency waits for it). This is **beyond ADR 0026 Q2**
  (which scopes the borrow to operations), is deadlock-adjacent across owners, and none of it is in
  the lt2 acceptance list. **Removed** in favor of the simpler depth-order + direct op-borrow. The
  single-cascade case it was meant to cover (releasing a shared node that cascades to a dependent
  whose async cleanup uses a co-released dependency) is handled correctly by the depth-ordered chain
  awaiting each descendant owner's full (incl. async) drain before the ancestor's.
  lt3 progress + a further deferral:

- Q4 realized as **ADR 0027**: `close()` returns a `Result` and never throws (wish is a fallback,
  reality wins, errors in the Result). Built + astra round 1.
- Q5 (cancel-timing) **DECIDED — parent-cancel wins:** `bodyEnd` snapshots `abort.signal.aborted` at
  the instant the body settles, so the body's OWN end reflects whether the BODY was interrupted (a
  clean synchronously-settled value is classified `success`, not flipped by a later abort). BUT the
  layer's final outcome still takes an ancestor cancel via `inheritedEnd`: closing a parent as
  `cancelled` cancels a child session even if its body just returned a value (the child's promise
  rejects with the abort reason). This is structured-concurrency-consistent and needs no new
  mechanism — the r12 live-`inheritedEnd`-re-read already produces it. Matrix now pinned by tests:
  cancel-races-open-child → cancelled ("an ancestor cancel wins over a child session body that already
  returned a value"); child that fully completes+self-closes before any cancel → success kept ("a
  session that completes before any cancel keeps its success"); parked-body-resolves-on-abort →
  cancelled (existing 2425); body rejects abort reason → cancelled (2373/2815); body rejects a REAL
  error → failed wins (2353/2565). The misleading `runBodyFn` comment (implied the body's success was
  the final word) was corrected.
- Q3 (deadlock no-hang): SYNC reentry (a teardown callback that synchronously calls/returns its own or
  an ancestor's `close()`) is handled by the teardown guard (`teardownDepth` + `closeWouldReenter`) and
  gets a best-effort ack, no hang. **Deferred (async self-reentry, close AND release side):** a
  teardown callback that `await`s THEN calls `close()`/`release()` on its own scope can hang, because
  the guard only spans the callback's SYNC part. Attempted fix — hold the guard across the callback's
  async execution — was tried and REVERTED: it makes an EXTERNAL concurrent `close()` during teardown
  return an early ack instead of the real Result (astra lt3 r2), and the release-side variant also
  breaks the release chain (8 tests). Distinguishing an async teardown-internal caller from an external
  one needs async-context tracking (AsyncLocalStorage), which this design deliberately avoids. Since
  awaiting your OWN scope's full close from within its own teardown is circular by construction (the
  callback is part of the close it awaits), we keep the correct external behavior and treat this as a
  documented trap — revisit in lt4 if an ALS-free discriminator emerges.

- Combined review r2 (lazy + close→Result), two P2s, both fixed:
  - r1: a superseded (paused async) build's first lazy dep read registered a stale release edge, so
    releasing that dep later evicted the build's live replacement. Fix: `resolveResourceDeps`'s lazy
    `registerEdge` skips `addDependent` when `superseded()`.
  - r2: `runDefers` (the release-side teardown drain) read a returned thenable's `then` getter
    OUTSIDE its try/catch (`isThenable(pending)` after the catch), so a defer returning a thenable
    whose `then` getter throws lost the teardown error AND leaked an unhandled rejection. Fix: read
    `isThenable` / `Promise.resolve(pending)` INSIDE the try so a throwing getter is collected into
    `layer.secondary`. Regression: "close collects a teardown thenable whose then getter throws".
    (`drainDefers`, the close-side drain, was already safe against a THROWING getter — `await` reads
    `.then` inside its try/catch. See the lt3 final-confirm finding below for a different `drainDefers`
    bug.)

- lt3 final-confirm review (pre-tag), one P2, fixed: `drainDefers` dropped the teardown guard
  (`exitTeardown`) BEFORE `await pending` read the returned thenable's `then` getter. A cleanup/onClose
  returning a thenable whose `then` getter SYNCHRONOUSLY calls `scope.close()` re-entered with the
  guard already down → `closeWouldReenter` was false → the re-entrant close awaited the very close it
  was part of → deadlock. This is a Q3 SYNC-reentry case (in scope; the getter calls close with no
  prior `await`). Fix: normalize the returned thenable (`isThenable` + `Promise.resolve(pending)`,
  which reads the getter) INSIDE the guard span, then `await` outside it — mirrors the `runDefers`
  shape. Regression: "close acknowledges synchronous reentry from a teardown then getter".
- lt3 final-confirm r2 (confirmed the drainDefers fix), one follow-on P2 in the earlier `runDefers`
  fix, fixed: when a cleanup returns a NATIVE promise, `Promise.resolve(pending)` returns that same
  promise (spec short-circuit, no `.then` read), so the explicit `tail.then(onF, onR)` continuation
  attachment did a SECOND `.then` getter read — and that read sat OUTSIDE the teardown try/catch. A
  native promise with an own `then` getter that throws only on the second read lost the error + leaked
  an unhandled rejection. Fix: extract the continuation attachment into `attachRest` and call it INSIDE
  the guarded try, so the `tail.then` read is collected too. (`drainDefers` is unaffected: it `await`s
  the normalized promise, and `await` of a native promise reads no `.then` property getter.)
  Regression: "close collects a native cleanup promise's second then getter throw".
- lt3 final-confirm r3 (fresh reviewer; neutral wording — see [[codex-review-neutral-wording]]), one
  P2, fixed: a parent cancel that arrived WHILE a child session was awaiting its own cleanup was lost.
  `startClose` computed `settled` BEFORE `drainDefers` and returned it unchanged, so a child whose body
  returned a value, then cleaned up (parked on a gate), then had its parent cancel-close during that
  await, resolved `success` instead of `cancelled` — a hole in the Q5 parent-cancel-wins rule. Fix:
  re-derive the outcome from the LIVE `inheritedEnd` AFTER `drainDefers` (extends the r12 re-read past
  the drain); extracted `deriveOutcome` so both the pre-drain end (passed to the cleanups) and the
  post-drain Result use one reducer path (also kept the `run` closure under the complexity cap). A
  settled `failed` is never downgraded (`layer.failure` holds it). `chooseOutcome`/`endedCancelled`
  already treat a cancelled `end` as a cancellation, so no extra flag is needed. Regression: "parent
  cancel cancels a child whose returned body is still cleaning up (Q5)". (A `cancelReason` field to make
  the child report the ancestor's exact reason object was prototyped then REMOVED as
  observationally-irrelevant — cancel reasons are opaque empty brands, deep-equal regardless of
  identity — keeping the fix minimal.)
- lt3 final-confirm r4, one P2 (a REGRESSION from the r3 fix), fixed: the post-drain re-derived
  `finalSettled` was not persisted to `layer.failure`, so a LATE failed close arriving during a
  child's cleanup settled the child failed but a joining parent's `closeChildren` (which reads
  `child.failure`) missed it → parent settled cancelled instead of failed. Fix: move the failure
  persist INTO `deriveOutcome` (called both pre- and post-drain; never clears, so monotonic), which
  also drops a branch from the `run` closure (back under the complexity cap). Regression: "parent
  cancel preserves a child's failed close received during cleanup (Q5)".
- lt3 final-confirm r5 (checklist sweep — see [[astra-review-checklist-first]]): the reviewer
  enumerated a full checklist and found FIVE at once (a 324-case overlap matrix + ~400 controls held).
  Categorized: **F1** = a real, normal-usage lifecycle bug; **F2–F5** = adversarial userland objects
  (a cleanup/body promise whose `then`/`constructor` getter throws or mutates; a reject value that is a
  Proxy whose `has` trap throws). **Policy decision (user): the library does NOT defend against user
  wrongdoing — a caller that returns a hostile thenable/object from a cleanup or body owns the
  consequences.** So only F1 was fixed; F2–F5 are out of scope for v1 (documented; revisit only if a
  real, non-adversarial case surfaces). Consistent with that, the three EARLIER hostile-`then`-getter
  guards added this session (runDefers `attachRest` extraction, drainDefers normalize-in-guard, and
  their tests) were REVERTED — the drains are back to their lt2 shape — since they defended the same
  disclaimed class. `close()`'s "never throws" (ADR 0027) and "cleanups always run" hold for
  WELL-BEHAVED values.
  - **F1 (fixed)** — a manual child that finishes and DETACHES (`finishLayer`) while its parent awaits
    its body was missed by `closeChildren` (which snapshotted `layer.children` only AFTER the body
    wait), so the child's failure + teardown errors never reached the joining parent (parent settled
    cancelled instead of failed). Fix: capture the children at close START (before the body wait) into
    a `cascade` set; `closeChildren` closes `cascade ∪ current` — a `closeLayer` on an already-settled
    detached child returns its owned Result, so its failure/errors are still collected. Regression:
    "close keeps a child's failure and cleanup error while waiting for its parent's body (Q5)".
- lt3 final-confirm r6: the direct-child cascade fix was confirmed but a GRANDCHILD one level deeper
  still escaped — a leaf that finishes+detaches while a top ancestor awaits its body is gone before the
  MIDDLE scope starts closing and snapshots its (now-empty) children. Two real bugs from the same
  collection path (direct child, then grandchild) → **converged the collection model** rather than
  patch depth-by-depth: `abortSubtree` marks every swept descendant; `finishLayer` PUSHES a swept
  layer's teardown errors + failure UP to its parent as it detaches; `closeChildren` now only DRIVES
  currently-attached children (no cascade, no pull, no `childFailure` return). Contributions bubble to
  any depth in O(1) per finish (no chain walk), and a unit that fails INDEPENDENTLY (no ancestor
  sweeping it) does not propagate. Removed the `cascade` snapshot and simplified `deriveOutcome`
  (failures now arrive via the push). Regressions: "close keeps a grandchild's failure while its
  ancestor awaits its body (Q5)" (manual and session-body variants).
- lt3 final-confirm r7: the push-up model was confirmed but a child CREATED after the sweep started
  `swept: false`, so a unit born under a swept (aborting) parent during an ancestor's body wait didn't
  push up and was lost. This is a gap in the same model, not a new class — `swept` just needed to be
  inherited at birth. Fix: in `makeLayer`, a child born under an already-aborted (swept, not-yet-closed
  — creation under a closed scope is blocked by `ensureOpen`) parent inherits `swept = true`. So the
  swept mark now covers BOTH descendants present at the sweep (abortSubtree) AND descendants born into
  the subtree afterward. Regressions: "close collects a child born and finished during its ancestor's
  body wait (Q5)" (manual + session variants). The reviewer also confirmed independent-failure
  isolation and exact-once ordered collection through 64 levels hold.
- lt3 final-confirm r8: a precedence REGRESSION from the push model — pushing a child's failure into
  the parent's OWN failure slot (`parent.failure ??=`) let a child's INHERITED wished `failed` (the
  parent's own close request echoed down and back up) pre-empt the parent's REAL owned-work failure,
  breaking "a real owned-work failure beats a wished outcome." The pre-push code ranked own before
  child (`layer.failure ?? childFailure`); the merge collapsed that. Fix: push descendant failures into
  a SEPARATE `descendantFailure` slot ranked BELOW the layer's own failure; `deriveOutcome` uses
  `layer.failure ?? layer.descendantFailure`. So the parent's real op failure wins over a child's
  inherited wish. Regression: "a child's inherited failed wish does not replace its parent's real
  operation failure". The reviewer confirmed 400 prior cases + 42 new controls (deep collection,
  independent-failure isolation, exact-once, failure-vs-late-cancel) hold.

- **Reclassified to lt4** (ordering-only races — cleanups all run exactly once; only their ORDER can
  be off, same class as the lt4 teardown-error-ordering deferral): ordering a resource-cleanup against
  a dependency released by a SEPARATE later `release()` call (two independent teardown operations); AND
  ordering a **superseded build's late cleanup** (a dependent still mid-(async-)build when its
  dependency is released registers its `defer` after the release cascade already extracted defers, so
  it drains in a separate chain). Neither is required by ADR 0026 for lt2 (invariant 1 presupposes a
  BUILT dependent with a registered defer). The op-borrow still keeps the dependency open while the
  borrowing op runs; only the two cleanups' relative order in this race is unspecified. lt3's decided
  scope (Q3 sync-reentry ack, Q4 close→Result, Q5 cancel-timing) is complete; these + async
  self-reentry are the lt4 backlog.

lt3 REDESIGN — `close()` is a shutdown MODE, not a wished outcome (ADR 0028, supersedes 0027's wish):

- After nine rounds all circling "tell a real failure from an inherited wish," the user cut the root:
  **nobody wishes a lifetime to fail; a caller chooses HOW to shut down (graceful vs forced), and the
  Result reports reality.** `close(opts?: { graceful?: boolean })` — default FORCED (abort `ctx.signal`,
  stop work now → failed/cancelled/success, never hangs); `graceful` lets in-flight work finish →
  failed/success. No `close({cancelled})` / `close({failed})`.
- The settlement reducer is REALITY-ONLY: failed (body threw / owned-work rejected / descendant really
  failed, bubbled) > cancelled (this layer's body was interrupted) > success. This DELETES the whole
  wish/severity machinery — `inheritedEnd`, `moreSevere`, `severity`, `endedCancelled`,
  `chooseOutcome`'s wish branch, `closeLayer`'s r13 more-severe merge, `deriveOutcome`'s wish wiring
  — the class of bugs vanishes by construction. `abortSubtree`→`sweepSubtree(root, force)` (mark swept
  always, abort only when forced). Cancellation is a SESSION concept (an interrupted body); a bare
  scope's forced close is `success` unless real work failed.
- The swept push-up collection (F1/grandchild/late-child) is KEPT: a real descendant failure still
  bubbles into `descendantFailure` (below the layer's own failure). But the multi-child inherited-wish
  precedence bug (round 9) is MOOT — there are no wished failures to bubble.
- Resource commit/rollback (user decision — Model B, POSIX-shaped): a resource's `defer` end follows
  the shutdown mode — a FORCED close settles `cancelled` (a session with an interrupted body OR a
  bodyless scope), so resources roll back; a GRACEFUL close settles `success` and commits. A
  failing/forced ancestor force-cascades down, so nested resources roll back (transaction-abort). A
  session whose body completed stays `success`. One line in `startClose`:
  `if (body ? body.status === "cancelled" : force) layer.cancelled = true`.
- Status: src rewritten + engine SHRANK (~15.0 → 14.9 KB gzip after deleting the wish machinery);
  ~40 wish-era tests migrated (12 obsolete deleted, 17 rewritten to source failures from real throwing
  work, bare-scope force closes → cancelled).
- Redesign review (partial — codex asked clarifying questions the permission channel couldn't answer in
  this env, so it was cancelled after its final report; see [[paseo-permission-response-broken]]). Three
  real findings, all fixed:
  - **A (graceful→forced escalation lost the mode):** DROPPED escalation for v1 — a second/later close
    returns the in-flight close's Result (first call's mode wins), so a session's auto self-close never
    overrides an in-progress explicit graceful close. Escalation (SIGTERM→SIGKILL) deferred to lt4.
  - **B (a failing scope committed a child resource under a graceful close):** a FAILING layer now
    force-closes its children so nested resources roll back even in graceful mode —
    `closeChildren(layer, force || body?.status === "failed" || layer.failure !== undefined)`. Regression:
    "a graceful close still force-rolls-back children when the scope already failed". (An owned-work
    failure surfacing only AFTER the child cascade is an ordering edge — lt4.)
  - **C (parent collected a child's caught owned-work error, not its winning body error):** a body
    failure is the PRIMARY cause and now OVERRIDES `layer.failure` (`= { cause: body.error }`, not
    `??=`), so the pushed-up cause matches the child's own reported cause. Regression: "a collecting
    parent gets a child's winning body failure, not its caught owned-work error".
  - Q1 (forced close joins pending work → can it hang?): cooperative cancellation is a precondition
    (JS cannot force-kill a promise; ignoring the abort is the caller's bug); ADR 0028 "never hangs"
    wording corrected.
- Fresh no-questions review, three more timing/mode findings, all fixed:
  - **1 (swept-marking too late):** a child that detached between `close()` and the (async) sweep was
    missed. Fix: split `sweepSubtree` into `markSwept` (SYNCHRONOUS at call time, mode-independent — for
    collection) and `abortSubtree` (in the async body — so a just-settled body is not flipped to
    cancelled by a later forced close). Regression: "a child still closing when its parent close is
    called is collected" (graceful + forced).
  - **2 (descendant failure didn't force the cascade):** `rollsBack` now includes `descendantFailure`,
    AND `closeChildren` re-checks per child — once an EARLIER child's failure is collected, the
    remaining children close forced so their resources roll back. Regressions: "a descendant failure
    known before the cascade rolls back the remaining child"; "a failure collected from an earlier
    child rolls back the next child".
  - **3 (ancestor abort ignored by a child's own graceful close):** `forced = force ||
layer.abort.signal.aborted` — a layer already aborted by an ancestor's forced close is force-torn
    down whatever its own close mode. Regression: "a first graceful child close after an ancestor abort
    still rolls its resource back".
  - Verified: all 81 of the reviewer's `/tmp` repros pass; gate green (check, core 185, root 191,
    census, size 15.1 KB).
- Status: redesign complete + fully green; mutation + a final confirm review pending before tag.

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

## lt4 — accepted limitations

The deferred edges above are consolidated as accepted v1 boundaries in
**ADR 0029 (teardown v1: accepted limitations)** — no escalation, own-owned-work-after-cascade,
async self-reentry trap, cooperative-cancellation precondition, unspecified teardown ORDER,
adversarial userland objects, async dep-cycle-after-await. Each preserves the headline guarantees;
promote any to a fix if a real (non-adversarial) case hits it.

## Next (historical)

- astra redesign guideline (agent dd5b5c47) → model + algorithm + open questions + ticket breakdown.
- Grill the open questions → redesign ADR (supersedes the impl consequences of 0024; keeps its API).
- to-tickets in `PROGRESS.md`; build each to astra-clean via the gate.
