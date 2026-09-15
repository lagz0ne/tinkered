# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.
Core ticket detail + reset recipes: `docs/roadmap/core-v1/PROGRESS.md`.

## Now

- [x] core/t19 — v1 validation milestone: ALL budget lanes green together (ADR 0016). Release gate
      `pnpm validate` (`scripts/validate.mjs`) — a seeded regression fails it. Numbers recorded in
      `docs/roadmap/core-v1/budgets.md`: size 15.1 KB, promises 0/5, heap 3.9 KB/req, mutation 77.45%,
      complexity 8, CRAP 8.73, cast-free examples, pure universal bundle, deep chains 10k+ safe. No src
      change (engine carries lt3's CONFIRM-CLEAN review); t19 is validation infra + docs. Tagged
      `core/t19`. **core v1 COMPLETE.** Original slice plan (all done):
  1. **Promise budget** (deterministic, no clock): count Promise allocations on the SYNC lane
     (data read/write/flush + sync resolve/build) → assert **0**; and on a representative async toggle
     → assert **≤10**. `bench/promises.mjs`, runnable via `node`. Verify: script exits 0.
  2. **Deep-chain ceiling** (deterministic): sync resource chain + deeply nested sessions
     (`flushTree`/`closeChildren`) don't overflow. `bench/deep.mjs`. Verify: runs, no RangeError.
  3. **Both entries**: engine is import/global pure; confirm the built bundle works for BOTH node and
     browser (build both targets, no node-only refs). Verify: builds pass; a purity assertion.
  4. **Cast-free examples**: a few `examples/*.ts` using the public API with NO `as`/casts; typecheck
     clean. Verify: `vp check` on examples clean, 0 casts (census).
  5. **CRAP ceiling**: complexity (oxlint ≤8) × coverage → a CRAP ceiling check; cut complexity where
     flagged. Verify: a `scripts/check-crap.mjs` (or documented ceiling from comp≤8 + coverage) passes.
  6. **Heap-per-request** (wall-clock/gc → BUILD only): `bench/heap.mjs` (`--expose-gc`), target a few
     KB. Run via `bench` outside the container; record the number in the ticket.
  7. **Release gate + record + review + tag**: a single `validate` script runs all deterministic lanes
     (size, promises, deep, entries, cast-free, crap) + `vp run core#test` + mutation; record concrete
     thresholds; astra CONFIRM-CLEAN; tag `core/t19`. Verify: gate green; a seeded regression fails it.

- [x] core/lt4 — prove the contract + budgets + accepted limitations (final teardown ticket). DONE:
      docs-only (no source change since `core/lt3` — the redesign already removed the old paths, no dead
      code); glossary + doc refs refreshed to the shutdown-mode model; ADR 0029 (accepted v1 limits);
      contract seam audit (every live guarantee has a test); budgets green (size 15.1 KB, mutation
      77.45%). Verify: `vp check` clean, core 185 / root 191, size < 30 KB, code carried lt3's CONFIRM
      CLEAN. Tagged `core/lt4`. Original slice plan (now all done):
  1. **Cleanup + doc refs**: no dead code (confirmed — the redesign removed the wish paths cleanly);
     update stale refs to the removed wish model in the glossary + ADR 0011/0017/0024/0026 headers so
     they point at ADR 0028's shutdown-mode / reality-reducer. Verify: `vp check` clean + grep shows no
     "wished outcome"/`inheritedEnd`/`moreSevere` references outside historical ledger/round-notes.
  2. **Limitations ADR** (0029): consolidate the deferred edges as ACCEPTED v1 limitations with
     rationale — graceful→forced escalation (forced default already avoids hangs; JS can't force-kill);
     a layer's OWN owned-work failure surfacing AFTER its child cascade (children close first, ADR 0026);
     async self-reentry (needs ALS, which the design avoids); separate-release + superseded mid-build
     ordering; async dep-cycle-after-await; cross-owner teardown-error ORDER. Each: what holds vs what's
     unspecified, and why it's safe for v1. Verify: ADR written + linked from the ledger.
  3. **Contract seam audit**: map each STILL-LIVE ledger guarantee to a deterministic public-seam test;
     add any gap (close never throws; reality reducer failed>cancelled>success; commit/rollback matrix;
     descendant collection at depth; cancellation via signal; deep chains; streaming). Verify: gate green.
  4. **Budgets + review + tag**: size (<30 KB) + mutation green together; astra CONFIRM-CLEAN on the
     whole teardown subsystem (lt1–lt4); then tag `core/lt4`.

- [x] core/lt3 — teardown cancel/deadlock/state + the `close()` REDESIGN. Lazy resource building; Q4
      (ADR 0027, close returns a Result never throws); Q5 cancel-timing; then the big pivot: **Q — close
      is a shutdown MODE, not a wished outcome** (ADR 0028). `close(opts?: { graceful?: boolean })` —
      forced (default) aborts + rolls resources back (cancelled), graceful commits (success); reality-only
      reducer (failed > cancelled > success); the wish/severity machinery (`inheritedEnd`, `moreSevere`,
      `severity`, `chooseOutcome` wish branch, r13) DELETED. Real-descendant-failure push-up collection
      kept + hardened.
  - Verified: gate green — `vp check` 0 errors, core 185, root 191, strict census, size 15.1 KB gzip,
    mutation 77.45%. Reviewed to CONFIRM CLEAN (204 scratch cases) after two rounds / 6 timing-mode
    findings all fixed + regression-tested. Design in ADR 0027 + 0028; ledger `teardown-redesign.md`.
    Ready to tag `core/lt3`.
  - Reclassified to lt4 (documented in `teardown-redesign.md`): graceful→forced escalation
    (SIGTERM→SIGKILL); a layer's OWN owned-work failure surfacing only AFTER its child cascade;
    async self-reentry; separate-release + superseded mid-build ordering; async dep-cycle-after-await.
    Hostile/adversarial userland objects are out of scope for v1 (user policy; ADR 0027 scope note).

- [ ] teardown/lifetime REDESIGN (umbrella) — converged API `ctx.defer(end)` + `ctx.signal` (ADR 0024)
      with teardown as reverse-registration LIFO (ADR 0026). Tracked as core/lt1–lt4 in PROGRESS.md;
      failure ledger in `docs/roadmap/core-v1/teardown-redesign.md`.
  - lt1 DONE (`core/lt1`): converged ctx + reverse-registration close; literal settlement reducer;
    branded cancel reasons; concurrent-close severity/inheritedEnd correctness. 14 astra rounds.
  - lt2 DONE (`core/lt2`): release via reverse-registration drain + depth-ordered cross-owner chain +
    direct op-borrow (ADR Q2). A rounds-8–14 resource-cleanup dep-borrow was found beyond-spec +
    deadlock-prone and REMOVED (simplified; code shrank). Timing-race ordering deferred to lt3.
  - Remaining: lt3 (cancel/deadlock/state + deferred timing races) → lt4 (prove contract + remove any
    dead two-phase paths + budgets).
  - Verify: each lt ticket lands green (`scripts/ticket.sh`) + astra-clean; bug-ledger classes covered.

## Next (roadmap, in order)

- [ ] core/t19 — v1 validation milestone
  - Verify: all budget lanes green together (size, promises, heap, mutation, CRAP, both entries, cast-free examples).

## Done

- [x] Final lt3 descendant-failure precedence review — prior own-work precedence fix
      confirmed; one P2 remains: a first child's inherited failed wish occupies
      `descendantFailure`, blocking a later child's real failure from reaching the parent.
  - Verified: `/tmp/lt3-descendant-confirm/README.md`; minimal repro and manual/session
    variants at two and three levels fail. All 445 prior cases and 670 new controls pass,
    including 664 chain precedence combinations, exact-once errors, independent-failure
    isolation, Q5, and own body/work precedence. Core 190/190, root 196/196,
    `vp check` passes (2 warnings), strict census clean. No repo library/test edits.
    Next author action: retain real-failure versus requested-outcome priority between children.

- [x] FIX lt3 failure precedence — the push model pushed a child's failure into the parent's OWN slot,
      letting a child's inherited wished `failed` pre-empt the parent's REAL owned-work failure (broke
      "real failure beats wish"). Fix: descendant failures go to a SEPARATE `descendantFailure` slot
      ranked BELOW own; `deriveOutcome` uses `layer.failure ?? layer.descendantFailure` (restores the
      pre-push own>descendant precedence).
  - Verified: regression "a child's inherited failed wish does not replace its parent's real operation
    failure" FAILS with the push aimed at the own slot and PASSES with the separate slot. Gate: `vp
check` 0 errors, core 190/190, root 196/196, census clean, size 15.0 KB gzip; mutation isolated.

- [x] Final lt3 inherited-sweep review — late-child fix confirmed; one P2 remains:
      a child's inherited failed wish is pushed into the parent's primary failure
      slot, preventing a later real owned operation failure from winning.
  - Verified: `/tmp/lt3-inherited-confirm/README.md`; minimal repro plus manual/session
    variants fail. All 400 prior cases and 42 new controls pass, including deep
    present/late-born collection, independent-failure isolation, exact-once errors,
    Q5, and real failure versus late cancel. Core 189/189, root 195/195,
    `vp check` passes (2 warnings), strict census clean. No repo library/test edits.
    Next author action: preserve real-failure versus wish precedence when pushing results.

- [x] FIX lt3 late-child collection — completed the push-up model: a child CREATED after the ancestor
      sweep started `swept: false` and didn't push up. Fix: in `makeLayer`, a child born under an
      already-aborted (swept, not-yet-closed) parent inherits `swept = true`. Now the swept mark covers
      descendants present at the sweep AND those born into the subtree afterward.
  - Verified: regressions "close collects a child born and finished during its ancestor's body wait
    (Q5)" (manual + session) FAIL with the inheritance disabled and PASS with it; full suite green.
    Gate: `vp check` 0 errors, core 189/189, root 195/195, census clean, size 14.9 KB gzip; mutation
    running isolated.

- [x] Final lt3 swept-collection review — prior grandchild fix confirmed; one P2 remains:
      a child created after the ancestor sweep keeps `swept: false`, so if it finishes
      during the ancestor's body wait its failure and cleanup errors are lost.
  - Verified: `/tmp/lt3-swept-confirm/README.md`; deterministic manual/session repros
    both fail. All 374 prior controls pass. All 24 new controls pass, covering
    independent-failure isolation and exact-once ordered collection through 64 levels.
    Core 187/187, root 193/193, `vp check` passes (2 warnings), strict census clean.
    No repo library/test edits. Next author action: include children created under an
    active ancestor close in collection while preserving independent-failure isolation.

- [x] FIX lt3 grandchild collection — converged the collection model (was: direct-child cascade only).
      A grandchild that finishes+detaches while a top ancestor awaits its body was lost before the
      middle scope closed. Fix: `abortSubtree` marks swept descendants; `finishLayer` PUSHES a swept
      layer's teardown errors + failure to its parent as it detaches (bubbles to any depth, O(1));
      `closeChildren` only drives attached children (removed the cascade snapshot, the pull, and the
      `childFailure` plumbing; `deriveOutcome` simplified). A unit that fails independently (no ancestor
      sweep) does not propagate.
  - Verified: regressions "close keeps a grandchild's failure while its ancestor awaits its body (Q5)"
    (manual + session variants) FAIL with the swept-push disabled (root cancelled, errors lost) and
    PASS with it; direct-child F1 still passes. Gate: `vp check` 0 errors, core 187/187, root 193/193,
    census clean, size 14.8 KB gzip; mutation running isolated.

- [x] Final lt3 cascade review — direct-child F1 fix confirmed; one P2 remains one
      level deeper: a grandchild can finish and detach while an ancestor awaits its
      body, before the middle scope starts closing and snapshots its own children.
      The ancestor then loses the grandchild's failure and cleanup errors.
  - Verified: `/tmp/lt3-cascade-confirm/README.md`; two deterministic failures for
    manual/session grandchildren, using only ordinary promises and Errors. All 372
    controls pass, including the original F1, 324-case overlap matrix, cascade/current
    deduplication, awaited child order, Q5, precedence, and lazy/release controls.
    Core 185/185, root 191/191, `vp check` passes (2 warnings), strict census clean.
    No repo library/test edits. Next author action: retain descendant Results for an
    active ancestor close even before the intermediate scopes start their own close.

- [x] FIX lt3 sweep — F1 fixed; F2–F5 out of scope (user policy: don't defend against user wrongdoing).
      F1 (real): a manual child that finishes+detaches during its parent's body wait lost its failure +
      teardown errors (parent settled cancelled instead of failed). Fix: capture children at close
      START into a `cascade` set; `closeChildren` closes `cascade ∪ current`. F2–F5 all need adversarial
      userland objects (hostile `then`/`constructor` getters; a Proxy reject value with a throwing `has`
      trap) — not defended in v1 (see ledger + ADR 0027 scope note). Consistent with that, the 3 earlier
      hostile-`then`-getter guards this session were REVERTED (drains back to lt2 shape).
  - Verified: regression "close keeps a child's failure and cleanup error while waiting for its
    parent's body (Q5)" FAILS on the pre-fix code (root cancelled, no teardownErrors) and PASSES now.
    Gate: `vp check` 0 errors, core 185/185, root 191/191, census clean, size 14.7 KB gzip; mutation
    running isolated.

- [x] Complete lt3 teardown sweep — all 19 checklist items reviewed; both previous fixes
      confirmed. Five P2s: child detach during parent body wait loses failure/errors;
      await can reread native cleanup `then` outside the guard; native rejection unowned
      after getter failure; session-body native getter failure skips cleanup; cancel-brand
      inspection of a thrown Proxy can reject close or lose an owned failure.
  - Verified: `/tmp/lt3-complete-sweep/README.md` maps every checklist item to its result,
    with minimal public-entry repros. Scratch suite: 402 pass, 7 fail across five defect
    classes, plus 3 unhandled rejections proving two classes. Core 187/187, root 193/193,
    `vp check` passes (7 warnings), strict census clean. No repo library/test edits.
    Next author action: address the five listed defects and rerun the complete scratch sweep.

- [x] Teardown correctness follow-up — previous cancel fix confirmed; one P2 remains:
      a failed close received during child cleanup reaches its final Result but is not
      saved in `layer.failure`, so a joining parent's `closeChildren` misses the failure.
  - Verified: `/tmp/teardown-followup-review/late-failure.test.ts` fails (child failed,
    parent cancelled); storing the final failure in a `/tmp` source copy makes it pass.
    Prior 6 probes and 17 new timing/failure/error controls pass on current source.
    Core 186/186, root 192/192, `vp check` passes (7 warnings), strict census clean.
    No repo library or test edits. Next author action: persist a final failed outcome
    before returning the Result so parents can collect it.

- [x] FIX teardown-correctness P2 — parent cancel during a child's awaited cleanup left the child
      session successful. `startClose` computed `settled` before `drainDefers` and returned it
      unchanged. Fix: re-derive the outcome from live `inheritedEnd` AFTER the drain (extract
      `deriveOutcome`, used pre- and post-drain; keeps the closure under the complexity cap). A prototyped
      `cancelReason` field was removed as observationally-irrelevant (cancel reasons are opaque brands).
  - Verified: regression "parent cancel cancels a child whose returned body is still cleaning up (Q5)"
    FAILS on the pre-fix code (child resolves {success,42}) and PASSES with the fix. Gate: `vp check`
    0 errors, core 186/186, root 192/192, census clean, size 14.6 KB gzip.

- [x] Teardown correctness review — P2: parent cancel during a child's awaited cleanup
      leaves the child session successful. `startClose` saves `settled` before the drain
      and uses it after the drain without rereading the inherited cancel.
  - Verified: `/tmp/teardown-correctness-review/cancel-during-cleanup.test.ts` fails
    deterministically (expected cancelled; received success with value 42). Five drain,
    error-collection, reentry, and completed-child controls pass. Core 185/185, root
    191/191, `vp check` passes (7 warnings), strict census clean. No library or repo
    test edits. Next author action: apply late ancestor cancellation to the final Result.

- [x] FIX combined-review-r2 P2 — `runDefers` read a returned thenable's `then` getter OUTSIDE its
      try/catch, so a defer returning a thenable whose `then` getter throws lost the teardown error +
      leaked an unhandled rejection. Fix: read `isThenable` / `Promise.resolve(pending)` inside the try.
  - Verified: regression test "close collects a teardown thenable whose then getter throws" FAILS on
    the buggy version (missing `teardownErrors` + the exact unhandled rejection) and PASSES with the
    fix. Gate: `vp check` 0 errors, core 181/181, root 187/187, census clean, size 14.1 KB gzip.
    (`drainDefers`, the close-side drain, was already safe — reads `.then` via `await` inside try.)

- [x] Combined lazy + close Result review round 2 — generation guard confirmed; one P2:
      an operation defer's throwing `then` getter escapes `runDefers`' catch
      (`packages/core/src/index.ts:952`), losing the teardown error from the close Result.
  - Verified: `/tmp/lazy-lt3-review-r2/thenable-close.test.ts` fails with missing `teardownErrors`
    and an unhandled rejection. Moving the getter check inside the catch in a `/tmp` source copy
    makes all 14 probes pass. Both current-edge cases fail if lazy edges are suppressed; stale-edge
    fails if the generation guard is removed. Required check and core suite 180/180 pass;
    root suite 186/186 and strict census pass. No library or repository test edits.
    Next author action: contain returned-thenable inspection in the teardown error boundary.

- [x] Combined lazy + close Result review — P2: a superseded build's first lazy access registers
      a stale release edge against its live replacement (`packages/core/src/index.ts:1117–1119`).
  - Verified: `/tmp/lazy-lt3-review/stale-edge.test.ts` fails (expected generation 2, got 3).
    A generation guard in a `/tmp` source copy makes it pass. No teardown callbacks in the repro;
    this is cache invalidation, not a deferred cleanup-order race.
    Ten focused lazy/close/release/session controls pass; `vp check` passes (two existing warnings),
    core suite 179/179, root suite 185/185, strict style census clean. No library/test edits.
    Review complete; next author action: bind lazy edge registration to the build generation.

- [x] lt3 slice 1 review, round 2 — P1: external concurrent close during an awaited close defer
      gets an early ack with missing teardown errors (`packages/core/src/index.ts:1556,1640`).
  - Verified: `/tmp/lt3-review-r2/concurrent-close.test.ts` fails; true async reentry control passes.
    Restoring only the old guard span in a `/tmp` source copy makes the external-close probe pass.
    Plain Node `/tmp/lt3-review-r2/direct.mts` confirms early ack before the hook is released.
    Core suite 177/177 and root suite 183/183 pass; strict style census clean.
    `vp check` exits 1 on existing formatting in `docs/roadmap/core-v1/teardown-redesign.md`.
    Review complete; next author action: distinguish external close from async teardown reentry.
    No library/test edits and no deferred release-side or ordering findings.

- [x] lt3 slice 1 review — async teardown re-entry deadlock at
      `packages/core/src/index.ts:1562,1650`; also reproduced on `core/lt2`.
  - Verified: `/tmp/lt3-review-r1/reentry.test.ts` synchronous control passes; after-await probe
    times out. `vp check` exits 0 (two existing warnings), core tests 176/176, root tests 182/182,
    strict style census clean. No library/test edits; fix left to the author.

- [x] core/lt2 — release via the reverse-registration drain (diamonds), cross-owner order by depth
      (descendants first, chained awaiting each descendant owner's full async drain), direct op-borrow
      (ADR 0026 Q2: release waits for in-flight operations borrowing the resource, across the op body +
      its own defers), defers extracted up front, superseded builds drain once.
  - Verified: gate green — `vp check`, 172 core tests, strict census, size ~13.1 KB, mutation 77.33%;
    tag `core/lt2`. 15 astra rounds; a rounds-8–14 resource-cleanup dependency-borrow (beyond ADR Q2,
    deadlock-prone) was removed in a mid-course simplification (engine shrank ~1.2 KB). Two build/
    release timing-race ordering edges deferred to lt3 (see `teardown-redesign.md`).

- [x] core/lt1 — converged `ctx.defer(end)` + `ctx.signal` (replaces `cleanup`/`onOutcome`);
      `Scope.Outcome += cancelled`; close drains one per-layer defer list in reverse registration order
      (LIFO, onClose is a defer), sequential + awaited, children-first; settlement = ADR 0026/0025 §4
      reducer applied literally; branded cancel reasons; parent→child abort chaining; cancelled session
      rejects with the abort reason.
  - Verified: gate green — `vp check`, 158 core tests, strict census, size 10808 B, mutation 76.91%;
    tag `core/lt1`. 14 astra rounds (ledger `teardown-redesign.md`): rounds 7–9 removed an unsound
    "own vs propagated" distinction (provenance by error value is impossible); rounds 10–13 fixed
    concurrent/overlapping-close propagation (severity merge, branded reasons, live inheritedEnd read,
    already-closing child adopts a more-severe outcome); round 14 CONFIRM CLEAN (768-case matrix).

- [x] core/lifetime-design — proposed guideline in `docs/decisions/0025-teardown-redesign-guideline.md`.
  - Verified: model, six-invariant coverage, unified algorithm, bug-class map, six open decisions,
    and five sequenced ticket drafts are present; all document links resolve. No implementation edits.

- [x] core/tag-meta — static metadata on every unit (ADR 0023): `meta: [someTag(v)]` on data/operation/resource/tag (incl. a tag itself), read via `handle.meta` or `tag.read(unit)`; inert (never affects resolution)
  - Verified: gate green (check + 128 tests + size 8232 B + mutation 77.00% core); tag `core/tag-meta`. Astra: 1 bug (shared mutable empty-meta array leaked across units) — fixed by freezing the sentinel (`Object.freeze([])`, allowed by the user), census S15 narrowed to permit an empty-literal freeze while still flagging value-freezing; regression test added.
- [x] core/t18 — resource presets (ADR 0015): `preset(resource, factory)` swaps the factory only for downstream consumers; same deps/caching/generation/teardown; async path included
  - Verified: gate green (check + 124 tests + size 7945 B + mutation exit 0 ~76.5% core); tag `core/t18`. Astra: 2 type-precision gaps — silent-any preset deps (fixed → `Record<string, unknown>`, reproduced+verified, narrowing test added) and a `void`-resource accepting an async preset (documented TS limitation; void resources are an anti-pattern). Census hardened to skip `.stryker-tmp`. **Presets line (t17+t18) complete.**
- [x] core/subflow — invocation object (ADR 0022, refines 0020): a bare op / command controller is always a callable; `resolve({ input?, rawInput?, tags? })` — defined `input` wins, `rawInput` is parsed, `tags` overlay the caller's ambient bindings for that one call (not into resources or nested subflows)
  - Verified: gate green (check + 119 tests + size 7916 B + mutation 76.48% core); tag `core/subflow`. Astra: 2 type holes found (undefined-input→NaN; `never`→optional arg), both fixed (runtime + `CallArgs` conditional) with regression tests; second focused pass CLEAN.
- [x] core/t17 — data/command presets (ADR 0015): `preset(dataCell, value)` (parse-validated) and `preset(command, run)`, downstream-only, cleared on close
  - Verified: gate green (check + 113 tests + size 7750 B + mutation 76.47% core); tag `core/t17`. Astra found no preset-runtime bugs; 2 census-regex bugs (S16 missed `preset<T>(`/`preset (`, flagged strings/comments) fixed + `style-census.selftest.sh` regression added. Resource-preset overload deferred to t18.
- [x] core/t07..t11 — structured close, sync/async resources, targets, outcome+session(fn)
  - Verified: tags `core/t07`..`core/t11` exist; each landed via a green `scripts/ticket.sh`.
- [x] core/t12 — single-node release (release resource → cleanup + rebuild; release data → reset; per-resource generation guard)
  - Verified: gate green (check + all tests 79 core + size 5036 B + mutation 79.81% core); tag `core/t12` (commit ca3793b). 6 astra rounds; final one-line `ensureOpen(owner)` guard landed on the reviewer's exact prescription + regression test (no 6th full round for a one-liner).
- [x] dep-model — subflows + resource deps (ADR 0020): bare op = subflow controller, bare resource = instance
  - Verified: gate green (check + all tests 80 core + size 5021 B + mutation 80.34% core); tag `core/dep-model` (commit 93443ca); astra clean after one prescribed P2 fix (required subflow input signature). `operation.controller` kept for now (removal deferred).
- [x] core/t13 — release cascade within one owner: reverse edges; two-phase iterative cascade (caches-first, then callbacks); diamond exactly-once; failed builds detach edges
  - Verified: gate green (check + all tests 87 core + size 5917 B + mutation 76.82% core); tag `core/t13` (commit bc8487c); astra CONFIRMED CLEAN after 2 rounds (5 bugs total, each regression-tested).
- [x] core/t14 — release cascade across owners: subtree search for scope nodes, owner-only for session; per-(node,owner) dedup; skip closing owners; per-layer teardown-depth close-reentry guard
  - Verified: gate green (check + all tests 94 core + size 6657 B + mutation 78.18% core); tag `core/t14` (commit 1754727); astra CONFIRMED CLEAN after 3 rounds (7 bugs total, each regression-tested). **Release subsystem (t12–t14) complete.**
- [x] core/t15 — command / manual observation: behavior-neutral auto operation spans, explicit parent threading (no ALS), ctx.obs.child/event, ctx.log, isolated sinks, independent toggles, bounded history, off-is-free
  - Verified: gate green (check + all tests 105 core + size 7420 B + mutation 76.61% core); tag `core/t15` (commit 923e9af); 3 astra rounds (9 bugs, mostly behavior-neutrality — identity/lazy-thenable/sink-isolation — each regression-tested). Final prescribed one-liner landed on gate + astra probe.
- [x] core/t16 — resource observation: build spans linked to the caller (cross-owner), `used` edge per resolve, balanced async spans, value identity preserved (no proxy)
  - Verified: gate green (check + all tests 108 core + size 7505 B + mutation 76.31% core); tag `core/t16` (commit 6ef84b5); astra CLEAN on first review. **Observation subsystem (t15–t16) complete.**
