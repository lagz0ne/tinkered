# core v1 — build progress

One green git checkpoint per ticket. Progress is linear and resettable: land tickets
in order, tag each, reset to any tag if a slice goes wrong.

- **Tickets:** `docs/roadmap/core-v1/issues/NN-*.md` (numbered in dependency order).
- **Decisions:** `docs/decisions/0009`–`0018`. **Glossary:** `docs/glossary.md`.
- **Branch:** `core-rebuild`. **Baseline:** tag `core/base` (design only, no code yet).

## How a ticket lands (deterministic + correct)

1. Build the slice + its scope-seam behavior tests (no mocks; deterministic handshakes, no sleeps).
2. Gate + checkpoint:

   ```bash
   scripts/ticket.sh <NN> "<short title>"
   ```

   The gate runs `vp check` + `vp run -r test` (+ `mutate`/size where wired). It commits
   only if green, then sets tag `core/t<NN>`. A red gate makes no checkpoint.

## Reset (git techniques)

- Undo the current (unlanded) work: `git reset --hard core/t<last>` (or `core/base`).
- Redo a landed ticket: `git reset --hard core/t<blocker>`, rebuild, re-run the gate.
- Inspect a checkpoint: `git switch --detach core/t07`.

## Order & status

Linear order (each ticket's blockers are all lower-numbered). Mark `x` when its tag exists.

- **core/t01** — Packaged scope + data read
  blockers: —
  status: [x]
- **core/t02** — data write + watch
  blockers: 01
  status: [x]
- **core/t03** — Sync commands (incl. effects)
  blockers: 02
  status: [x]
- **core/t04** — Scope tags, all modes
  blockers: 03
  status: [x]
- **core/t05** — Async commands + work ownership
  blockers: 03
  status: [x]
- **core/t06** — Sessions + inheritance + copy-on-write
  blockers: 04
  status: [x]
- **core/t07** — Structured close + onClose
  blockers: 05, 06
  status: [x]
- **core/t08** — Sync scope resources + cleanup
  blockers: 07
  status: [x]
- **core/t09** — Async resource builds + close
  blockers: 08
  status: [x]
- **core/t10** — Resource targets + owner-context
  blockers: 08
  status: [x]
- **core/t11** — Outcome hooks + session(fn)
  blockers: 09, 10
  status: [x]
- **core/t12** — Single-node release
  blockers: 09, 10
  status: [x]
- **core/t13** — Release cascade within owner
  blockers: 12
  status: [x]
- **core/t14** — Release cascade across owners
  blockers: 13
  status: [x]
- **core/t15** — Command / manual observation
  blockers: 07
  status: [x]
- **core/t16** — Resource observation
  blockers: 09, 10, 15
  status: [x]
- **core/t17** — Data/command presets
  blockers: 05
  status: [x]
- **core/t18** — Resource presets
  blockers: 09, 10, 17
  status: [x]
- **core/t19** — v1 validation milestone
  blockers: 01–18
  status: [x]
- **core/t31** — A resource dep is its value; deps build before the body; async typed through the graph; lazy Proxy gone (ADR 0044)
  blockers: —
  status: [x] fa7282f, 227 tests, mutation 78.51, opres −95 ns

Parallelizable once upstream lands: 04‖05, 15 alongside 12→13→14, 17 early off 05.
Family (keyed collections) is out of v1 (needs its own ADR for the rules).

- **perf/tagged-100** — A tagged call copies its bindings into a one-item list first.
  The list no longer starts empty and grows; the reads match `readMany` exactly.
  Fable wrote it: an exact-size copy, then a fix that reads the list once through its own iterator.
  Review: Astra's first pass found eight differences; the fix made all eight MATCH.
  Review: Astra READY on `5ecc245`; 820 saved comparisons and 627 new checks MATCH.
  Benchd: N=61 against `2148e48`; B is `8e7812c`.
  `tagged`: 188.3 → 171.3 ns (−9.0%), slower 5/61.
  `taggeddefer`: 346.8 → 329.3 ns (−5.0%), slower 12/61.
  No row B slower in all 23; `warm` no difference we can see.
  Core mutation 85.59; 715 tests; promises tagged 2; validate 44 PASS.
  New rule: `tagged` ≤ 200 ns (was ≤ 250).
  With every rule kept the floor is about 145–150 ns; the user chose to stop here.
  Lines per row: [budgets](budgets.md).

- **perf/lazy-log-obs** — A body's `log` and `obs` tools are built on first read.
  They are getters on the ctx prototype, like `signal` and `raise`; no API change (ADR 0073).
  Retained ctx fields are written once.
  Review: Fable's behavior probe matched on 9 cases, except where `log`/`obs` live (the prototype).
  Benchd: N=61 against `a4baeb0`; B is `a442150`.
  `opsink`: 251.9 → 72.0 ns (−71.4%), slower 0/61.
  `opobs`: 248.9 → 208.4 ns (−16.3%), slower 12/61.
  `op`: 86.8 → 70.4 ns (−18.9%); `run`: 103.2 → 87.0 ns (−15.7%).
  `tagged`: 198.3 → 188.8 ns (−4.8%), slower 14/61.
  `oplog`: 319.7 → 322.6 ns, no difference we can see.
  No row B slower in all 23.
  Core mutation 85.44; 715 tests; promises tagged 2; validate 44 PASS.
  Lines per row: [budgets](budgets.md).

- **perf/tagged-close** — A tagged call and an idle session got about 3x to 10x faster.
  Stack: the fp3/fable stack, Astra's lazy tagged child session, a mutation lift, and the warm fix.
  ADR 0071: a session's handle closes when its body ends; an idle session ends in place.
  ADR 0072: a tagged call that ended in place returns its value.
  A tagged call runs on a small frame that grows into its child session at first need.
  Review: Opus read the code and the stack.
  Review: Astra compared 758 behavior cases with main; only the ADR 0071/0072 outcomes changed.
  Review: Fable checked the lazy session; 62 boundary cases were the same as the stack.
  Review: Fable read the mutation lift (10 tests, four removals): READY.
  Warm fix: `105d82b` puts first-time record creation back inside `nodeState`.
  Warm fix: the warm read inlines 611 bytes on main, 557 on the stack, 613 with the fix.
  Warm fix, N=31 main vs fix: `warm` 16.0 → 15.9 ns, no difference we can see.
  Benchd: N=61 against `917ee14`.
  `tagged`: 2150.3 → 198.0 ns (−90.8%), slower 0/61.
  `session`: 1684.9 → 572.8 ns (−66.0%), slower 0/61.
  `taggeddefer`: 2303.2 → 372.9 ns (−83.8%); `taggedres`: 3190.9 → 2486.6 ns (−22.1%).
  `warm`: 16.0 → 15.9 ns, no difference we can see.
  Exception (user): `s4_warm_ctl` 10.6 → 10.9 ns (+2.8%, 53/61), the trade for `warm`.
  The other 14 scenarios: B faster or no difference we can see ([budgets](budgets.md)).
  Gate: `EXIT=0`.
  Core tests: 710 passed.
  Core mutation: 85.33.
  Promises tagged: 17 → 2.
  Validate: 44 PASS.
  Slot headroom: 3.

- **perf/create-presets** — Empty presets return before the loop.
  Filled presets run in `applyPresets`.
  V8: `seedPresets` shrank from 266 to 76 bytecode bytes.
  V8: `seedPresets` inlines into `createScope`.
  V8: optimized create has no `ArrayIteratorPrototypeNext`.
  Benchd: N=61 against `337978e`.
  `create`: 205.5 → 184.1 ns (−10.4%).
  B slower: 0/61.
  Verdict: B faster.
  `op`, `run`, `session`, `tagged`, `lifecycle`, `cold`: no difference we can see.
  Gate: `EXIT=0`.
  Core tests: 636 passed.
  Promises tagged: 17.
  Validate: 44 PASS.
  Slot headroom: 5.

## Teardown / lifetime redesign (LT1–LT4)

Converge the ctx to `ctx.defer(end)` + `ctx.signal` (ADR 0024) with teardown as **reverse-registration
LIFO** (ADR 0026 — not a dependency scheduler). Replaces `cleanup` + `onOutcome`. Design inputs:
ADR 0024 (API), ADR 0026 (decisions), ADR 0025 (analysis/bug map), and the bug/requirements ledger
`teardown-redesign.md`. Each ticket lands astra-clean via the gate; sits before core/t19.

- **core/lt1** — Converged ctx + reverse-registration close
  blockers: t14, t16
  status: [x]
- **core/lt2** — Release + cross-owner via the same drain
  blockers: lt1
  status: [x]
- **core/lt3** — Cancellation hardening + `close()` shutdown-mode redesign (ADR 0028)
  blockers: lt2
  status: [x]
- **core/lt4** — Prove the contract + remove old paths + budgets + accepted limits
  blockers: lt3
  status: [x]

- **lt1** — `ctx.defer(end)` (end = success|failed|cancelled|released) + `ctx.signal` on operation and
  resource ctx; `Scope.Outcome += cancelled`. Close drains the layer's one defer list (onClose is a
  defer) in **reverse registration order**, sequential + awaited, children-first. Settlement reducer
  (body/owned failure > cancel > success); `isCancel = error === signal.reason`; cancelled session
  rejects with the abort reason; `signal` chains parent→child and aborts at close start.
  _Accept (public seam):_ reverse-registration LIFO incl. onClose interleaving (even onClose
  registered mid-factory); diamond/chain order via registration; 10k-deep chain closes without
  overflow; op/resource `defer` sees the right status; a real late failure during close still
  surfaces; real failure beats cancel; cancelled session rejects with the abort reason; a streaming
  op writes a cell over time and stops cleanly when `close()` aborts its signal; throwing defer →
  aggregated `TeardownFailed`, later defers still run.
  _LANDED (tag `core/lt1`)._ Gate green: `vp check`, 158 core tests, strict census, size 10808 B,
  mutation 76.91%. **14 astra rounds** — full failure ledger in `teardown-redesign.md` (rounds 1–14).
  The settlement model is the ADR 0026/0025 §4 reducer applied **literally** (a real non-cancel body
  rejection wins → owned-work → inherited/explicit failed → cancel → success): rounds 7–9 chased an
  "own vs propagated body failure" distinction that is unsound (provenance by error value is
  impossible) and it was removed. Concurrent/overlapping-close correctness (rounds 10–13): severity
  merge of `inheritedEnd` in `abortSubtree`; **branded** abort reasons so `isCancel` recognizes a
  cancel across layers; live `inheritedEnd` re-read at settlement; and an already-closing (not-yet-
  settled) child adopts a more-severe incoming outcome. Round 14 confirmed clean (768-case 4-layer
  overlap matrix + branding/LIFO/after-settlement probes).
- **lt2 final2 review:** P1 reproduced in `/tmp/lt2-final2-review/regression.test.ts`: one release
  of root `conn` cascades to an in-flight child `tx` borrowed by an operation. Once the build and
  operation finish, `conn` cleanup overtakes `tx`'s late async defer. The superseded defer's drain
  (`src/index.ts:1319`) is not joined by the original owner chain (`:1294`, `:1342`). Expected
  `tx-clean-open, conn-clean`; actual `conn-clean, tx-clean-closed`. Pre-release registration control
  passes. Prior borrow-registration fix confirmed. Checks: `vp check` green (two warnings), core
  172/172, workspace 178/178, strict census green. Source/tests unchanged; lt2 remains open.

- **lt2** — `release` selects the affected set via the `dependents` graph (selection only) and runs
  their defers through the SAME reverse-registration drain with `released`; cross-owner **claims** so
  an owner's close joins queued (incl. cross-owner) release work and never drops a late throw; borrow
  policy (Q2: wait for in-flight borrowers before physical teardown).
  _Accept:_ diamond release correct; cross-owner release joined (late throw not lost); superseded/
  failed builds run their defers once (released/failed); release/close/rebuild overlap has no double
  cleanup.
  _LANDED (tag `core/lt2`)._ Gate green: `vp check`, 172 core tests, strict census, size ~13.1 KB,
  mutation 77.33%. Design (after a mid-course simplification — see the ledger lt2 scope decision):
  release drains each affected owner's defers in reverse REGISTRATION order (diamonds), owners drained
  DESCENDANTS-FIRST (invariant 6) and chained so an ancestor dependency waits for each descendant
  owner's full (incl. async) drain; a **direct op-borrow** (ADR 0026 Q2) registered BEFORE dep
  resolution makes a release wait for in-flight operations borrowing the resource (across the op's
  body + its own defers); defers extracted up front so a rebuild during cleanup is not swept in;
  superseded builds drain their late defer once, borrow-aware. A rounds-8–14 "resource-cleanup borrows
  its dependency closure" mechanism was found beyond ADR 0026 Q2 and deadlock-prone, and REMOVED (net
  code shrank). Deferred to lt3 (build/release timing races, not core lt2 invariants): ordering a
  resource-cleanup against a dependency released by a SEPARATE later `release()`, and a superseded
  (mid-build) dependent's late-cleanup order vs its concurrently-released dependency — both run once,
  only order can be off. See `teardown-redesign.md`.
- **lt3** _LANDED (tag `core/lt3`)._ Gate green: `vp check`, 185 core / 191 root tests, strict census,
  size 15.1 KB gzip, mutation 77.45%; CONFIRM CLEAN over two review rounds (6 timing/mode findings, all
  fixed + regression-tested; 204 scratch cases). Delivered: lazy resource building; Q3 sync-reentry
  no-hang; **Q4 → ADR 0027** (close returns a `Result`, never throws); Q5 cancel-timing; and the pivot
  **ADR 0028 — `close()` is a shutdown MODE, not a wished outcome**: `close(opts?: { graceful?: boolean })`,
  forced (default) aborts + rolls resources back (cancelled) / graceful commits (success), reality-only
  reducer, the whole wish/severity machinery deleted (engine 15.0→14.5→15.1 KB across the churn). Real
  descendant-failure push-up collection at any depth. Deferred to lt4: graceful→forced escalation; a
  layer's own owned-work failure surfacing after its child cascade; async self-reentry; ordering races.
  Hostile userland objects out of scope for v1.
- **lt4** _LANDED (tag `core/lt4`)._ Docs/proof-only — NO source change since `core/lt3` (the redesign
  already removed the old wish/two-phase paths cleanly; no dead code). Delivered: glossary + ADR-ref
  refresh to the shutdown-mode / reality-reducer model (removed stale `ctx.cleanup`/`onOutcome`/wished-
  outcome terms); **ADR 0029 — teardown v1 accepted limitations** (escalation, own-owned-work-after-
  cascade, async self-reentry, cooperative-cancellation precondition, unspecified teardown ORDER,
  adversarial objects, async dep-cycle-after-await — each safe, each promotable if a real case hits);
  contract seam audit (every live guarantee has a deterministic test — close never throws, reality
  reducer, commit/rollback matrix, descendant collection at depth, cancellation, deep chains,
  streaming). Budgets green: size 15.1 KB gzip (< 30 KB), mutation 77.45%. Code carried the lt3
  CONFIRM-CLEAN review unchanged.
  _Accept:_ every live ledger class has a deterministic seam test; gate green; limitations documented.

## core/root-lifetime — ADR 0085

- **Owner:** core/root-lifetime writer.
- **State:** Review; the lead owns the board card and landing.
- **Next:** lead review and landing; all writer gates have finished.
- **Verify:** full build, check, and workspace tests; core mutation at least 85;
  promise budget unchanged; every validate lane green; prose and new-code style checks.
- **Change:** a root may take a stop signal and expose `closed`.
  A failed start joins cleanup and every close hook before `ready` rejects.
  Signal closes wait for start and leave work's `ctx.signal` alone.
- **Scope:** core, these two track notes, and the required Jev labels changed.
  Stack, process, sync, tracker, and example migrations stay with their own cards.
- **Caller review:** core, hono, process, stack, sync, the tracker, the playground,
  and the core, drizzle, tinkerer, mcp, and hono examples use roots or readiness.
  The full workspace test run passed without changing any existing test.
- **First green step:** build, `vp check`, and `vp run -r test` returned 0.
  `vp check` printed 28 warnings; no new warning points at this change.
  The 19 new lifetime cases passed.
- **Regression proof:** both tests below failed on the unchanged base `f8bc981b`.
  The first read `['ready', 'cleanup']`; it expected `['cleanup', 'ready']`.
  The second read `[]`; it expected every handle and hook before/after event.
  The run returned 1; the same tests pass after the fix.
- **Slots:** new runtime names stay after `invalidateResource`:
  `readExtRoutes`, `watchRootClose`, `finishRootClose`, and `listenForStop`.
  The new local state also sits after that anchor.
  The plain handle, layer record, close layer, session path, and run path are unchanged.
- **Style:** the new test file's strict census returned 0.
  The whole core census returned 1 on both this branch and main `82a30895`.
  Both have the same old S14, T02, T06, T08, and T07 hits.
  These are outside this ticket; no new strict hit was added.
- **Assumptions:** the brief's fixed base is the comparison point while main moves.
  The existing board card belongs to the lead, so this writer leaves `TODO.md` alone.
  The given worktree was already installed and built; no pull or install was needed.
- **Core feedback:** no new request beyond the accepted close-hook follow-up.
  A hook can still replace the result returned by `close()`:

  ```ts
  close: async (_options, next) => {
    await next();
    return { status: "success" };
  };
  ```

  A forced close then answers success while `closed` holds core's cancelled Result.
  The new test keeps that stated limit visible for `core/close-hook-scope`.

### Known limits

- Roots that still call `close()` after a rejected `ready` run each close hook twice on a failed start:
  core's forced close, then their own close.
  These callers include stack's `runUntilStop`, process's `execute` finally, tracker fixtures,
  and examples.
  On main each hook ran once.
  Every hook in the repo is safe to repeat, and all lanes pass.
  The migration tickets delete those catches.
  Probe: `/tmp/rl-probe/p6main.mts` prints `[a, bad]` on main and `[a, bad, a, bad]` on this branch.
- A replaced `close` that waits before calling core's close is not yet seen by core.
  An abort during that wait starts another close, so the hooks can run twice.
  NATS drains before calling core's close.
  `core/close-hook-scope` owns this gap under "a root's hooks run once".
  Probe: `/tmp/rl-probe/p1.mts`, case P5.

### Jev review

- `preflight.mjs main..HEAD`: exit 0; 62 flagged units, no file flags.
  There were 65 non-noisy judge answers to label.
  Core owns its records and cleanup; moving them into user data cells or resource defers
  would make the owner depend on the system it implements.
  All 65 answers are false; 57 labels already existed and eight were added.
  `runInline`'s noisy `wrapsCallersStep` note owes no label.
- New `stateOutsideCell false` labels: `closeLayer`, `runStartChain`, `extendHandle`,
  `watchRootClose`, `finishRootClose`, and `listenForStop`.
- New `effectWithoutDefer false` labels: `extendHandle` and `listenForStop`.
  The root removes its stop listener before any hook runs; a defer would run too late.
- The contributor brief requires `tools/jev/cases.jsonl` despite the target's short path list.
  Those eight label rows are the only added file outside the target list.
  Calibration belongs to the lead's landing step.
- `tests.mjs core`: exit 0; no hit in the new lifetime file.
  The old plain hits remain, as the brief requires existing tests to stay unchanged.
  Four `isErrorInExpect` hits are in `errors.test.ts` and `namespaces.test.ts`.
  `caught-subflow.test.ts` has the existing timer used to observe a host rejection.
  Three `toBeThenToEqual` hits compare value shape and a _different_ object's identity:
  two named-release tests and the session-end test use `not.toBe` to prove a fresh object.
  They do not repeat the same assertion.
- `promises.mjs core`: exit 0; 37 old titles had no chosen README line.
  All 13 direct lifetime titles read by Jev matched a README line.
  Its title scan skips the six table-driven cases; their promises are in the root lifetime section.
  The 62 unsure answers owe no change.
  The notes below map the old titles to broader promises or implementation details.
  No extra contract is added just to match a test title.
- Plain test findings and promise picks have no judge in `label.mjs`.
  Their answers are recorded here; no new Jev rule was added.

### Earlier promise-pick notes

- **async is typed through the graph: an op over an async resource is an async op.**
  The public types already require an async body for async resource deps; this title checks that type rule, not another runtime promise.
- **an old build rejecting after release does not fail a session that got the replacement.**
  Resources already promises that a late old build cannot drop its replacement or its edges; the test checks that isolation during a session.
- **a closed session's dependency edges are pruned so a later release skips it.**
  Resources already says release skips a closed session. Pruning its edges is how core keeps that promise.
- **a sink returning a thenable whose then getter throws is isolated.**
  Observation already says a hostile thenable cannot fail an operation or leak a rejection; the sentence spans two lines.
- **close runs defers in reverse registration order (LIFO).**
  Scopes, sessions, and close already promises latest-first cleanup. LIFO is the same order.
- **closing a deeply nested scope tree does not overflow.**
  The deep tree is a stress case of closing all children; its particular depth is not a separate API limit.
- **close collects a session child born and finished during its ancestor's body wait.**
  Close already joins a running session body and its children. The birth timing checks that general rule.
- **scope.run runs an operation with no call args.**
  The public CallArgs type makes a void-input call optional. The title checks that existing call form.
- **two resolve hooks nest in registration order.**
  Extensions already says the first registered resolve hook is outermost; two hooks are one case of that order.
- **a cached write controller still rejects controller(cell) after close.**
  Scopes, sessions, and close already rejects late writes on a closed scope. A cached controller does not reopen it.
- **a scope with no session hook runs session bodies and closes the child session.**
  The session(fn) promise already closes the child on return or throw, without requiring any hook.
- **a watcher borrowing a replacement cannot hold the old instance.**
  Resources already isolates an old build from its replacement. A borrower belongs to the instance it used.
- **interleaved resource hooks keep reverse registration order.**
  Latest-first cleanup is already promised. Interleaving does not change registration order.
- **interleaved release hooks keep reverse registration order.**
  Resource cleanup and release use the same registered hooks. This is the existing latest-first rule during release.
- **a circular resource does not hold itself open after rejection.**
  Resources already reports CircularResource. Keeping no self-borrow is the internal means to let cleanup finish.
- **release awaits interleaved async hooks in reverse registration order.**
  Latest-first cleanup is already promised and async cleanup is awaited. Interleaving combines those rules.
- **a warmed context-aware pool without cleanup can feed a client.**
  A warmed pool is still the one cached resource instance; adding a ctx parameter does not change that promise.
- **a hookless session client frees its hold on a root resource when it closes.**
  A session closes its resources whether or not a factory registered cleanup. Its internal hold counter is not a separate API.
- **a hookless factory can retry after a synchronous failure.**
  The documented sticky rule is for a rejected async build. This title checks the plain synchronous factory path.
- **releaseNs waits for its own live borrow but not a sibling namespace.**
  Namespaces already isolates buckets; release waits for the borrower of the selected instance, not unrelated work.
- **release passed point-free to forEach releases each cell.**
  Passing release directly to forEach exercises its existing one-target call form, not a new release mode.
- **releaseNs on parent data cleans child resources before parent resources.**
  Resources already promises dependent-first release and cross-session cleanup. Named data uses the same order.
- **releaseNs ignores data and resource buckets that were never built or already released.**
  Clearing a named bucket that is absent leaves it absent. No new operation or return value is promised.
- **releaseNs from a closed session cannot unlink the root's named pool.**
  A closed session has no right to release more resources. The root pool remains governed by its own owner.
- **a rebuilt named data dependent leaves its old fallback entry.**
  The namespace fallback-entry bookkeeping is private; the public promise is that release affects only current dependents.
- **a tagged sync run that raises a managed error rejects with it.**
  Operations already promises that a rejected operation keeps its cause. Tags do not replace that error.
- **a run's borrow is released after its sync defer, so a release and a close do not wait on it.**
  The borrow counter is private. The public promise is that finished work no longer holds up release or close.
- **a closed scope with session hooks refuses a new session.**
  A closed scope refuses new work; adding session hooks does not reopen it.
- **a then getter is read once: the body value is the first read's.**
  The getter-read count is an implementation detail. ADR 0027 does not promise behavior for changing hostile thenables.
- **a tagged subflow inside a tagged run: the inner waits (a body is running), the outer waits for it.**
  Operations already promises that a tagged call waits when its session must wait; nested owned work is such a case.
- **the first async defer keeps the tagged call pending.**
  Cleanup is awaited before a tagged session ends. Its first async defer is one case of that promise.
- **a parent close inside an untouched tagged body sees that body.**
  Close already joins a running child body; allocating the child lazily does not weaken that rule.
- **the first resource build sees inherited namespaces and the call's tags.**
  Namespaces already says tagged subflows inherit the ambient namespace; Operations says tagged calls see call tags.
- **a data controller from an idle tagged call refuses a late write.**
  A closed session refuses late writes. Ending the tagged session in place has the same public rule.
- **adopting a body's late then method keeps its tagged controller writable.**
  The changing then property probes how core adopts a body result; it is not a new guarantee for hostile thenables.
- **a tagged session adopts a callable made thenable by run cleanup.**
  A callable made thenable during cleanup is an implementation probe; ADR 0027 leaves adversarial values outside its promise.
- **wait: a session resource built for the run, even with no cleanup.**
  Operations already says a tagged call waits when its session must wait and owns session resources until it closes.

### Final proof

- **Saved code:** `77d64388` on `core/root-lifetime`.
- **Gate:** `vp run -r build && vp check && vp run -r test` returned 0.
  Core printed 32 files and 750 passing tests, including the 19 new lifetime cases.
  All 17 workspace test tasks passed; existing tests stayed unchanged.
- **Mutation:** the core lane ran alone under `/tmp/mutation.lock` and returned 0.
  Score: 85.66, above 85.
  Killed 2742; timed out 29; survived 436; no coverage 28; errors 6.
  The Stryker report is `packages/core/reports/mutation/mutation.json`.
- **Promise budget:** both this branch and main `82a30895` returned 0.

  ```text
  sync-lane promises:  0   (budget 0)
  async-toggle promises: 5   (budget <=10)
  METRIC promises_tagged=2
  ```

- **Validate:** final build and `pnpm validate` returned 0; all 48 lanes passed.
  The workspace already allowed esbuild; `pnpm-workspace.yaml` was restored unchanged.
- **Slots:** 252 hot names; last hot slot 254; one spare name.
  Anchor: `invalidateResource`, line 4601.
  New functions: `readExtRoutes` 5393, `watchRootClose` 5412,
  `finishRootClose` 5426, `listenForStop` 5440.
  Every new runtime declaration is after the anchor.
- **Prose:** final `vp run prose` returned 0.
- **TSDoc:** `node tools/jev/docs.mjs` on the changed TypeScript files returned 0.
  No S26 row.
- **Jev:** preflight, tests, promises, and labels each returned 0.
  Eight new false labels are saved; the notes above answer the old plain and promise hits.
- **Style:** new lifetime test strict census returned 0.
  Whole-core census returned 1 on both branch and main, with identical old strict hits.
  The new code adds none; the existing tests remain untouched.
- **Timing:** none run; the lead owns the queued timing check.

The two regressions failed on the unchanged main core code at `f8bc981b`.
First: a rejected start rejects ready only after its forced cleanup ends.

```diff
- Expected
+ Received

  [
-   "cleanup",
    "ready",
+   "cleanup",
  ]
```

Second: a rejected start runs every close hook through the current handle.

```diff
- Expected
+ Received

- [
-   "handle:before",
-   "first:before",
-   "second:before",
-   "second:after",
-   "first:after",
-   "handle:after",
- ]
+ []
```

```text
Tests 2 failed (2)
EXIT=1
```

Both now pass.
Full logs from this writer run are `/tmp/core-root-lifetime-*.log`.

## core/testing-entry

- **Owner:** lead (Codex, Core package session); Sol writer.
- **State:** Done. Landed as `5b6bc0f3`; later Core tickets ran `scripts/ticket.sh` on top.
- **Verify:** main imports no test helpers; testing keeps virtual time and seeded IDs.
  Build, check, workspace tests, package file list, and release checks must pass.
- **Precedent:** Jobs, Mail, and NATS already ship a separate testing entry.
- **Scope:** Core helper code, build, exports, and README.
  Consumer changes only move test helper imports.
- **Impact:** move `makeTestClock`, `makeTestRandom`, and `preset`
  to `@tinker/core/testing`.
  Move `Clock.Test`, `Clock.Options`, and `Random.Options` there too.
  Keep `Clock.Handle` and `Random.Handle` on the main entry.
- **Callers:** Core, Blueprint, Drizzle, Harness, Hono, HTTP, Jobs,
  Stack, and Tinkerer tests.
  Also the Core, Harness, Process, and React examples,
  Playground, Issue Tracker, and Start Scaffold tests,
  and `bench/trace-sink.mjs`.
- **Before-code refs:** the existing SCIP indexes confirm Core, Drizzle,
  Hono, HTTP, Stack, and Tinkerer callers.
  A fresh text scan also finds Jobs, apps, examples, and the bench file.
- **Preset refs:** SCIP confirms Core, Blueprint, Harness, and HTTP callers.
  The factory is marked test-only; outside Core only tests import it.
- **Review refs:** rebuild the affected package indexes after the build.
  Old `index.ts` and `index.d.mts` helper symbols must have no references.
- **Package files:** the existing file list excludes source and test files.
  The testing entry and its types remain part of the same package.

### Observed proof

- Build, check, and all 32 workspace test tasks returned 0.
  Build ran 25 tasks; check found 0 errors and 28 warnings.
  Core passed 797 tests in 37 files.
- The new entry test fails on old Core with all three helper exports.
  It passes after the split.
  The lead reran the failing test in the temporary writer tree.
- The packed package has eight files and no source, tests, or maps.
  A clean folder imports both public entries and passes TypeScript checks.
- The built entry check confirms no main import reaches testing.
  Clock injection, presets, and repeated seeded trace IDs work across entries.
- The runtime size is 15,953 bytes gzip, under the unchanged 16,384-byte cap.
  The check counts the main entry and every runtime file it imports.
  The separate testing entry has its own file.
- Fresh SCIP indexes show no refs to the old main-entry helper symbols
  in Core, Blueprint, Drizzle, Harness, Hono, HTTP, Jobs, Stack, or Tinkerer.
- New files pass strict style and the TSDoc parser.
  Whole-Core strict hits match the old source counts; none were added.
- Jev ran with its key removed and an empty token path.
  No remote judge ran and no label was added.
- All 56 release checks returned 0.
  The entry, runtime size, promises, slots, graph, and ambient-read lanes passed.
- The user asked to commit and push this part alone.
  The scoped commit uses a clean tree; no tag is added.
  `scripts/ticket.sh` was not run: it stages every changed file and commits,
  and this workspace already holds other unsaved work.
  It also runs every package's mutation lane.
  The card stays in Review.

- Final logs are in `/tmp/core-testing-build.log`,
  `/tmp/core-testing-check.log`, `/tmp/core-testing-tests.log`,
  `/tmp/core-testing-validate.log`, and `/tmp/core-testing-regression.log`.
- The test tarball is `/tmp/core-testing-pack/tinker-core-0.0.0.tgz`.
  The clean import and type proof is in `/tmp/core-testing-packed/consumer.ts`.
- The temporary writer tree and branch were removed after the lead checked
  that every source, test, doc, and config file was copied.

- Follow-up caller scan found no old imports in package or example code.
  It found one old clock import in the root README and two preset imports
  in the Harness README.
  All three doc imports are now fixed.
  The full code and doc scan finds zero old helper imports.
  Prose and diff checks pass.

### Scoped commit checks

- The exact commit files passed 24 build tasks, check, and 31 test tasks.
  Check printed 0 errors and 28 warnings.
  The new Start Scaffold app and other unsaved work are excluded.
- Core mutation ran alone under `/tmp/mutation.lock` and returned 0.
  Score: 85.62, above the required 85.
  Killed: 2944; timed out: 32; survived: 480; no coverage: 20; errors: 3.
- The Harness README recipes use a named fake SDK value.
  Their code lines now meet both the phone width and formatter rules.
- Package entry, prose, and diff checks pass.
  The commit contains exactly 62 task files.
- Clean logs use `/tmp/core-testing-commit-` followed by
  `build.log`, `check.log`, `tests.log`, or `mutation.log`.
  The full report is `/tmp/core-testing-commit-mutation.json`.

## core/close-hook-scope — ADR 0104

- **Owner:** core/close-hook-scope writer.
- **State:** Review.
- **Next:** lead reviews the saved code and proof; writer does not push.
- **Verify:** build, check, Core and consumer tests, ticket script,
  all validate lanes, and Core mutation alone at floor 85.
- **Assumptions:** the supplied checkout is installed at `addce061`.
  No pull or install is needed.
  The lead owns `TODO.md`; this section tracks the writer's steps.
  Close hooks stay root-only; child sessions get the closing signal.
  A hook that skips `next()` still runs the inner hooks and cleanup.
  Each hook's first `next()` is retained; repeats join it.
  The fixed brief asks for Jev labels outside the allowed paths.
  Scope limits win; any label needed will be recorded here for the lead.
- **Baseline:** runtime size is 16,156 bytes gzip.
  Promise counts are sync 0, async 5, tagged 2.
  Logs: `/tmp/close-hook-size-baseline.log` and
  `/tmp/close-hook-promises-baseline.log`.
- **Red proof:** root and session tests each returned 1 on unchanged Core.
  Both timed out waiting for graceful close to settle.
  Each test releases its wait in `finally` so no work is left behind.
  Saved logs: `close-hook-scope-logs/red-root.log` and
  `close-hook-scope-logs/red-session.log` beside this file.
- **Implementation:** `closing` is a prototype getter on resource and hook contexts.
  Each layer stores its controller and linked signal only on first read.
  Parent links use `AbortSignal.any`; close never walks unread layers for signals.
  The first root close is retained before signals fire or hooks run.
  Hooks keep their before/after order; skipping `next()` cannot skip inner cleanup.
  Hook throws join the final teardown errors; hook return values cannot replace it.
- **Caller impact:** Core, React, Blueprint, Flight Trial, Start Scaffold,
  Playground, Website, and the Core and React examples.
  The new fields add no required call argument.
  Existing close-hook consumers keep their order and receive Core's actual Result.
  No consumer source changed.
- **Green step:** build, check, and 809 Core tests returned 0.
  Check has the base's 28 warnings and no errors.
  The focused closing and lifetime log is saved beside the red logs.
- **Budget proof:** all 16 validate lanes returned 0.
  The 16,384-byte size cap is unchanged.
  The first version grew to 16,342 bytes; it was not the final budget proof.
  The final size is recorded below after the close path was trimmed.
  Promise counts remain sync 0, async 5, tagged 2.
- **Style:** new and changed tests pass strict census.
  Changed source has the same old S10 and S14 hits as the supplied base.
  Whole-Core strict hits also include old test debt.
  No new strict hit was added.
- **Ticket assumption:** its recursive mutation call defaults to four tasks at once.
  A shell function adds `--concurrency-limit 1` to that call only.
  The script is unchanged and still runs every mutation lane.
  The whole ticket script runs under `/tmp/mutation.lock`.
  Core also runs alone under that lock, with the unchanged floor of 85.
- **Core feedback:** no new missing feature beyond this card.
  The failing caller shape is now green:

  ```ts
  const sending = scope.run(waitAtRoot);
  await scope.close({ graceful: true });
  await sending;
  ```

### Advisory checks

- Jev preflight returned 0.
  It found no file flag and 67 unit flags in Core's large source file.
  Each real judge flag has a `false` label with a reason.
  The two noisy hits need no label.
- Labels cover engine state, owned listeners, and Core's own lifetime code.
  These belong to Core's layers, not application data cells.
  Root stop listeners are removed before close hooks, before `ctx.defer` timing.
- **Scope assumption:** the fixed label tool always writes `tools/jev/cases.jsonl`.
  That path is outside this card's allowed paths.
  The tool ran with only its bank path redirected to
  `close-hook-scope-logs/jev-cases.jsonl` beside this file.
  Extraction, judge names, and label state are unchanged.
  It saved 71 labels; the lead can merge and calibrate at landing.
  Label output: `/tmp/close-hook-jev-labels.log`, exit 0.
- Jev tests returned 0; none of the changed tests has a flag.
  Old `isErrorInExpect` cases and the old sleep remain outside this change.
  The three `toBeThenToEqual` notes compare both fresh value and distinct identity.
  Those are separate public promises, so both assertions stay.
- The new closing tests all match README promises.
  Old README gaps from other features are recorded in the promises log.
  They are not new promises introduced by this card.
- TSDoc check returned 0 with no S26 rows.
- SCIP indexes for Core, React, and Blueprint returned 0.
  Refs find the new public fields and their tests in Core.
  React and Blueprint use none of those fields yet.
  Logs: `/tmp/close-hook-scip-index.log` and
  `/tmp/close-hook-scip-refs.log`.

### Close-path trim

- Reuse Core's owned error list for hook throws.
  Throws before cleanup join its errors; throws after cleanup are appended once.
  A test keeps both hook throws and a resource cleanup throw in one Result.
- A hookless root close creates no async hook task.
  A root with a stop signal reuses its existing `closed` promise.
  Closing signals compose ancestor controllers without recursion.
  Their fields stay absent from layers until a closing read needs them.
- The fix round restores the build config to match `origin/main`.
  Source map links and the shared chunk's hash stay in the built code.
- The first ticket run was stopped with exit 143 before its mutation gates finished.
  Its log is `/tmp/close-hook-ticket.log`.
  Source changed after the first mutation score of 85.50.
  Both proofs will be rerun on the final source; neither old run is the final gate.

- The fix-round runtime is 16,257 bytes gzip, 101 bytes above the 16,156-byte base.
  The unchanged cap is 16,384 bytes.
  Promise counts remain sync 0, async 5, tagged 2.
  All 16 validate lanes returned 0 on the trimmed source.
  Logs: `/tmp/close-hook-size-final.log`,
  `/tmp/close-hook-promises-final.log`, and
  `/tmp/close-hook-validate-final.log`.
- The supplier entry's HTTP poll timed out in the first full consumer run.
  That run returned 1: `/tmp/close-hook-consumers-final.log`.
  Its unchanged package passed alone on retry, exit 0:
  `/tmp/close-hook-flight-retry.log`.
  The full consumer gate is rerun; no caller file was changed.
- Final focused proof has 31 passing tests, including the mixed-error case.
  New and changed tests pass strict style.
  Source and config have the base's five S10 and three S14 hits.
  Both source censuses returned 1, with no added hit.
  TSDoc and prose returned 0.

### Final advisory proof

- The complete build/check/Core/consumer chain returned 0.
  All nine workspace test tasks passed on the full retry.
  Logs: `/tmp/close-hook-build-final.log`,
  `/tmp/close-hook-check-final.log`, `/tmp/close-hook-core-final.log`,
  and `/tmp/close-hook-consumers-retry.log`.
- Fresh preflight returned 0: 240 units, 65 flagged units, one noisy hit.
  All 69 real code flags have a scoped false label and reason.
  Twelve new case states were added; the scoped bank now has 83 cases.
  The lead owns its merge and calibration.
  Three plain test flags have written reasons, not model labels.
  The test judge bank is empty; the attempted label returned 1 for unknown judge.
  Its log is `/tmp/close-hook-test-label-attempt.log`.
  Label log: `/tmp/close-hook-jev-labels-final.log`, exit 0.
- Jev tests and promises returned 0.
  The new and changed tests have no flag and all match README promises.
  Old test debt and all 42 old README gaps are listed in
  `close-hook-scope-logs/ADVISORY.md` beside this file.
  They stay for a follow-up; they are not labeled as clean code.
- Fresh SCIP indexes and both public-field refs returned 0.
  Core has 12 resource-field refs and one close-event scope ref in its tests.
  React and Blueprint use neither new field yet.
  Logs: `/tmp/close-hook-scip-index-final.log` and
  `/tmp/close-hook-scip-refs-final.log`.
- The supplied base remains `addce061`.
  Shared `origin/main` later gained two board-only commits in the other track.
  This card's diff from its supplied base contains only allowed paths.

### Standalone Core mutation proof

- `flock /tmp/mutation.lock vp run core#mutate` returned 0.
  All source files match the unchanged `src/**/*.ts` setting.
  The floor remains 85; no source or static mutant was excluded.
- Score: 85.78.
  Killed: 2,962; timed out: 30; survived: 475; no coverage: 21; errors: 3.
  Total: 3,491 mutants.
- The full log is `/tmp/close-hook-mutation-final.log`.
  The saved report is `/tmp/close-hook-mutation-final.json`.
  It is copied before the ticket script can replace the package report.
- The ticket script is running under the same lock.
  Its recursive mutation call uses one package at a time.
  Its final exit and each lane's score will be recorded after it finishes.

### Final gate receipt

- Build returned 0: `/tmp/close-hook-build-final.log`.
- Check returned 0, with the base's 28 warnings:
  `/tmp/close-hook-check-final.log`.
- All 810 Core tests returned 0: `/tmp/close-hook-core-final.log`.
- All nine workspace test tasks returned 0 on retry:
  `/tmp/close-hook-consumers-retry.log`.
- The two saved red logs each returned 1 on unchanged Core.
  The saved focused green log returned 0, with 31 passing tests.
- Validate returned 0: `/tmp/close-hook-validate-final.log`.
  Every lane below passed:
  - lint, types, format, and complexity;
  - Core tests;
  - Core size;
  - promise counts;
  - deep chain;
  - live heap per request;
  - CRAP ceiling;
  - hot names and slots;
  - graph;
  - ambient reads;
  - cast-free examples;
  - runtime and testing entries;
  - Blueprint tests;
  - Blueprint size;
  - Blueprint corpus;
  - two hands.
- Ticket returned 1: `/tmp/close-hook-ticket-final.log`.
  All its gates passed; its final commit found a clean tree with nothing to commit.
  The script added no commit or tag.
  Check, tests, size, and recursive mutation each returned 0.
  Their log sections are `/tmp/close-hook-ticket-check.log`,
  `/tmp/close-hook-ticket-tests.log`, `/tmp/close-hook-ticket-size.log`,
  and `/tmp/close-hook-ticket-mutate.log`.
- Every ticket mutation task ran one package at a time under the lock.
  Scores: Core 85.81; React 92.75; Flight Trial 91.35; Blueprint 86.04.
  All four passed their floor of 85; the recursive task returned 0.
  Core's separate full run returned 0 at 85.78, with no source exclusion.
- Final TSDoc returned 0: `/tmp/close-hook-tsdoc-final.log`.
  Changed tests' strict style returned 0:
  `/tmp/close-hook-style-tests-final.log`.
  Source and config strict style returned 1, matching the base's old hits:
  `/tmp/close-hook-style-source-final.log` and
  `/tmp/close-hook-style-source-baseline-final.log`.
- Final Jev preflight, tests, promises, and model labels each returned 0.
  Logs: `/tmp/close-hook-jev-preflight-final.log`,
  `/tmp/close-hook-jev-tests-final.log`,
  `/tmp/close-hook-jev-promises-final.log`, and
  `/tmp/close-hook-jev-labels-final.log`.
  The unsupported plain-test label attempt returned 1; its reason is saved above.
- Fresh SCIP indexes and refs returned 0:
  `/tmp/close-hook-scip-index-final.log` and
  `/tmp/close-hook-scip-refs-final.log`.
- The writer's final step is this receipt and prose check.
  Source has not changed since the complete green gate.
  The branch is ready for lead review at its supplied base, `addce061`.

### Review fix round

- Owner: Sol writer, branch `core/close-hook-scope`.
  Next: full gates and Core mutation proof before lead review.
  Verify: the three red tests pass with the fix lines restored.
- A session cleanup's first root close now settles `closed`.
  It keeps the real layer Result and the existing hook bypass.
- Idle session closing and a close hook's first signal read have tests.
  Each test failed with its required line removed or reverted.
  All 14 closing tests pass with those lines restored.
- Build, check, size, prose, TSDoc, and test style returned 0.
  The build config exactly matches `origin/main`.
  Size is 16,257 B gzip, +101 B over 16,156 B.
  The cap stays 16,384 B.
- Red and green logs are in `close-hook-scope-logs/`.
  The fix logs start with `red-reentrant`, `red-idle`,
  `red-first-read`, `green-fix`, and `fix-`.

- The three review mutants are killed: lines 4011, 5505, and 5519.
  Line 5519 was 5512 before the seven-line fix.
  Every added code line also has a per-line run.
  Lines 5506, 5507, 5509, and 5511 produced no mutants.
- The optional-call mutant at 5508 survived the first run.
  A root with no stop signal has no `closed` resolver.
  A fourth test proves this close still ends with success.
  It failed without the optional call; that mutant is now killed.
  Red log: `close-hook-scope-logs/red-reentrant-without-stop.log`.
  Kill log: `close-hook-scope-logs/mutate-line-5508-retry.log`.

### Fix-round gate receipt

- Build returned 0.
- Check returned 0, with the same 28 warnings.
- Core tests returned 0: 814 tests.
- All nine workspace test tasks returned 0.
- Validate returned 0: all 16 lanes passed.
- Prose returned 0.
- Promise counts stay sync 0, async 5, tagged 2.
- Logs and exit codes are in `close-hook-scope-logs/`.
  Gate logs start with `gate-`; counts are in `fix-promises-budget.log`.
- Strict test style returned 0.
  Source style has main's same five S10 and three S14 hits.
  Logs: `fix-test-style.log`, `fix-source-style.log`, and `fix-base-style.log`.
- Preflight returned 0: 67 flagged units and one noisy hit.
  All 71 real code flags have false labels with reasons.
  Core owns these lifetime states and joins their close work.
  Labels stay in the allowed `close-hook-scope-logs/jev-cases.jsonl`.
  The lead owns merging and calibration at landing.
  No shared Jev file was changed.
- The new tests have no plain test flag.
  The seven old test flags keep the reasons in `close-hook-scope-logs/ADVISORY.md`.
- Next: the full Core mutation lane alone, under its lock.
  The lead will run `scripts/ticket.sh` at landing.

### Fix-round full mutation receipt

- `flock /tmp/mutation.lock vp run core#mutate` returned 0.
  Score: 85.88; the floor stays 85.
  All five source files and all 3,495 mutants were included.
- Killed: 2,970; timed out: 29; survived: 472.
  No coverage: 21; runtime errors: 3.
- Full-run mutants at 4011, 5505, 5508, and 5519 are all killed.
  The per-line runs also prove those kills.
  Line 5519 was 5512 before the fix.
- Size stays 16,257 B gzip, +101 B over the 16,156 B base.
  The cap stays 16,384 B; unused promise counts stay 0/5/2.
- The built-package probe returned 0.
  Both close results are success, and close hooks run zero times.
  Log: `close-hook-scope-logs/fix-reentrant-probe.log`.
- The fresh promise scan returned 0: 40 old gaps.
  The four new tests have no gap or plain test flag.
  The two newly listed old titles are saved in the advisory notes.
- Every gate's exit code is in `close-hook-scope-logs/gate-exits.json`.
  The score and counts are in `close-hook-scope-logs/full-mutation-summary.json`.
  Red and green proof links are in `close-hook-scope-logs/README.md`.
- Saved for lead review.
  Next: the lead reviews and runs `scripts/ticket.sh` at landing.
  This writer did not run it or push the branch.

## core/graceful-writes

Active calls keep state usable while graceful close waits for them.
They can still call their writing helpers after an await.
A running session body can still run an operation.
Call cleanup can write and call helpers after an await.
Held controllers can write until the drain ends, even outside a call.
New outside calls and sessions stay refused.
Release stays refused during the drain.
State is sealed before resource cleanup.
A resource cleanup write becomes a Disposed teardown error.
A forced parent close seals a child already draining gracefully.
An already-aborted child keeps writes sealed under a graceful close.
The closing signal still fires before the wait.
A write panic still reaches the root's close result.
The write path adds no check, lookup, or promise.

The fix round is saved in `bf516f98`.
Thirty-three tests cover the write bug, helper calls, and close rules.
Before the fix, six helper and body cases and the forced-parent case failed.
Deleting the resource seal makes its new test fail.
The named hand changes to the abort and release guards each make a test fail.
That round restored the source and passed all 847 Core tests.
All test tasks and all 16 validate lanes pass.
Build, check, and prose return 0.
Check has the same 28 warnings as main.
Runtime size is 16,379 of 16,384 B gzip (5 B left).
The next Core card must cut bytes before it adds any.
Main is 16,257 B gzip.
Promises match main: sync 0, async 5, tagged 2.
The copied stop probe prints success for the call and the close.
The reviewer's eight edge probes also pass.
The four full-file style hits match main.
All changed source and this test file pass the strict style check.
Jev has no changed-test flag or new README gap.
Its old Core state and lifetime flags stay explained in the gate file.

Proof: [red log](graceful-writes-logs/red.log).
Green checks: [gate exits](graceful-writes-logs/GATES.json).
The lead runs `scripts/ticket.sh` at landing.
This writer did not run it or push the branch.

Core mutation returns 0 at 85.94, above the floor of 85.
It used 845 tests and the exact final runtime source.
Two more cleanup controls were added after that run.
That changed-line run used all 847 tests and returned 0 at 92.31.
It kills 96 changes; the eight survivors are explained in the gate file.
Deleting the three repeated entry checks is equivalent.
Swapping the checks at lines 4518 and 4527 for `ensureAccepting` is not equivalent.
All named abort and release hand changes are killed.
The re-review adds seven cases with no change to Core source.
A tagged helper still runs during root close.
A running session body can settle an operation during root stop.
A saved body handle refuses calls once its body returns or fails.
Both plain and hooked sessions follow that rule.
A forced parent seal refuses helpers even from a running child call.
Each new case fails with its named guard broken and passes with it restored.
The hand changes ran in a scratch copy; this worktree's source stayed untouched.
Forty focused tests and all 854 Core tests pass.
Build, check, Core tests, and prose each return 0.
The fresh changed-line run returns 0 at 92.31 with all 854 tests.
It kills 96 changes; the same eight survivors remain explained.
The full mutation result above is from the earlier round.
The test file passes strict style, and Jev flags none of its 26 test entries.
Saved work stays in Review for the lead.

## core/size-room

Owner: Sol writer on `core/size-room`.
Core starts at 16,379 B gzip.
The cuts leave 16,084 B gzip, with 300 B free.
The cap stays 16,384 B.
Public types and exports stay the same.
Error kinds and message text stay the same.
Hot functions were not merged.
The operation builder drops a temporary object and a built-in call.
Its bytecode shrinks from 134 to 120 B.
Each throw keeps its own payload and the old stack depth.
Release code shares build-reference clearing.
Empty stores are shared only until their first write.
Each write gate gives its owner a new store.
Only internal sentinel symbol text is removed.
Symbols on handles and cancel reasons keep their descriptions.
Build settings stay unchanged.

### Cuts

Each cut was packed and measured on its own.
The list shows each measured step, in bytes saved.
It includes the later undo of one unsafe cut.
Name changes stay inside Core.
A later name change can shorten an earlier name again.
Zero gains, larger output, and unsafe name clashes were dropped.

- `resourceDependencies -> needs`: 6 B.
- `resourceDependents -> users`: 9 B.
- `dataDependencies -> reads`: 6 B.
- `nsDataDependents -> nsReaders`: 3 B.
- `descendantFailure -> childFailure`: 3 B.
- `resourceHolds -> holds`: 4 B.
- `failureOwner -> caller`: 7 B.
- `controllerFor -> controls`: 2 B.
- `parentHigh -> parentHi`: 3 B.
- `parentLow -> parentLo`: 1 B.
- `parentText -> parentHex`: 1 B.
- `isSettled -> settled`: 2 B.
- `nsResources -> nsBuilt`: 3 B.
- `abortReason -> reason`: 7 B.
- `secondary -> errors`: 6 B.
- `completion -> done`: 8 B.
- `dependents -> users`: 8 B.
- `dependencies -> needs`: 7 B.
- `borrowers -> borrows`: 1 B.
- `finishing -> ending`: 1 B.
- `remaining -> left`: 2 B.
- `notified -> prior`: 2 B.
- `closeSignal -> stopping`: 1 B.
- `nsCells -> cells`: 9 B.
- `nsLinked -> links`: 6 B.
- `emptyCtx -> empty`: 3 B.
- `obsTools -> tools`: 2 B.
- `nsReaders -> readers`: 7 B.
- `settler -> settled`: 2 B.
- `controls -> control`: 1 B.
- `cleanup -> clean`: 1 B.
- `unlisten -> detach`: 1 B.
- `bodies -> work`: 2 B.
- `nextId -> id`: 3 B.
- `traceBits -> bits`: 1 B.
- `shareDefers -> share`: 4 B.
- `defersOf -> defersFor`: 1 B.
- `childFailure -> childError`: 1 B.
- `building -> busy`: 3 B.
- `defers -> hooks`: 6 B.
- `active -> live`: 1 B.
- `failure -> failed`: 4 B.
- `parent -> up`: 2 B.
- `instance -> owned`: 4 B.
- `prior -> prev`: 2 B.
- `nsBuilt -> named`: 2 B.
- `logTools -> logs`: 1 B.
- `observing -> on`: 8 B.
- `recovered -> recover`: 1 B.
- `complete -> finish`: 10 B.
- `createLog -> logFor`: 4 B.
- `promise -> ready`: 10 B.
- `sessions -> session`: 2 B.
- `parentHi -> hi`: 4 B.
- `parentLo -> lo`: 2 B.
- `chain -> ns`: 6 B.
- `hookTarget -> op`: 3 B.
- `stopping -> stop`: 2 B.
- `previous -> stack`: 3 B.
- Share InvalidDependency payload construction: 2 B.
- Share cold build-reference clearing: 7 B.
- Use implicit undefined class fields: 2 B.
- Remove the private default-entry symbol text: 10 B.
- `owner property -> layer`: 1 B.
- `resource state property -> built`: 6 B.
- Chain retained-data reference clearing: 1 B.
- Chain build-reference clearing: 5 B.
- Share the frozen empty namespace list: 3 B.
  Undone below: public empty lists must still be refused.
- Share empty cleanup and error arrays: 15 B.
- Share empty child and pending sets: 5 B.
- Use implicit undefined for the remaining class fields: 1 B.
- Return the wrapped session handle directly: 4 B.
- Remove the private recovered symbol text: 2 B.
- Remove the private borrow flag text: 4 B.
- Remove the private factory flag text: 8 B.
- Reuse the existing no-op build callback: 1 B.
- Remove the private cancellation brand text: 5 B.

- Restore the private empty namespace list: costs 11 B.
  Its final bundle cost differs from the earlier isolated saving.
- Share cold Disposed payload construction: 2 B.
- Default that helper to the unchanged closed-scope reason: 10 B.

- Return the new registry error directly: 2 B.
- `byKey -> keys`: 1 B.
- `nsWatchers -> nsWatch`: 2 B.
- `watchers -> watch`: 1 B.
- `empty -> ctx`: 2 B.
- `borrows -> pending`: 4 B.
- `phase -> state`: 2 B.
- Remove the Disposed helper after the speed check: costs 14 B.
  The final bundle cost differs from its earlier isolated saving.

- Restore the borrow symbol description: costs 5 B.
- Restore the factory symbol description: costs 8 B.
- Restore the cancellation symbol description: costs 5 B.
  Callers can see these three through JavaScript reflection.
- Remove the duplicate inline dispatch branch: 5 B.
  Both paths call the same internal function with an undefined call.
- Share cold managed-error construction: 7 B.
  Core and caller errors keep the same fields and text.
- `instances -> built` in private release records: 10 B.

- Share the identical controller construction call: 5 B.
  The chosen run function and all constructor inputs stay the same.

- Restore direct managed-error construction: costs 7 B.
- Restore direct InvalidDependency throws: costs 1 B.
  These undo the two new error helpers and keep the old stack depth.

- Restore separate controller construction after its speed loss: costs 8 B.
- `runners -> runs`: 4 B.
- `writers -> writes`: 4 B.
- `historyMax -> limit`: 4 B.

- Place the cold build reset beside its first caller: 2 B.
- Restore the controller's private field names: costs 3 B.
  Its parent, chain, hook target, and settler use the old names again.

- Store operation fields directly: costs 9 B gzip.
  This removes the temporary object passed to `Object.assign`.
  Reads still finish before either field is written.
  This spends size room to address the failed speed gate.

The net saving is 295 B.
The public empty-list probe rejects on main and on the final code.
The discarded shared-list cut accepted it.
Each error still owns a fresh payload and keeps its text.

### Proof

Final runtime source: `13105f77`.
Base: `7ed7339b` from `origin/main`.
The final source has 16,084 B gzip and 300 B free.
The full receipt is [GATES.json](size-room/GATES.json).

- `vp run -r build`: exit 0.
- `vp check`: exit 0.
- `vp run core#test`: exit 0; 854 tests.
- `vp run -r test`: exit 0.
- `pnpm validate`: exit 0; all 16 lanes pass.
- `vp run prose`: exit 0.
- `flock /tmp/mutation.lock vp run core#mutate`: exit 0.
- Mutation prints 85.97, above the floor of 85.
- Promises: sync 0, async 5, tagged 2.
- Hot names: 247; last slot 249; six names of room.
- Check has 28 warnings, the same as main.
- All 12 runtime exports and all three type files match main.
- Public symbol descriptions, error text, and error stack depth stay intact.
- The empty-namespace rejection probe passes on main and on the final code.
- TSDoc parsing: exit 0; no hits.
- Strict style: exit 1 on both trees; the same four old hits.
- Jev preflight: exit 0; no file flags.
- All 75 unit flags are explained and labelled.
  Their labels are in the receipt because `tools/jev` is outside this card.

The score is down from 86.25 on the first cut set.
The deleted temporary object and dispatch branch had three killed mutants.
Restoring direct throws also changes the set of generated mutants.
Detected mutants go from 3,054 to 3,052.
Survivors go from 464 to 473; uncovered mutants go from 23 to 25.
All 854 tests remain unchanged.

### Speed

Each scenario ran through the queue at 61 pairs.
Each scenario had its own queue job.
The paired sign test drops ties and calls a change at `p < 0.01`.
All timing commands returned 0.

- `op`: no difference we can see.
- `run`: no difference we can see.
- `opres`: no difference we can see.
- `inline`: B faster.
- `session`: no difference we can see.
- `tagged`: no difference we can see.
- `create`: no difference we can see.
- `cold`: no difference we can see.
- `warm`: no difference we can see.
- `lifecycle`: no difference we can see.

`inline` also ran at 183 pairs in each order.
The final code was faster in all 366 pairs.
The pooled medians were 151.6 ns on main and 104.15 ns on this branch.
These are fresh results for the final source, not passes from earlier cuts.

Earlier cuts slowed `inline`; their 183-pair runs confirmed it.
The cause of that gap was not proved.
The final builder removes a temporary object and an `Object.assign` call.
It spends 9 B gzip to remove work paid on each inline call.
Its bytecode shrinks from 134 to 120 B.
Both bytecode checks ran through the queue and returned 0.

The base and trial worktrees were removed after the proof.
Saved work waits in Review.
The lead owns review and `scripts/ticket.sh` at landing.
This writer does not push.

## core/size-safe

Owner: Opus writer on `core/size-safe`.
Core goes from 16,084 B to 15,683 B gzip: 401 B saved.
Room under the 16,384 B cap: 701 B.
Every cut is internal code; behavior stays the same.
Public types, exports, error kinds, and messages are unchanged.
The three `.d.mts` files are byte-identical to main.
Build settings stay unchanged.
The run, session, resolve, and write hooks keep their API.

### Cuts

One commit per research patch, each measured with
`vp run --no-cache core#size`.

- `9a100bcf` lifetime, 9 close-path cuts: 131 B.
  A teardown stack array, one `thenDone` helper,
  session hook state as `0/1/2`, a shared `isIdle`,
  and 5 smaller rewrites.
  The `ownsNothing` doc now lists only its record walk.
- `07fa9a59` hot, 4 cuts: 198 B.
  A layer's tags are always one list; `stripNs`
  replaces `stripTags`; `ctx.hooks` replaces
  `defersFor`; the resolve onion ends in `resolveNs`.
- `e6f09a4b` surface S2–S5: 66 B.
  A shorter plain-http uuid fallback, `DEFAULT_OBS`
  from `makeObs`, one `sleep` branch, a no-op logger
  built over `LEVELS`.
- `eebb1213` errors E1 and E4: 6 B.
  `closeOrigin` asks the WeakMap directly;
  `settleSession` raises `TeardownFailed` once.

### Not taken

- S1, span ids written at open (275 B).
  It made 4 hex strings for every span at open.
  `SCEN=opobs` at N=61: 211 ns on main, 955 ns with it.
  B slower in 61 of 61 pairs, so it was dropped.
  Span ids stay lazy, as on main.
  So the reflection change the lens noted is gone:
  `"error" in span` and `Object.keys(span)` match main.
  A lazy form with no `toJSON` is a round 2 question.
- The `resolveSelectedDep` inline (18 B).
  It takes `buildDeps` to complexity 9; the lint max is 8.
- E2, `originOf` over `causesOf` (10 B).
  It reads every `cause` before it looks for a stamp.
  A throwing `cause` getter past the stamp would throw.
- E3, `raiseUnstamped = raise` (2 B).
  It needs `as unknown as`; the coding rules ban it.

### Proof

Final code: `eebb1213`. Base: `08ddc349` (`origin/main`).
The full receipt is [GATES.json](size-safe/GATES.json).

- `vp run -r build`: exit 0.
- `vp check`: exit 0; 0 errors, 28 warnings (main: 28).
- `vp run core#test`: exit 0; 854 tests (main: 854).
- `vp run -r test`: exit 0; 9 test tasks.
- `pnpm validate`: exit 0; all 16 lanes pass.
- Promises: 0 sync, 5 async, 2 tagged (same).
- Hot names end at slot 247 (main: 249).
- The three `.d.mts` files: byte-identical to main.
- Span JSON probe: identical to main.
  It covers 8 scopes (system and seeded random,
  4 trace seeds) and 352 lines: history,
  export, logs, and field reads, plus own keys.
- `flock /tmp/mutation.lock vp run core#mutate`:
  exit 0; score 85.92 (floor 85).
  Killed 2,898, timeout 30, survived 454,
  no coverage 26. Fewer mutants than main:
  the cuts removed code.
- `vp run prose`: exit 0.
- Jev preflight: exit 0; 67 flags.
  All are app judges (`stateOutsideCell`,
  `handRolledLifetime`, `effectWithoutDefer`)
  on Core's own lifetime code.
  6 sit on touched functions: `closeOrigin`,
  `finishHook`, `finishInstance`, `isIdle`,
  `closeLayer`, `extendHandle`.
  None is labeled: the lead's rule is to not bank
  boilerplate labels on core internals, and
  `tools/jev` is outside this card's paths.

### Speed

Each scenario ran through the queue at 61 pairs,
one queue job per scenario, under the shared lock.
The paired sign test drops ties and calls a change
at `p < 0.01`. All timing commands returned 0.

- `opobs` (tracing on): B faster, 209 → 202 ns.
- `op`: B faster, 68.6 → 64.0 ns.
- `run`: B faster, 81.4 → 75.1 ns.
- `opres`: no difference we can see.
- `inline`: B faster, 110.8 → 104.9 ns.
- `session`: B faster, 585 → 549 ns.
- `tagged`: no difference we can see.
- `create`: no difference we can see.
- `cold`: no difference we can see.
- `warm`: no difference we can see.
- `lifecycle`: no difference we can see.
- `taggeddefer`: B faster, 360 → 237 ns.
- `taggedres`: no difference we can see.
  At 61 pairs it leaned slower (40 of 61, p 0.02).
  A rerun at 183 pairs: 88 slower, 95 faster
  (p 0.66), medians 2,641 → 2,629 ns.

`taggeddefer` and `taggedres` are not in the default list.
They ran because cuts 1 and 2 touch the defer, tag,
and resource release paths.

No scenario is B slower.
The base worktree was removed after the proof.
Saved work waits in Review.
The lead owns review and `scripts/ticket.sh` at landing.
This writer does not push.

## core/size-build

Owner: Opus writer on `core/size-build`.
Lead ruling: a build step may shrink shipped code (size Option 1).
Rebased on `69526f1c`; its Core is that of `35404adc` (`core/size-safe` landed).
Core on main is 15,683 B gzip.
The build step leaves 15,367 B gzip: 316 B smaller.
The source does not change.
Public types and exports stay the same.

### What the build does

- `packages/core/build/private-fields.ts` is a Rolldown plugin.
- It renames the fields in `build/private-fields.json` to short names.
- The list holds 48 names, such as `layer`, `nodes`, and `bodyEnd`.
- One name map serves all three runtime files.
- The map is fixed before any file renders.
  So two builds give the same bytes.
- The reprint drops `@__PURE__` comments.
  The output options drop the few left.

### How the list is made

`vp run core#fields` writes the list.
It keeps every runtime property name that passes the rules below.
A field added later keeps its long name until the list is written again.

The build fails when a listed name:

- is in a public type file (parameter names aside);
- is a string in the runtime: a computed key or an `in` check;
- is a key of an object passed as `attributes`.
  The rule follows literals, variables, `v.key =` writes, and spreads;
- is a Node built-in name, or a key a spec gives plain objects (`done`, `errors`);
- is read outside Core's source without type checks (see below);
- is no longer in the runtime.

It also fails when a short name equals a name that is kept.
A plain child Node process lists the built-in names.
So a test runner's own globals do not change them.

A file outside Core's source reads a name without type checks when it:

- loads Core: an import of `@tinker/core`, of Core's files, or an `import()` of a computed path;
- and has a string or plain template literal equal to the name;
- or, in a script, reads it as a member or a destructured key;
- or, in a typed file, reads it on a value that came from a cast or `any`.
  That value may pass through variables, members, calls, and destructuring;
- or reads it below `@ts-expect-error` or `@ts-ignore`;
- or reads it in a file with `@ts-nocheck`.

### The list after `core/size-safe`

The old list failed the build after the rebase.
The reason was `defersFor: not in the runtime any more`.
`vp run core#fields` wrote the list again: 49 → 48 names.

- Removed `defersFor`: size-safe deleted the field, so no code uses the name.
- Added: none.

The runtime gained one property name and lost two besides `defersFor`:

- New `replace`: a String built-in, so it can never be listed.
- Gone `join`: a built-in, never listed.

### Guard tests

`build/private-fields.test.ts` packs Core once per test.
Each plant sits in a scratch repo that the outside-read rule scans.

- Clean control: the shipped list builds.
- `(x as T).layer`: fails, read without type checks.
- G1, `const { pending } = x as T`: fails.
- G2, ``x[`owned`]`` in a script: fails.
- G3, `const raw = x as T`, then `raw.nodes`: fails.
- G4, `attributes: fields`, where `fields` has `layer` and gets `nodes`: fails.
- G5, `import()` of a computed path, then `.parent`: fails.
- G6, `Reflect.get(x, "built")`: fails.
- `zzGone`, no longer in the runtime: fails.
- `label`, in the public types: fails.
- G7, attributes passed through a function parameter: fails.
- G8, a member read through an `any` parameter: fails.
- G9, a member read through an `any` variable: fails.
- G10, a member read on a call result typed `any`: fails.
- G11, a member read below `@ts-expect-error`: fails.
- G12, a multiline member read below `@ts-expect-error`: fails.
- G13, a destructured key below `@ts-expect-error`: fails.
- G14, destructuring an `any` parameter: fails.
- G15, destructuring an `any` variable: fails.
- G16, a multiline member read below `@ts-ignore`: fails.
- G17, a destructured key below `@ts-ignore`: fails.
- G18, a member read in a file with `@ts-nocheck`: fails.
- G19, destructuring in a file with `@ts-nocheck`: fails.

There are now 23 guard tests, including the clean control.
Suppression is checked at each member or destructured key, not its source value.

Each fix was switched off once; its test then failed:

- Literal rule off: G2 and G6 fail.
- Destructuring off: G1 fails.
- Cast variables off: G3 fails.
- Computed `import()` off: G5 fails.
- Variable following off: G4 fails.
- Gone-name check off: the `zzGone` test fails.

Rolldown inlines a `const` object used once.
So G4 uses its variable twice, and writes a key on it.

### What the rules cost

Measured before the rebase, on the 16,084 B source.
The research list had 84 names.
The rules keep 49 and hold back 35, worth 168 B.

- 21 names fall to the string rule alone, worth 126 B.
  Most are test labels or event names in Core's tests, such as `"built"`.
- 7 names are read as members in untyped scripts.
  Some scripts only load other code by a computed `import()`.
  `scripts/check-slots.mjs` is one; the rule cannot tell it from Core.
- 7 more are built-in names, or read by untyped scripts that import Core.

A narrower string rule would keep the 126 B.
It would count a string only as a key, an `in` operand, or a call argument.
The review asked for every string, so the build counts every string.

### Tests on the built files

- `vp run core#test:dist` builds, then runs two sets on `dist`:
  Core's source tests, and the 23 guard tests.
- `pnpm validate` runs it as its own lane.
- `scripts/ticket.sh` runs it for Core.
- The source lane (`core#test`) skips `build/`, so Stryker skips it too.
- With `dist/index.mjs` broken on purpose, only the dist lane fails.
- With the attribute rule off and `outcome` listed, 4 log tests fail on `dist` only.
- One test starts Node on `src/index.ts` itself.
  It checks the source in both lanes.

### Tree-shaking without `@__PURE__`

Nine small apps import parts of Core: one export, both entries, or all.
esbuild and Rolldown each bundled every app.

- Main's build, with its `@__PURE__` comments cut out by hand: same bytes.
- The new build keeps the same top-level statements, in fewer bytes.

### Proof

Base: `35404adc` from `origin/main`, built in its own worktree.
`69526f1c`, the commit after it, changes only `TODO.md`.

- `vp run --no-cache core#size`: 15,683 → 15,367 B gzip.
- All three type files: byte-identical to main.
- All 15 exports (12 main, 3 testing): same names and kinds.
- Two builds: all 9 files byte-identical.
- Hot names: 245; last slot 247, the same as main.
- Tree-shaking: nine apps, esbuild and Rolldown, as above.
  Main with `@__PURE__` cut out: same bytes; this build: same statements.
- `vp run -r build`: exit 0.
- `vp check`: exit 0; 28 warnings, the same as main.
- `vp run core#test`: exit 0; 856 tests.
- `vp run core#test:dist`: exit 0; 866 tests.
- Guard tests alone: now 23 tests; current proof is below.
- `vp run -r test`: exit 0; 9 of 9 tasks.
- `pnpm validate`: exit 0; all 17 lanes pass.
- `vp run prose`: exit 0.
- Jev preflight (review round): exit 0; 3 `stateOutsideCell` flags.

Each Jev flag is labelled `false`: `followVariable`, `readTypes`, `isFromCast`.
They keep private notes for one build, and nothing listens to them.
The labels live here because `tools/jev` is outside this card.

### Speed

Only names change, so the bytecode is the same.
`N=61 A=../tinkered-size-build-base bench/queued.sh`: exit 0.
One queue job per scenario; `/tmp/mutation.lock` was held for the run.
Every scenario timed in batch mode, 61 of 61, on both sides.
Verdict: exact paired two-sided sign test, ties left out, p < 0.01.
Medians are ns per call, main → this branch.

- **`op`** — 64.1 → 64.2 (+0.2%), slower 31/61: no difference we can see
- **`run`** — 75.7 → 75.2 (−0.7%), slower 25/61: no difference we can see
- **`opres`** — 268.0 → 267.7 (−0.1%), slower 26/61: no difference we can see
- **`inline`** — 99.2 → 99.0 (−0.2%), slower 26/61: no difference we can see
- **`session`** — 509.8 → 508.3 (−0.3%), slower 27/61: no difference we can see
- **`tagged`** — 207.7 → 207.8 (0.0%), slower 30/61: no difference we can see
- **`create`** — 121.9 → 121.9 (0.0%), slower 25/61: no difference we can see
- **`cold`** — 699.4 → 699.2 (0.0%), slower 26/61: no difference we can see
- **`warm`** — 15.2 → 15.2 (0.0%), slower 25/61: no difference we can see
- **`lifecycle`** — 856.5 → 858.2 (+0.2%), slower 31/61: no difference we can see

No scenario is B slower.
The base worktree was removed after the run.

### Mutation

`flock /tmp/mutation.lock vp run core#mutate`: exit 0; score 86.00 (floor 85).
It ran alone, after the bench, once another lane let go of the lock.

- Killed 2,900, timeout 31, survived 451, no coverage 26, runtime error 3.
- Without the 31 timeouts, the score is 85.09: still above the floor.
- The dry run had 856 tests; the guard tests stay out of it.
- The build step changes no source, so the mutants match main's.

### Costs

- `console.log(scope)` shows short field names.
- The guard scans the repo for reads outside Core.
  A Core build takes about 0.5 to 1.5 s more on this busy box.
- The fixed name map costs 8 B against naming from the first file.

Saved work waits in Review.
The lead owns review and `scripts/ticket.sh` at landing.
This writer does not push.

## core/op-fast

Owner: writer (Codex, op-fast session); lead reviews and lands.
Base: `105e85a0` from `origin/main`, built in its own clean worktree.

### Change

Started from all five patches in the writer brief.
The operation context makes its defer function only when read.
Settle uses a value helper without a new function for each call.
Run hooks enter and leave their access window without extra functions.
A bodyless close with no child or pending work drains sync cleanup in one promise job.
A cleanup that returns a promise still delays the next cleanup and the close result.
The first close still owns the mode and result.
All six extension hook kinds remain.

The closing signal uses one shared cancel reason with no stack.
The reason keeps web abort code 20: Start's HTTP tests require it.
The study patch omitted that code and failed two consumer tests here.
The shipped tests keep the old output without a per-close stack.

The call guard adds one branch to `runOnce`.
Dropped its redundant span guard to stay within the code check's branch cap.
`closeSpan` already returns at once when there is no span.

### Tests

Added seven behavior checks in `packages/core/tests/op-fast.test.ts`.
The two sync-close checks failed on unpatched main, exit 1.
They pin no extra promise turns, cleanup order, both close result shapes,
and the same result when a later close asks for the other mode.
The other checks cover waiting for async cleanup,
a destructured operation defer, and the closing reason's web abort code.
Existing tests cover order and skipping `next()` for run, session,
resolve, write, start, and close hooks.

### Assumptions

The writer saves work for lead review; the lead owns landing on main.
No push or publish, as the common brief requires.
The Core checkpoint runs in check-only mode with its global mutation step off.
Its mutation step hides failures and runs every package at once.
Core's own lane runs alone under the lock and its exit code is recorded.
There is no `close` scenario in the shared probe.
Use its `lifecycle` scenario and a separate close loop through the queue.

### Proof

Final gate, size, queue, and inline proof are below.
The clean-commit fault proof is linked below.

First green checks: build, code check (0 errors, 28 warnings),
Core source (861 tests), Core built files (871 tests),
Start HTTP and sync (60 tests), prose, and scaffold check all returned 0.
The changed-declaration style census returns 0.
The whole Core file has four prior census hits; clean main has the same four.
They are two tracked `thenDone` calls, a browser UUID comment,
and the first panic's array read (its doc explains the speed cost of destructuring).
No new hit; left those lines outside this card's hot-path diff.
TSDoc shape: zero S26 rows.
The first V8 trace confirms the context constructor inlines into `runOnce`.

Size, measured after each patch in order:

- Main: 15,367 B gzip across all runtime files.
- Context inline: 15,392 B (+25).
- Hook functions: 15,428 B (+36).
- Lazy defer and settle: 15,474 B (+46).
- Sync-first close: 15,715 B (+241).
- Shared closing reason: 15,718 B (+3).
- Redundant span guard removed: -8 B.
- Closing reason web code kept: +16 B.
- First code: 15,726 B; total +359 B.
- Settle signal read order kept: -2 B.
- Final code: 15,724 B; total +357 B; cap 16,384 B.
- Hot names end at V8 slot 255; no slot headroom remains.

Review caught one more change in the study patch.
It moved the settle signal read past the run and inside the catch boundary.
A body that replaces its call signal could turn a real failure into cancellation.
The signal is now read once before the run, outside the try, as on main.
Two scope and controller regression checks failed on the first patch, exit 1.
The run still uses the same call object; only settle's chosen signal stays fixed.
The first timing run is not final proof; its built code predates this read-order fix.
A clean-tree timing run after the fix was built replaces it.

After the signal read fix, the checkpoint returns 0.
Core: 863 source tests and 873 built-file tests.
All ten normal test tasks pass, including Start's 405 tests.
Build, code check (0 errors, 28 warnings), prose, scaffold,
and all 18 release lanes return 0.
Default Maglev still inlines the operation context into `runOnce`.
[Gate exit codes](op-fast/gates.json).
[Advisory notes](op-fast/ADVISORY.md).

Core feedback from this card is a read-order trap in the study patch:

```ts
const call: { signal?: AbortSignal } = {};
const stop = new AbortController();
const cause = new Error("late signal");
stop.abort(cause);
const root = createScope();
const result = root.settle(
  operation({
    run: () => {
      call.signal = stop.signal;
      throw cause;
    },
  }),
  call,
);
```

Main and the final fix report failed with that cause.
The first patch reported cancelled.
The two new scope and controller tests pin that difference.
No missing Core feature was found.

### Final queue proof

A: `105e85a0`, clean and built.
B: `fa1cc594`, clean and built, after the signal read fix.
The queue uses Node 24.21.0 and V8 13.6.233.17-node.53.
The local default-Maglev inline proof uses those same versions.
Each shared-probe scenario ran 61 A/B pairs, one queue job per scenario.
The same probe runs against both builds.
The pair verdict uses a two-sided sign test, ties left out, with p < 0.01.

Median ns per call, A to B:

- `op`: 64.2 to 57.7; b is faster.
- `run`: 75.5 to 71.7; b is faster.
- `tagged`: 208.6 to 179.6; b is faster.
- `session`: 509.2 to 510.4; no difference we can see.
- `lifecycle`: 849.8 to 854.0; no difference we can see.

No scenario says b is slower.
Two whole-process checks use the same driver for both builds.
Each ran through `benchctl ab --rounds 10` from the clean base root.

- Settle, 2 million calls: 396 to 283 ms; verdict: b is faster.
- Forced close, 100,000 roots with sync cleanup:
  437 to 367 ms; verdict: b is faster.

[Raw pairs](op-fast/timing.csv).
[Pair verdicts](op-fast/timing-summary.json).
[Queue header and exits](op-fast/timing.log).
[Settle verdict](op-fast/ab-settle.log).
[Close verdict](op-fast/ab-close.log).
[Regression failures](op-fast/regressions.log).

After timing, rebased on `871b5a92` from `origin/main`.
Those five upstream commits change Start and its proof.
Core source, tests, build settings, lockfile, and both probe files are unchanged.
The timing compares the same Core builds as the final branch.
The full gate ran again after the rebase, exit 0.
Core still has 863 source tests and 873 built-file tests.
Start now has 408 tests; all ten normal test tasks pass.
Code check: 0 errors, 28 warnings, as before.
Scaffold and all 18 release lanes pass again.
[Trimmed gate output](op-fast/gates.log).
[Changed-declaration style census](op-fast/style-census.log).
Saved work stays in Review; the lead reviews and lands it.

### Last fault run

The full Core lane runs alone under `/tmp/mutation.lock`.
It runs on the clean code-and-proof commit, after every other change is saved.
Its header names that commit and records the empty worktree status.
Only its header and summary are saved in [the fault log](op-fast/mutation.log).
The commit after that run adds only that log.
The floor is 85 on kills alone; timeouts do not count as kills.

### Limits

The one-job close path applies when there is no body, child, or pending work.
An async cleanup still waits; the other close paths keep their prior waits.
This ticket does not measure heap bytes or promise a speedup for every workload.
The session and lifecycle probes show no difference we can see.
The full-file style census has four prior hits, also seen on clean main.
The changed-declaration census is green.

### Fault lane setup repair

The first full fault lane stopped before testing any mutants, exit 1.
A prior test spawns Node and imports the built entry from the test's own tree.
Core's fault config left `dist` out of its copied test tree.
The spawned test could not find `dist/index.mjs` there.
A setup-only run on clean main at `105e85a0` failed with the same missing file.

Removed `dist` from that copy skip list.
The lane now copies the built files needed by those tests.
It still mutates the same five source files, with no new test or source exclusion.
All score floors stay the same.
The setup-only run now passes all 863 tests, exit 0.
Runtime code and the measured builds do not change.
[Setup failure on main and the fixed run](op-fast/mutation-setup.log).

The prior test's failing import is:

```ts
new URL("../dist/index.mjs", import.meta.url).href;
```

The full fault run still follows on a clean rebased commit.

### Lead-requested rebase

Fetched and rebased on `4423d86e`, exit 0, with no conflict.
Main's board stays intact; its only added text is this card in Review.

```bash
git diff 871b5a92..origin/main -- packages/core
```

That command prints nothing and returns 0.
The newer main commits change no Core file.
Core source, tests, and build settings also match the earlier timing build.
The copy-list repair changes no runtime code.
[Rebase checks](op-fast/rebase.log).

All gates ran again after the rebase, each exit 0.
Build and install pass.
Code check: 0 errors and the same 28 warnings.
All ten normal test tasks pass: Core has 863 tests; Start has 421.
Core's built-file lane passes 873 tests.
Prose, scaffold, and all 18 release lanes pass.
Runtime size is still 15,724 B gzip.
The first full fault attempt had stopped at setup.
A new full run follows on the clean rebased commit with that setup repaired.

### Kills alone and the newer main

The first complete fault run exits 0, but fails the required floor.
It kills 2,964 of 3,499 counted mutants: 84.71% on kills alone.
The tool reports 85.80% because it counts 38 timeouts as kills.
[Header and summary of that run](op-fast/mutation-attempt.log).
We keep the required floor and every source file in the lane.

Four added tests cover public rules missing from the changed paths.
A hooked run waits for its async resource before the body starts.
A saved run `next` refuses a finished run instead of starting a late body.
The closing reason also keeps a non-empty message for callers.
A synchronous close with `withData` hands over written data.
An async scope cleanup failure appears in the close result.
The two existing close cases now also check that default close drops data.
These are distinct shipped rules, rather than tests of private helpers.
A narrow fault run checks the wrong results those rules reject.
[Wrong results caught by public rules](op-fast/public-rules.log).
The full lane follows on the clean code-and-proof commit.

Fetched and rebased onto `83c8a72b`, exit 0.
Kept main's board and re-added this card in Review.
Merged both sets of advisory labels and refreshed their calibration.
Core was byte-for-byte unchanged by the rebase.
The later tests change no runtime code or build setting.
The earlier timing and default Maglev proof still apply.

```bash
git diff 4423d86e..origin/main -- packages/core
```

That command prints nothing and returns 0.
[Rebase checks and runtime comparison](op-fast/rebase.log).

All gates ran again on `83c8a72b`, each exit 0.
Core has 867 source tests and 877 built-file tests; Start has 426.
Code check has 0 errors and the same 28 warnings.
Scaffold and all 18 release lanes pass.
One concurrent gate attempt hit two five-second Start sync timeouts.
The standalone full ticket rerun passes without changing any timeout.
[Gate output](op-fast/gates.log).

## core/preset-whole-node — Sol takeover

Branch: `core/preset-whole-node-sol`.
First base: `origin/main` at `60281254`.
Rebased on `14d69ad1`; Core source and build settings are unchanged.
Timing base stays pinned at `9b84bcf4`; its Core files match `14d69ad1`.
Both timing sides use the final branch's one probe.
The lead owns the board and landing.
The writer never pushes.

A resource or operation preset builds none of the replaced node's deps.
Its body gets empty deps and the usual context.
Input parsing still runs.
The scaffold tests drop SMTP settings read only by the preset mail node.
The new revocation tests also drop those settings.
Backend sender-release tests keep SMTP settings for their real mail node.
Database URLs stay: the migration operation reads database settings itself.

The writer started from the behavior change in `0584dc41`.
Both prior heads have local archive tags.
Their worktree is unchanged.
The saved bytecode ceiling increase was not copied.

`stampRunOrigin` joins two calls that already ran on every failure path.
The shared flight check stays shared.
A successful call never calls this helper.
The borrow already taken tells Core which deps loop to use.
The controller no longer saves a second copy of that same fact.
This also removes one module slot.
A run hook uses the plain loop when no dep is a resource.
The hook body reads the parked builds before any body can run.
It needs no local copy of that value.

### Proof before the final long runs

Five preset tests fail on unchanged Core at `60281254`.
Four receive a built dep where they expect none.
The plain operation case raises `MissingTag`.
The flipped resource deps test is one of these failures.
The same tests pass with the fix.

The build, check, and all ten workspace test tasks return 0.
Core has 880 passing tests.
The Core ticket script also returns 0.
It runs in check-only mode with its shared mutation step off.
That step hides mutation failures and runs other packages.
The writer runs Core alone under the lock, by exit code.

All 19 `pnpm validate` lanes pass.
The ceilings are unchanged.
The observed sizes are:

- `runOnce`: 498 bytes; ceiling 499.
- `runHookBody`: 297 bytes; ceiling 298.
- Core's last module slot: 338; ceiling 339.
- Complexity cap: 8; check passes.
- Runtime size stays below the unchanged 16,384 B gzip cap.

Changed Core code and tests pass the strict style census.
The four old whole-file hits also occur on main.
The TSDoc parser finds no bad doc row.
The old test flags concern old error guards, a host rejection wait,
and tests that check both fresh values and distinct identities.
They are outside the preset change.

Jev preflight, tests, and promises each return 0.
The final code answers have labels in the writer's handoff.
Every new or changed preset title matches a README promise.
The 47 old promise picks repeat broader scope, release, cleanup,
input-type, inherited-setting, and tagged-call contracts.
The earlier promise-pick notes in this file cover those contracts.
Hostile changing thenables remain outside ADR 0029's promises.
No new README gap comes from this ticket.

Local logs live in `.bench/preset-whole-node-sol/` in this writer tree.
The final timing and mutation logs name the head and empty tree status.
The writer's handoff gives the kills-only score and paired verdicts.
Timing uses 61 pairs, drops ties, and uses `p < 0.01`.
It runs the ten default scenarios, the run-hook case,
and the two-argument resource case.
Both long jobs hold `/tmp/mutation.lock` and finish in the same turn.
Core feedback: none.

### Earlier runs

The first full mutation run killed 3,036 of 3,576 valid mutants.
Its 84.899% on kills alone was below 85.
That form repeated the flight check in each failure path.
Keeping the check shared cleared 85 on the next two clean heads:
3,033 / 3,561, then 3,037 / 3,567.
No test or source file was removed to meet the floor.
The final full lane is run again on a clean head.

The first timing run found slower `op` and run-hook rows.
Using the plain loop for a hook's plain deps fixed the run-hook row.
A later head still had a slower tagged row.
A seeded handle copy had a slower `op` row.
Moving the deps build into the body helper had a slower tagged row.
Sharing origin stamping met the bytecode limit but still slowed inline calls.
The final code also removes the duplicate resource flag.
Its focused run found `op`, `inline`, and run-hook rows faster.
It found no slower tagged or `opres` row.
The full timing lane will run again on the final clean head.

### Landing

Reviewer: READY, no must-fix.
Landed 2026-10-10 on `origin/main` `e63fe5be`.
The rebase adds no Core change, so mutation was not re-run.
The one conflict was `tools/jev/cases.jsonl`; both sides were kept.

The full Core lane ran on clean `02b6475f`:

- 3,030 killed, 52 timeout, 445 survived, 35 no coverage.
- Kills alone: 3,030 / 3,510 = 86.3%.
- With timeouts as kills: 85.06%.

Ratchets, no ceiling raised:

- `runOnce`: 498 <= 499.
- `runHookBody`: 297 <= 298.
- Module slot: 338 <= 339.

Timing used 61 pairs and a paired sign test, `p < 0.01`.
`inline`, `run`, `tagged`, and `hooked`: b is faster.
No row is b slower.

## core/size-build-guard — Sol takeover

Branch: `core/size-build-guard-sol`.
First base: `origin/main` at `4edd71c7`.
Rebased on `d30e8fe3`; its Core files are unchanged.
The local archive tag keeps the first writer's head at `159da393`.
The first writer's worktree and branch are unchanged.
The lead owns the board and landing.

The guard follows attributes through named function parameters.
It counts reads through direct `any` bindings and calls typed to return `any`.
Destructured `any` bindings count their keys and retain their bound names.
A suppressed read is checked at the member or destructured key's own position.
Both `@ts-expect-error` and `@ts-ignore` count the following line.
A file with `@ts-nocheck` counts every read.
Only parsed comments count as these directives.
Some paths are left out: `any` through aliases, fields, rest and `catch`,
a directive on a declaration, and attributes through `new`, `.call`, `.apply`, or `.bind`.
They wait on the Ready card `core/size-guard-bypasses`.

### Revert proof

All 13 new tests, G7 through G19, fail on unchanged Core at `4edd71c7`.
Each gets an empty build error where it expects the named guard error.
The ten old tests pass there.
All eight takeover tests, G12 through G19, also fail with the first writer's guard.
Its fifteen tests pass.
All 23 guard tests pass with the fixes.
The clean control keeps checked reads and a directive-looking string accepted.

The red logs are `/tmp/size-build-guard-sol-main-red.log`
and `/tmp/size-build-guard-sol-haiku-red.log`.
The green log is `/tmp/size-build-guard-sol-guard-green.log`.

### Final checks

All nine built files match the base byte for byte.
The code check has zero errors and the base's 27 warnings.
The source lane passes all 880 Core tests.
The first parallel run hit a five-second Flight Trial timeout.
Its 148 tests pass when workspace packages run one at a time.
No timeout limit changes.

Changed code passes the strict style census.
The whole-file scan sees old code hits and the required invalid plant strings.
The TSDoc parser finds no bad doc row.
Jev finds no flag in the guard tests.
The old test findings and 47 old README picks stay outside this build change.
The code flags have false labels under `core/size-build-guard`.
The maps and sets hold private build notes, not app state or work on a request.

The handoff records the full gate chain by exit code.
It also gives the clean head, the full Core fault count, and the labels.
The Core ticket runs check-only, with its mutation step off.
The full Core mutation lane runs alone under `/tmp/mutation.lock`.
The guard tests run in the built-file lane; `build/` is not mutated.
Full Core lane on clean `9cd321c3`: killed 3037, timeout 28, survived 462, no coverage 35.
Kills alone: 3037 / 3534 = 85.94%.
Timeouts counted as not killed: 85.26%.
The revert test is the guard's proof: 13 new tests fail on `4edd71c7`.
The red tests above prove the guard changes.
No runtime code, name list, ratchet, or ceiling changes.
No timing run is needed.
Core feedback: none.

## core/size-guard-bypasses — Sol takeover

Branch: `core/size-guard-bypasses-sol`.
Base: `origin/main` at `9ba9515c`.
The local tag `archive/size-guard-bypasses-haiku-451baf37` keeps the first head.
The first writer's worktree and branch are unchanged.
The lead owns the board and landing.

### Rules

The guard keeps the first writer's fixes for every bypass on the card.
It follows attributes through `new`, `.call`, `.apply`, and `.bind`.
It follows attributes through rest and destructured parameters.
It counts reads through local aliases of `any`, fields, rest, and catch bindings.
It follows cast defaults and function returns.
It follows inline functions, callbacks, object methods, and named imports returning `any`.
A directive on a declaration or assignment marks its bound names.
A return belongs to the innermost function, including a callback or class method.

`as const` counts as a cast when any cast other than `as const` sits anywhere in its subtree.
The scan includes branches, operators, and function bodies.
Checked literals and nested `as const` alone stay accepted.
Plain object and array literals also retain casts in their contents and spreads.
The whole literal counts when a contained value came from a cast or `any`.
Checked literals stay accepted.
The imported-function text check now accepts local aliases of `any` too.
The property visitor records functions only.

The rules still match names rather than real types across files.
Cross-file type aliases and the other follow-up cases stay outside this ticket.
No runtime source, saved name list, ratchet, or ceiling changes.
No timing run is needed.

### Revert proof

All 61 guard tests pass on this branch.
The old 23 tests pass on `origin/main` too.
Plants G20–G24 and G26–G38 fail on `origin/main` because its build accepts them.
Plant G25 was already caught on `origin/main`.
Plants G40–G44 also fail on `origin/main`.
Plant G39 was caught on `origin/main`, but fails on the first writer's final head.
Plants G40–G43 also fail with the first writer's final guard.
The callback-return control fails with `aa5466d7` and passes with its return fix.
The checked `as const` control stays accepted.
The new checked object and array control stays accepted.
The checked array `[{ layer: 1 }] as const` stays accepted too.

Plants G45–G51 fail with `d52feb99` because its build accepts them.
They cover conditional arrays and objects, `??`, `&&`, `||`, commas, and called inline functions.
Each plant now fails the build with the expected outside-read error.
The new checked array control passes before and after this fix.

The logs use the prefix `/tmp/size-guard-bypasses-sol-`.
The red logs end in `main-red.log`, `haiku-red.log`, and `callback-red.log`.
The green log ends in `guard-green.log`.
The fix-round red log ends in `fix-red.log` and records `d52feb99`.
Its seven plant failures end with `EXIT 1`; the checked array control passes.
The fix-round green log ends in `fix-guard-green.log` and records all 61 tests passing.

### Build proof

All nine dist files match `origin/main` byte for byte.
Both repo scans find 6103 names, with no name added or dropped.
The wider literal rule moves the first read file for seven existing names.
The saved `private-fields.json` is unchanged.
The code check has zero errors and the base's 27 warnings.
The final handoff names the clean head and reports the full gate chain by exit code.
It also reports all 20 validate lanes and the locked full Core mutation lane.
Only `src/` is mutated; the planted build tests prove the guard changes.
Full Core mutation lane on clean `d5d7fbb1`: 3036/3532 = 85.96% on kills alone.

### Jev and style

The first-pass preflight runs flag six build functions.
All seven judge cases have false labels under `core/size-guard-bypasses`.
The maps and sets hold private build notes rather than app state.
The build changes no runtime object shape.
Six cases already existed; their labels are kept and their `by` names this card.
The fix-round preflight flags three of those functions and no new code.
Their existing labels still match the code and name this card.
The guard-test scan finds zero flags in all 61 tests.
The package-test scan still finds seven old test flags and one old timer note.
Those files are outside this build ticket.
The promise scan reads the package tests, not the guard tests in `build/`.
The strict style scan finds old code and the required invalid plant strings.
Changed code has no other strict hit.
The TSDoc parser finds zero bad doc rows.

Core feedback: none.

### Landing

The lander re-ran every gate on `d5d7fbb1`; each exits 0.
`vp check`: 0 errors, 27 warnings (the base count).
`vp run -r test`, `core#test:dist`, and `ticket.sh` pass.
`pnpm validate`: all 20 lanes pass.
All nine dist files match `origin/main` byte for byte.
G45–G51 fail on `d52feb99` and pass on `d5d7fbb1`.
`[{ layer: 1 }] as const` stays unflagged on both.

## core/size-guard-real-types

The first pass below is kept as its own proof.
The Sol takeover proof follows it.

Branch: `core/size-guard-real-types`.
Base: `origin/main` at `63e48732`.
The lead owns the board and landing.

### Rules

The outside-read rule asks TypeScript 7's checker whether a read is `any`.
This is the question typescript-eslint's `no-unsafe-member-access` asks.
A member read or a destructured key counts when one of these holds:

- The checker says the object is `any`: through an alias, an import, `await`, a call, or a union.
- No property has the name, and a string index signature typed `any` answers it.

The checker reads `@tinker/core` from Core's source through `paths`.
The build does not read Core's built output for this.
Each call makes a folder under `packages/core/node_modules` and removes it after.

Syntax still covers casts, getters, inline functions, `super(...)`, and `.call`, `.apply`, `.bind`.
A directive counts at the value's own position: the name, the returned or passed expression, or the initializer.
The syntax `any` tracking is gone. The checker answers it.
No runtime source, saved name list, ratchet, or ceiling changes.

### Plants

Plants G52 to G71 are new: twenty tests.
On `origin/main` all twenty fail. Each expects an error and gets an empty build.
Three controls stay unflagged on both heads.
Run: `vp test --config vite.dist.config.ts build/private-fields.test.ts`.

- `origin/main`: 20 failed, 64 passed (84).
- This head: 84 passed (84).

The 61 old guard tests stay green.

### Build proof

- All nine dist files match `origin/main` byte for byte.
- The real-repo scan finds 6107 names on both heads, and the same set.
- The card said 6103. Both heads agree on 6107 today.
- `private-fields.json` is unchanged by this change.
- The committed list is stale on both heads. It lacks seven names.
- The seven: `borrows`, `controllerOf`, `deferFn`, `lastController`, `lastTarget`, `mayHook`, `releaser`.
- That fix belongs to `core/private-fields-regen`, not this card.
- The scan gives the same list with `packages/react/dist` removed.

### Build time

`vp run --no-cache core#build`, through `benchctl run --runs 5 --warmup 1`:

- `origin/main`: median 4439.5 ms, MAD 305 ms.
- This head: median 6247.6 ms, MAD 17 ms.
- The build is 41% slower. That is under 2x.
- These are two `run` jobs, not an `ab` verdict.

### Gates

Run on `4964551e`, the last code change. Later commits change only Jev data and this file.

- `vp run -r build`: exit 0.
- `vp check`: 0 errors, 27 warnings. `origin/main` has 27.
- `vp run -r test`: exit 0. Core source lane: 883 tests.
- `vp run core#test:dist`: 967 tests pass. The guard tests are in it.
- `scripts/ticket.sh --check-only --no-mutation core 40 "..."`: exit 0.
- `pnpm validate`: exit 0. All 20 lanes pass.

### Jev

- Preflight on `origin/main..HEAD` flags seven functions in `private-fields.ts`.
- New labels, by `core/size-guard-real-types`, all `false`: `declared`, `assigned`, `returnFlows`.
- Five more hits already had labels for the same code: `noteAssignment`, `followVariable`, `readTypes`, and two on `privateFields`.
- The bank refuses a second label for the same code, so those keep their older `by`.
- `tests.mjs` and `promises.mjs` do not read `build/`. Their flags are in untouched Core tests.
- Calibrate ran in full: 24 judges, no status change.

### Mutation

Full Core lane on clean `5f7891ce`, alone under `/tmp/mutation.lock`: exit 0.

- Killed 3023, timeout 113, survived 398, no coverage 35, errors 3.
- Kills alone: 3023 / 3456 = 87.47%. Floor 85.
- Timeouts counted as not killed: 84.70%.
- `src/` is unchanged. `build/` is not mutated, so the plants are the proof.

### Core feedback

- TypeScript 7's `IndexInfo` has `valueType`, not `type`. `info.type` is `undefined`.
- Closing the sync API makes the native child print `context canceled`. That shows in test logs only.

### Sol takeover

Branch: `core/size-guard-real-types-sol`.
Base: `origin/main` at `19921aba`.
The local archive tag keeps the first head at `50cb30d1`.
The first writer's tree stays unchanged.
The lead owns the board and landing.

The first pass lost three assignment reads that main catches.
R1 takes an object key through an array assignment from `any[]`.
R2 takes an object key through a nested object assignment from `any`.
R7 takes an object key through a spread array assignment from `any`.
The spread target now passes its source type to the nested target.
The assignment walk has complexity 5, below the limit of 8.
The guard now walks each nested object and array target.
It asks the checker for the source type at the assignment.
Each step uses the type of the source property or array element it reads.
The type of the variable being written does not decide the source read.
Direct object assignment from `any` stays caught.

R3 adds an assignment target in a `for-of` loop over `any[]`.
R4 and R5 read nested source parts typed `any` into variables typed `number`.
R6 reads a tuple whose second element is `any` through `for-of`.
The loop checks the type of every possible element, rather than the first one.
A checked nested source stays accepted even with an unrelated `any` sibling.

The config write and checker constructor now sit inside the cleanup block.
The folder is removed even when either step fails or closing the checker throws.
A real copied TypeScript install with its native binary missing proves constructor cleanup.
The test changes no shared install and uses no mock.

#### Plants and lost-case proof

All 94 guard tests pass.
The 61 old tests and all twenty plants G52 to G71 pass.
Every plant gets the named build error.
The three first-pass controls still pass.

On unchanged main in `/tmp/main-check-size-guard-real-types-sol`:

- All twenty G52 to G71 tests fail because the build accepts their plants.
- R1, R2, and R7 pass: main already catches these reads.
- The direct object assignment test passes too.
- R3 to R6 fail because main accepts their plants.
- The full copied suite has 25 failed and 69 passed tests, exit 1.
- The separate R1, R2, R7, and direct assignment run has four passed tests, exit 0.

With the first pass's guard from `50cb30d1`, R1 to R7 fail.
The missing-binary cleanup test also fails.
The final copied suite has eight failed and 86 passed tests, exit 1.
Before the last fixes, R6 and the missing-binary cleanup test both fail.
The cleanup test sees a folder left behind after the constructor throws.
R7 also fails on the unchanged guard at `d17c1559`: its build accepts the read.
With the final code, all 94 pass, exit 0.

A separate spread `for-of` probe fails on main and on both prior guards.
The fixed guard catches it; this check adds no committed plant.
The proposed nested object rest is invalid JavaScript.
TypeScript 7 also rejects it with TS2339, so it adds no plant.
`for-of` over Set or Map stays for `core/size-guard-iterable-assign`.
Logs use `/tmp/size-guard-real-types-sol-` in this writer's box.

#### Build and checks

All nine dist files match main byte for byte.
Both real-repo scans find the same 6107 names.
No name is added or dropped.
The saved `private-fields.json`, Core source, and all ratchets are unchanged.
No ceiling is raised.

The first-pass build timing remains the accepted cost of adding the checker:
4439.5 ms to 6247.6 ms, from its two queue jobs.
These are build measurements, not a paired timing verdict.
This takeover makes no new speed claim and needs no runtime timing run.

Final code head: `efceca51`.
Final head: `HEAD` on `core/size-guard-real-types-sol`.
The proof commit after the code head changes only this section.
The full gate chain passes on the clean code head.
It is rerun on the clean proof head before handoff.

- `vp run -r build`: exit 0.
- `vp check`: exit 0, zero errors and the same 27 warnings.
- `vp run -r test`: exit 0; Core source has 883 passed tests.
- `scripts/ticket.sh --check-only --no-mutation core 40` with the title below: exit 0.
- Title: `Guard array spread assignment reads`.
- The ticket's built-file suite has 977 passed tests, including all 94 guard tests.
- `pnpm validate`: exit 0; all 20 lanes pass.
- `vp run prose`: exit 0.

Mutation: 3037 / 3540 = 85.79%, on d17c1559; src unchanged since.
That run has 3037 killed, 468 survived, and 35 with no coverage.
The floor is 85 on kills alone; timeout cases do not add kills.
The full Core lane ran detached under `/tmp/mutation.lock`, exit 0.
Its log names `d17c1559` and shows a clean tree before and after the run.
The user asked to keep that score and skip a fresh run for this fix round.
The plants prove the guard; the mutation lane changes only `src/`.

#### Jev and style

The final code preflight reads `origin/main..HEAD`.
Five new labels name `core/size-guard-real-types` in `by`.
They label `declared`, `assigned`, `returnFlows`, `argumentCasts`, and `settle` false.
The six older rows keep their original `by` and `at` from main.
One names `core/size-build-guard`; five name `core/size-guard-bypasses`.
All six keep the date `2026-10-10`.
Existing ids are kept once, rather than copied into duplicate rows.
The maps and sets record one build scan, not app state.
The new `argumentCasts` and `settle` labels are false for that same reason.
No label value changed in this fix round, so calibration is unchanged.
The code preflight has zero file flags and six function flags, all labelled.

The guard-test scan finds zero flags in all 94 tests.
The Core package scan still finds seven old test flags and one old timer note.
The promise scan reads unchanged package tests rather than `build/`.
Those old package findings remain outside this ticket's allowed files.
Changed assignment code and tests pass the strict style census.
The full-file scan still reports the prior build-tool code and invalid plant strings.
The TSDoc parser finds zero bad doc rows.

Core feedback from the takeover: none.

## core/private-fields-regen

Branch: `core/private-fields-regen`.
Base: `origin/main` at `772adf6f`.
The lead owns the board and landing.

### Change

The committed list held 48 names. The write mode finds 55.
Ran the repo's write mode: `vp run core#fields`.
Only `build/private-fields.json` changed: seven names added, none removed.

- `borrows`
- `controllerOf`
- `deferFn`
- `lastController`
- `lastTarget`
- `mayHook`
- `releaser`

No added name is in a public type file.
No added name is read outside Core without a type check.
`mayHook` is set on each resource handle at run time.
No public type names it, and no repo code reads it.

### Test first

New test: "the shipped list renames each runtime field it lacked in every built file".
On `origin/main` the list check fails: the list has 48 names.
With the list check removed, the build check still fails: `borrows` is in code.
The build uses `minify: true`, as the real build does.
Run: `vp test --config vite.dist.config.ts build/private-fields.test.ts`.

### Dist diff

- The `.d.mts` type files do not change.
- `index.mjs` and `testing.mjs` change.
- A syntax-tree diff finds the same tree shape.
- Every changed identifier is a property name.
- `index.mjs` changes 41 names: the seven new names, and 34 short names.
- Short names follow use counts, so the seven new names move the others.

### Size

- Before: 16026 B gzip.
- After: 15988 B gzip.
- Cap: 16384 B gzip.

### Checks

- `vp run -r build`: exit 0.
- `scripts/ticket.sh --check-only --no-mutation core 42`: exit 0.
- `vp check`: 0 errors, 27 warnings. `origin/main` has 27.
- `vp run -r test`: all packages pass.
- `core#test:dist`: 978 tests pass.
- `pnpm validate`: all 20 lanes pass.
- Mutation: not run. `src/` is unchanged and `build/` is not mutated.
- Timing: not run. The card does not ask for it.
- Jev review and preflight: 0 flags, so no label is owed.
- Jev tests.mjs and promises.mjs: not run; the gateway key hit its $10.00 budget (HTTP 402, quota_for_entity_exceeded).

## core/fastclose-free-data

Code head: `8ced8d56`. Proof head: `8a49ee99` (the two later commits change Jev labels only).
Base for timing and for the failing tests: `origin/main` `19921aba`.

A fast close now drops its store.
The store used to stay until GC, so a held data controller read the last write.

Decision: a held controller reads the initial value, or the parent's value.
This is the README promise (`A closed scope's held controller reads the initial value back`) and `index.test.ts`.
ADR 0069's "a read after close throws `Disposed`" is about `session.resolve`, which still throws.
Not chosen: `Disposed` on the controller.
It would change the README and that test, and it needs a check on every `get`.

How it works:

- The no-hook, no-`withData` close sets `layer.nodes` to the shared empty store.
  It makes no walk over the nodes.
- A held controller's cached read checks `layer.closed` and takes the slow read.
- Close paths with hooks or `withData` keep the store, as before.

Failing first: four tests in `packages/core/tests/with-data.test.ts` fail on `19921aba`.
Each fails with `expected 5 to be +0` or `expected 7 to be +0`.
They pass on this head: 11 of 11 in that file.

GC probe (`docs/roadmap/perf/handle-verbs-ctl-sol-gc.mjs`, `node --expose-gc`):

- `19921aba`: root freed; parent close without child hook ALIVE; parent close with child hook freed.
- `8a49ee99`: all three lines say `freed`.

Read probe, held controller after close:

- `19921aba` (pre-fix build, same source): fast child 5, slow child 5, child closed alone 5, root 5, hooked child 0.
- `8a49ee99`: all 0 (the initial value).
- `session.resolve` after close still throws `Disposed`.

Timing, N=61, A = `19921aba`, B = `8a49ee99`:

- Run through `bench/queued.sh` under `flock /tmp/mutation.lock`, one scenario per job.
- Verdict: paired sign test, two-sided, p < 0.01, ties left out.
- Raw rows: [final CSV](fastclose-free-data-final-vs-19921aba.csv).
- `git -C <base> rev-parse HEAD`: `19921aba58a4a15498ca2d04403736bd0689191a`.

| Row           | A → B (ns)        | Slower | p      | Verdict                    |
| ------------- | ----------------- | ------ | ------ | -------------------------- |
| `op`          | 63.10 → 63.80     | 31/61  | 0.80   | no difference              |
| `run`         | 78.70 → 78.30     | 25/61  | 0.25   | no difference              |
| `opres`       | 275.60 → 276.40   | 34/61  | 0.44   | no difference              |
| `inline`      | 99.50 → 100.00    | 40/61  | 0.0135 | no difference (above 0.01) |
| `session`     | 460.10 → 455.70   | 29/61  | 0.80   | no difference              |
| `tagged`      | 189.70 → 190.00   | 34/61  | 0.44   | no difference              |
| `taggeddefer` | 253.30 → 252.30   | 29/61  | 0.90   | no difference              |
| `taggedres`   | 2666.90 → 2581.70 | 24/61  | 0.12   | no difference              |
| `create`      | 26.40 → 26.40     | 21/61  | 0.88   | no difference              |
| `cold`        | 662.00 → 664.90   | 33/61  | 0.52   | no difference              |
| `warm`        | 9.10 → 9.10       | 2/61   | 1.00   | no difference              |
| `lifecycle`   | 823.10 → 825.20   | 33/61  | 0.61   | no difference              |
| `s1_getctl`   | 123.90 → 123.60   | 29/61  | 0.80   | no difference              |
| `s2_data`     | 159.10 → 158.90   | 31/61  | 1.00   | no difference              |
| `s3_doubled`  | 397.90 → 400.10   | 35/61  | 0.31   | no difference              |
| `s4_warm_ctl` | 0.70 → 0.70       | 0/61   | 1.00   | no difference              |

No row is B slower.
`inline` is the closest: 40 of 61 slower, +0.5%, p = 0.0135.

Extra row, `get1` (the data `get` path, not in the 16): 0.4 → 0.4 ns, 61 ties.
[CSV](fastclose-free-data-get1-vs-19921aba.csv).

Rejected timing attempts, all on `lifecycle` or on the rows above:

- Free with a new `Map` per close: lifecycle +11.2%.
- Free with `NO_NODES`, walk per node: lifecycle +8.5%.
- Flag set on every node, checked with `isData`: lifecycle +13.6%.
- Flag set in `dataController`, walk in `fastClose` with `for...of`: lifecycle +5.1%.
- Walk moved out of line: lifecycle −0.6% (p 0.80), but a new `Layer` field
  then slowed `create` +5.3%, `op` +6.2%, and `s2_data` +1.9%.
- The shipped design drops the field and the walk, so those rows are back to parity.

Size: 16043 B gzip, cap 16384 B (`vp run size`).

Fast-code ratchets (`node scripts/check-fast-code.mjs`):

- `runOnce` 498, ceiling 499.
- `runHookBody` 297, ceiling 298.
- Core slots 338, ceiling 339.
- Complexity cap 8: unchanged.

Mutation, Core lane alone under the lock, on `8a49ee99`:

- Log: [mutation log](fastclose-free-data-mutation.txt).
- Killed 3040, timed out 30, survived 466, no coverage 35, errors 3.
- Kills alone: 3040 / (3040 + 466 + 35) = 85.85%. Floor 85.
- With timeouts counted: 85.97%.

Gates:

- `scripts/ticket.sh --check-only --no-mutation core 41`: EXIT 0 on `8a49ee99`.
- `vp check`: 0 errors, 27 warnings (main's count).
- Core tests: 887 on source, 948 on built files.
- `pnpm validate`: 20 lanes PASS, exit 0.

Jev (`by core/fastclose-free-data`):

- `fastClose`, `stateOutsideCell`, false: the layer fields are private bookkeeping.
- `fastClose`, `waitsOnSideWork`, false: no `await`.
- `keepData`, `stateOutsideCell`, false: writes the private `SessionHooks` record.
- `keepData`, `awaitsSyncWork`, false: no `await`.
- Jev calibrate: not run; the gateway key hit its $10.00 budget (HTTP 402). Card jev/recalibrate-after-key owns it.

Core feedback: no failing snippet.
The docs disagree about reads after close.
`docs/decisions/0069` says a read after close throws `Disposed`.
The README line about a held controller says it reads the initial value.
The fix follows the README and the test.

## core/size-guard-iterable-assign

Branch: `core/size-guard-iterable-assign`.
Base: `origin/main` at `85f7f55d`.
Commit: `6081ecda`.
The lead owns the board and landing.

### Change

A for-of assignment reads one element of its source.
The guard took that element from a numeric index only.
So arrays and tuples worked. Other iterables did not.

The guard now finds the element nearly the way TypeScript does:

- Arrays and tuples: the numeric index, as before.
- Other iterables: the `[Symbol.iterator]()` method, then its `next()`.
- `for await`: the `[Symbol.asyncIterator]()` method, then `next()`.
- `for await` settles a promised element.
- The yield type is `T` of `IteratorResult<T, R>`.

The yield type is not the whole `value` union. That union adds `R`.
So `Generator<{ layer: number }, any>` would wrongly read as `any`.

The sync API has no iterated-type call. So the guard repeats the protocol.

- Known gaps (follow-up core/size-guard-iterable-edges): an `any`-typed `[Symbol.iterator]()` or `next()`, a `next()` with several overloads, `PromiseLike` under `for await`, and a user symbol named `iterator`; one false flag on a hand-written `{ done: true; value: any }` result.

### Plants

G72 to G77 are new: six tests. Each fails on `origin/main`.

- G72: `for ({ layer } of s)` with `Set<any>`.
- G73: `for ([, { layer }] of m)` with `Map<string, any>`.
- G74: `for ({ layer } of gen())` with `Iterable<any>`.
- G75: `for await ({ layer } of it)` with `AsyncIterable<any>`.
- G76: `for await` over `Set<Promise<any>>`.
- G77: a hand-written iterator with no `IteratorResult` alias.

Controls, unflagged on both heads:

- a typed Set;
- a Map with an `any` key and a typed entry;
- a `Generator<T, any>` with typed `T`;
- a typed AsyncIterable under `for await`.

Run: `vp test --config vite.dist.config.ts build/private-fields.test.ts`.

- `origin/main` with the new tests, filtered: 6 failed, 6 passed.
  The 6 passed are the four controls, R3, and R6.
- This head: all 105 tests in the file pass.
- Before this change the file had 95 tests.

### Build proof

- All nine dist files match `origin/main` byte for byte (`diff -r`).
- Write mode (`CORE_PRIVATE_FIELDS=write vp pack`) finds 55 names.
- `build/private-fields.json` is unchanged.

### Checks

- `vp run -r build`: exit 0.
- `vp check`: 0 errors, 27 warnings. `origin/main` has 27.
- `vp run -r test`: exit 0. Core source: 883 tests pass.
- `vp run core#test:dist`: exit 0. 988 tests pass.
- `scripts/ticket.sh --check-only --no-mutation core 43`: exit 0.
- `pnpm validate`: exit 0. All 20 lanes pass.
- Core runtime: 15988 B gzip, cap 16384 B.

### Mutation

Not run. `src/` is unchanged and `build/` is not mutated.
The plants are the proof.

### Timing

Not run. This change makes no speed claim.

### Jev

- `preflight.mjs origin/main..HEAD`: HTTP 402, budget exceeded. Not retried.
  It failed on its first judge, so it gave no flags.
- `promises.mjs core`: not run. It uses the same gateway.
- `tests.mjs core`: ran. 7 flags, none in `build/`.
- No labels written. Calibrate: skipped, because no label was written.
- `tools/jev/cases.jsonl` is unchanged.

### Core feedback

- The TS 7 sync API has no iterated-type call.
- Well-known symbol keys carry a program id, so a plain name misses.

```ts
checker.getPropertyOfType(apparent, "__@iterator");
// undefined: the key is "__@iterator@2" in this program
```

## core/held-controller-pins-value

Branch: `core/held-controller-pins-value`.
Base: `origin/main` at `807c388b` for the timing and the first gates.
Rebased onto `origin/main` `3e2a2346`.
Commits, in order:

- Probe test, README bullets, timing CSV: `fb3813d1`, rebased as `7d5877c3`.
- PROGRESS and the rebase note: `5306430e`, `f0fd7865`.
- Slow-close cases, README line, ADR 0069 line: `557817c9`.
- This section: the last commit.

The lead owns the board and landing.

### Decision

A held data controller keeps its last write alive after close, on every close path.
The contract is documented. Freeing it is not built.

Where the write sits, and why each path keeps it:

- Fast close, no watcher: the write is in the node's `cell`.
  Clearing `cell` needs a walk over the nodes on fast close.
  That walk costs the `lifecycle` row: +8.8%, B slower (see Timing).
- Fast close with a watcher: the write is also in `prev`, the value the watcher last saw.
  `prev` is set when a watcher is added (`index.ts:1513`) and on each notify (`:1337`).
  A walk must clear `prev` too.
- Slow close (`startClose` to `finishLayer`, `index.ts:4027`): the loop already walks the nodes.
  Adding `cell` and `prev` to that loop costs no new walk. This was not timed.
  Fast close would still keep the write, so freeing only on the slow path is uneven. Not built.
- Session under a session hook: `keepData`, then `freeData` (`index.ts:4500`, `:5007`).
  `freeData` drops the node map without a walk, so `cell` stays.

The contract, as kept:

- A held controller keeps its last write until the controller is dropped.
- A held controller still reads the initial value after close.

### GC probe

Test: `packages/core/tests/held-controller-retention.test.ts`, seven tests.
It writes a 200,000-item array through a held controller, closes, forces `gc`, and checks a `WeakRef`.
The held controller stays referenced until the check.

The six retention cases:

- Root closed fast, no watcher.
- Root closed fast, with a watcher.
- Session closed fast.
- Session closed under a session hook.
- Root closed slowly, with an `onClose` hook.
- Session swept by a root closed slowly.
  The session also has its own `onClose`.
  An idle child fast-closes even under a slow parent (`closeEach`, then `closeLayer`, then `canFastClose`).

The seventh is a control: no held controller, and a closed root frees its write.

Failing first, on `origin/main` `807c388b` (`/tmp/main-check-held-controller-pins-value`, removed after):

- The first version expected a freed write.
- Root, watcher, session, and hook cases: ALIVE. Four fail.
- The control frees its write and passes.
- The first version waited between `gc` passes with a 20 ms timer.
  The committed version waits with `setImmediate`.

On this head the seven tests pass. `packages/core/src` equals `origin/main`'s.

Slow-close check (review fix round):

- Add `s.eff = s.cell = s.prev = undefined;` to the `finishLayer` loop (`index.ts:4027`), temporarily.
- The slow root and the swept session fail.
- The other five pass.
- Reverted.

Fast-close check (same round):

- Add `s.cell = s.eff = s.prev = undefined;` to the fast-close no-hook branch, temporarily.
- The fast root, the watcher root, and the fast session fail.
- Reverted.

### Walk candidate, timed and reverted

The timed candidate cleared `cell` and `eff`, in the fast-close no-hook branch.
It was not committed. Its place was just before `layer.nodes = NO_NODES;`.
Rebuild it from this snippet:

```ts
for (const s of layer.nodes.values()) {
  s.cell = undefined;
  s.eff = undefined;
}
```

Probe result with the candidate:

- Root closed fast, no watcher: freed.
- Session closed fast: freed.
- Root with a watcher: still ALIVE. `prev` was not cleared.
- Session under a hook: still ALIVE. It takes `freeData`, not this branch.
- Slow close: still ALIVE. This branch does not run.

Adding `s.prev = undefined` to the same loop frees the watcher case too.
That check ran, then reverted. The timed candidate did not clear `prev`.

Timing: N=61, A = `origin/main` `807c388b`, B = the candidate.

- Run: `flock /tmp/mutation.lock`, then `N=61 A=<base> bench/queued.sh`, one job per row.
- Base worktree: `/home/paseo/next/tinkered-held-base` at `807c388b`. Removed after the run.
- Verdict: paired sign test, two-sided, ties left out.
- Box load reached 17.6 on 8 cores during the run.
- The `s4_warm_ctl` row used the probe from before `7661d113`.
- Raw rows: [CSV](held-controller-pins-value-walk-vs-807c388b.csv).

Rows, A to B (ns), slower rounds, p, verdict:

- `op`: 63.50 to 64.10, 29/61, p 0.90, no difference we can see.
- `run`: 78.40 to 78.10, 28/61, p 0.70, no difference we can see.
- `opres`: 276.20 to 275.70, 26/61, p 0.37, no difference we can see.
- `inline`: 99.40 to 100.10, 33/61, p 0.36, no difference we can see.
- `session`: 463.70 to 463.80, 27/61, p 0.44, no difference we can see.
- `tagged`: 190.00 to 190.80, 32/61, p 0.70, no difference we can see.
- `taggeddefer`: 252.70 to 252.40, 26/61, p 0.31, no difference we can see.
- `taggedres`: 2585.20 to 2597.90, 26/61, p 0.31, no difference we can see.
- `create`: 28.40 to 29.20, 27/61, p 1.00, no difference we can see.
- `cold`: 687.50 to 690.60, 33/61, p 0.52, no difference we can see.
- `warm`: 9.20 to 9.20, 10/61, p 0.83, no difference we can see.
- `lifecycle`: 1126.20 to 1224.80, 53/61, p < 0.0001, B slower (+8.8%).
- `s1_getctl`: 130.90 to 131.40, 29/61, p 0.80, no difference we can see.
- `s2_data`: 166.60 to 167.10, 34/61, p 0.44, no difference we can see.
- `s3_doubled`: 403.70 to 402.80, 33/61, p 0.61, no difference we can see.
- `s4_warm_ctl`: 0.70 to 0.70, 0/61, p 1.00, no difference we can see.

Verdict: the walk fails the bar, because `lifecycle` is B slower.
The candidate was reverted before the commit.

### Shipped change

- No `src/` change. `packages/core/src` is byte-identical between `fb3813d1` and the fix head.
- So the mutation run on `fb3813d1` covers the same Core source.
- The test file did change after that run. Two slow-close cases were added in the fix round.
- The review said not to re-run mutation, so the kill numbers are from the earlier 5-test file.
- No field changed, so private-fields was not written.

### Size

- Core runtime: 16006 B gzip, cap 16384 B.
- Before and after: the same. The source did not change.

### Checks

Run on the fix head, `557817c9` and the docs commit after it.

- `vp run -r build`: exit 0.
- `vp check`: 0 errors, 27 warnings. `origin/main` has 27.
- `vp run -r test`: exit 0. Core source: 894 tests pass, 7 of them in the new file.
- `vp run core#test:dist`: exit 0. 999 tests pass.
- `vp run prose`: exit 0. 0 hits.
- `pnpm validate`: exit 0. All 20 deterministic lanes pass.

### Mutation

- Lane: `vp run core#mutate`, run inside `scripts/ticket.sh`, on `fb3813d1`.
- The tree was clean, under `flock /tmp/mutation.lock`.
- Killed 3046, timed out 38, survived 452, no coverage 35, errors 3.
- Kills alone: 3046 / (3046 + 452 + 35) = 86.2%. Floor 85.
- With timeouts counted: 86.36%.
- Not re-run after the two slow-close cases were added, per the review.

### Jev

- `preflight.mjs origin/main..HEAD`: exit 0. No source file changed, so no judge ran.
- No flags, so no labels.
- `tests.mjs core`: ran. 7 of 844 entries flagged. None in the new test file.
- `promises.mjs core`: failed at the gateway. The message was
  "API key budget exceeded. Current spend: $10.00, limit: $10.00". Not retried.
  So Jev did not check the new README bullets against the test titles.
- `calibrate.mjs`: not run, as the brief says.
- No Jev call in the fix round.

### Core feedback

A held controller pins its last write after close.
The controller reads through a record it captured, so a free needs a walk.

```ts
const root = createScope();
const held = root.controller(cell);
held.set(Array.from({ length: 200_000 }, () => 1));
await root.close();
// gc(): the array is still reachable through `held`
```

## core/size-guard-iterable-edges

Branch: `core/size-guard-iterable-edges-sol`.
Started from `origin/main` at `807c388b`.
Rebased onto `3e2a2346` after the green code step.
First code commit: `7630f17a`.
Review fix commit: `2f7958b9`.
The review fix removes duplicate types by their `type.id`.
The lead owns the board and landing.

The first pass stays at `5d0d132e` in its own worktree.
Its local archive tag is `archive/size-guard-iterable-edges-haiku-5d0d132e`.
The takeover keeps its code and plants, with the fixes below.

### Change

- An `any` `[Symbol.iterator]()` or `next()` keeps answering `any`.
- Every `next()` overload contributes its yielded types to a list.
- The assignment walk carries that whole list through each nested target.
- A name is flagged when any source type in the list flags its read.
- Union members stay in the list; none stands for all the others.
- Source, union, iterator, and yielded-type lists keep each `type.id` once.
- A recursive property can point to the whole union without multiplying the list at each target level.
- `settled` itself stays unchanged in the review fix.
- The global `Symbol.iterator` is found through `resolveName("Symbol")` and its unique symbol id.
- A user symbol named `iterator` has a different id and cannot take its place.
- `for await` settles each union it finds, including a union inside a promise value.
- A union split keeps the depth already spent on outer promise layers.
- The loop still stops after eight promise layers.
- A circular thenable reaches the cap and counts as `any`.
- A `done: true` result ends the loop, so its value does not count.

The sync API has no `getAwaitedType` and no `getUnionType`.
The guard reads promise values from `then` callback parameters.
It carries a `Type[]` through `assignmentTarget` and `sourcePart` instead of building a union.
The first overload no longer stands for the rest.

### Failing tests first

The tests were written before the takeover's code.
The copied tests ran against `origin/main` at `807c388b` in `/tmp/main-check-size-guard-iterable-edges-sol`.

- Filter: G78 to G87 and the `done: true` control.
- Result: ten failed, one passed, exit 1.
- G78 to G85 and G87 passed the build when they should fail it.
- The `done: true` control failed the build when it should pass.
- G86 passed its test: main already catches this result union.

The three new tests then ran in the ticket worktree with the first pass's guard from `6c5a45d8`.
All three failed because the build accepted the read: exit 1.
G86 proves a lost case from the first pass, rather than a new bug on main.

New plants:

- G85: a nested target reads `{ a: any }` from the second `next()` overload, after the typed overload.
- G86: the same nested target reads a result union with a typed `done: false` branch first and an unchecked `done: boolean` branch second.
- G87: `for await` reads `Promise<{ layer: number } | PromiseLike<any>>[]`.

Kept plants:

- G72: `Set<any>`.
- G73: `Map<string, any>`.
- G74: a function returning `Iterable<any>`.
- G75: `AsyncIterable<any>`.
- G76: `Set<Promise<any>>` under `for await`.
- G77: a hand-written iterator with an unchecked value.
- G78: `[Symbol.iterator]()` returns `any`.
- G79: `next()` returns `any`.
- G80: `PromiseLike<any>[]` under `for await`.
- G81: a later `next()` overload yields `any`.
- G82: a user symbol named `iterator` comes before the real symbol.
- G83: `(PromiseLike<any> | number)[]` under `for await`.
- G84: a circular thenable under `for await`.

All 118 guard tests pass.
Every plant G72 to G87 fails the build with the named guard error.
All controls pass, including the `done: true` control.
The 105 tests from main and the first pass's eight tests stay green.

### Review fix: recursive union lists

The review found repeated types in `sourcePart`.
Each recursive member could add the whole union again at every nested property.
The fix keeps each type id once in `sourcePart` and the other source list builders.
The plain assignment entry also uses the deduped `typeParts` list.
No limit drops a distinct source type.

G88 and G89 were written before the dedupe.
Their final fixture ran against `2a1e8232` in `/tmp/main-check-size-guard-iterable-edges-sol`.
Both failed with `ETIMEDOUT` at their ten-second child deadline: exit 1.

- G88: a 20-member recursive union, with four `a` properties in a for-of assignment target.
- G89: the same union and target in a plain destructuring assignment.
- Both expect the build to pass with an empty error string.
- Both pass with the dedupe, alongside all 116 earlier guard tests.

The checker walk runs synchronously and can block a test worker's timer.
These tests run the real build in a child with a ten-second deadline and `SIGKILL`.
The child packs both Core entries, as the existing guard fixture does.
The deadline is a hang check, not a benchmark.

Red proof: `/tmp/size-guard-iterable-edges-sol-round1-red3.log`.

### Parity probes

A scratch script packed each shape twice with the guard.
One pack used `for ({ ... } of s)`.
The other used `for (const { ... } of s)`.
The async rows used `for await` in both forms.
It also checked each expected flagged or unflagged result.
All 44 earlier probes agree, including the two extra first-pass shapes and the new plants.
The review fix reran them and added G88: all 45 probes agree.

Flagged in both forms:

- 1: G72, `Set<any>`.
- 2: G73, `Map<string, any>` with an array target.
- 3: G74, a call returning `Iterable<any>`.
- 4: G75, `AsyncIterable<any>`.
- 5: G76, `Set<Promise<any>>`.
- 6: G77, a hand-written iterator.
- 7: G78, an iterator method returning `any`.
- 8: G79, `next()` returning `any`.
- 9: G80, `PromiseLike<any>[]`.
- 10: G81, a later `any` overload.
- 11: G82, a user iterator symbol first.
- 12: G83, a union of `PromiseLike<any>` and `number`.
- 13: G84, a circular thenable.
- 21: an array whose element union contains `any`.
- 22: `AsyncIterable<PromiseLike<any>>`.
- 23: `Promise<PromiseLike<any>>[]`.
- 24: a custom thenable that gives `any` to its callback.
- 25: an unchecked value with `done?: false`.
- 26: `[Symbol.iterator]: any`.
- 27: nested unions of iterables, including `Set<any>`.
- 28: a typed array or `Set<any>`.
- 30: an iterator returning `Iterator<any, void>`.
- 31: `PromiseLike<PromiseLike<any>>[]`.
- 33: a class with its user iterator symbol first.
- 34: the same class with its real iterator symbol first.
- 36: two thenables that point back to each other.
- 37: `Promise<any>[]`.
- 41: G85, a nested target with the typed overload first.
- 42: G85 with the overload order swapped.
- 43: G86, a nested target over a result union.
- 44: G87, a union inside a promise value.

Unflagged in both forms:

- 14: a `done: true` branch whose value is `any`.
- 15: a typed Set.
- 16: a Map with an `any` key and a typed value.
- 17: a typed Generator with an `any` return.
- 18: a typed AsyncIterable.
- 19: a typed `IteratorResult<T, any>`.
- 20: a typed result with `done: boolean`.
- 29: generic `next<T>()`.
- 32: a value with `then: any`.
- 35: `Iterable<unknown>`.
- 38: a typed PromiseLike.
- 39: a typed array.
- 40: a union of typed iterables.
- 45: G88, a 20-member recursive union through four properties.

The scratch script and logs use `/tmp/size-guard-iterable-edges-sol-`.
No scratch test was committed.

### Scope and limits

Core source, the saved field list, and all ratchets are unchanged.
No complexity ceiling was raised.
The cap stays at 8.

The next card owns these limits:

- Async `next()` and iterator method overloads can give false flags because TypeScript combines their types with `&`.
- A typed promise deeper than eight layers can give a false flag.
- `then(cb: () => void)` is not handled here.
- `{ done?: true; value: any }` can give a false flag.
- `checkForOf` still visits every for-of loop.
- `settled` does not remove repeated paths inside its recursion.
- A union of n thenables can still make n^8 paths within `settled`.

### Build proof and gates

- All nine dist files match the saved `origin/main` build byte for byte.
- The rebase added no Core source or build change from main.
- Write mode found the committed 55 names.
- `private-fields.json` stayed byte for byte unchanged.
- Core source and `scripts/fast-code-baseline.json` have no diff from `origin/main`.
- `scripts/check-fast-code.mjs` passed in the validate lane with the saved ratchets.
- Core slots: 338; `runOnce`: 498 bytes; `runHookBody`: 297 bytes.

The full chain passes and is rerun on the clean proof head before handoff.
Every command runs from the ticket worktree.

- `vp run -r build`: exit 0.
- `vp check`: exit 0, zero errors and the same 27 warnings as main.
- `vp run -r test`: exit 0; Core source has 887 passed tests.
- `scripts/ticket.sh --check-only --no-mutation core 45` with the title below: exit 0.
- Title: `Guard all iterable source types`.
- `vp run core#test:dist`: exit 0; 1005 tests pass, including all 118 guard tests.
- `pnpm validate`: exit 0; all 20 lanes pass.
- `vp run prose`: exit 0; zero hits in 229 files.
- Chain result: `EXIT 0`.
- No timeout or OOM retry was needed.

The first handoff logs keep the prefix `/tmp/size-guard-iterable-edges-sol-gate`.
The review fix logs keep the prefix `/tmp/size-guard-iterable-edges-sol-round1-`.
Its first full green chain is `/tmp/size-guard-iterable-edges-sol-round1-gate2.log`.
Its clean-head chain is `/tmp/size-guard-iterable-edges-sol-round1-gate3.log`.
The repeated parity log is `/tmp/size-guard-iterable-edges-sol-round1-parity.log`.
The clean gate log prints the commit and checks for a clean tree before and after the chain.
The separate main-check worktree was removed.
The ticket worktree and branch stay for review.
Nothing was pushed.

### Mutation and timing

Mutation was not run.
`src/` is unchanged, and the lane only mutates `src/`.
`build/` is not mutated; the failing plants prove this fix.
There is no mutation score or clean mutation commit for this ticket.

No timing queue job was run.
The following are the reviewer's single-run wall-clock checks.
They are diagnostics, not benchmarks or paired timing verdicts.

- 400 members through two properties: main 0.1 s; `2a1e8232` 9 s.
- 20 members through three properties: `2a1e8232` 10 s.
- 20 members through four properties: no answer from `2a1e8232` within 90 s.
- 400 members through three properties: no answer from `2a1e8232` within 90 s.
- Reviewer scratch dedupe, 20 members through four properties: 0.1 s.
- Reviewer scratch dedupe, 400 members through three properties: 1.3 s.

The committed tests prove completion before a deadline.
They do not claim a speed ratio.

### Jev and style

The review fix made no gateway calls, as requested.
Preflight, test judges, promise judges, labels, and calibration were not run again.
The ticket gate has no key and runs no judge.
The gateway budget is spent.
The steps below are the first handoff's record.

- Preflight ran once on `origin/main..HEAD`: exit 1, HTTP 402, budget exceeded.
- It failed at its first judge and gave no flags.
- It was not retried.
- The first ticket gate's `review.mjs` also hit HTTP 402.
- The clean gate leaves the key unavailable to that advisory step so it makes no retry.
- `tests.mjs core` and `promises.mjs core` did not run: both need the spent gateway budget.
- Calibrate did not run, as requested.
- No Jev labels were written; `tools/jev/cases.jsonl` is unchanged.
- Changed functions and new tests pass the strict style census.
- The full-file census has the same prior build-tool and plant-string hits as main.
- The TSDoc parser reports zero S26 rows.

### Core feedback

None from the takeover.

### Lander check

The lander reran these on `8fc7fe97` in a scratch worktree.

- `sourcePart`, `typeParts`, and the iterator lists keep each `type.id` once.
- `checkAssignment` takes its list from the deduped `typeParts`.
- The guard file: 118 passed; G88 0.8 s, G89 0.7 s.
- 5 shapes, both forms, agree: G85, G86, and G87 are flagged.
- The two recursive shapes are unflagged in both forms.
- 400 members through three properties: 3.1 s for the assignment form.
- 20 members through four properties: 0.6 s.
- These are single wall-clock runs, not benchmarks.

At landing the branch was rebased onto `b8efe5d3`.
That main change touched no Core source or build file.
Every gate was rerun on the rebased head.

## core/size-guard-forof-cost

Branch: `core/size-guard-forof-cost`.
Started from `origin/main` at `6251a860`.
Code commit: `99eb1e6e`.
The lead owns the board and landing.

### Change

- `checkForOf` skips the element walk unless the target is an object or array literal.
- Other targets read nothing from the element, so the walk never changed an answer.
- `settled` walks one promise layer at a time.
- Each layer keeps each `type.id` once.
- A union that settles to the whole union costs one step per member and layer.
- The 8-layer limit and its `any` answer stay the same.
- `isLiteralTarget` is shared with `isDestructuringAssignment`.

Two limits from `core/size-guard-iterable-edges` are now closed:

- `checkForOf` visited every for-of loop.
- `settled` walked repeated paths, so n thenables made n^8 paths.

### Failing tests first

- G90: four thenables read by `for await (const x of ps)` build within 5 s.
- G91: the same thenables read by `for await ({ layer } of ps)` fail with the `layer` error within 5 s.
- A probe reaches the walk only when its file names a listed field.
  Both probes declare `let layer`.
- Red proof: `/tmp/main-check-size-guard-forof-cost` at `6251a860`.
  At the first 1 s deadline, both time out with `ETIMEDOUT`.
  Log: `/tmp/size-guard-forof-cost-red-main.log`.
  At 5 s, origin/main still fails both: its runs take about 22 s.
- Green: both pass in the ticket worktree.

### Which test pins which change

Three full guard runs, same test file, 5 s deadline.
These are pass or fail checks, not timing.

- origin/main, with the new tests: G90 and G91 fail; the other 118 pass.
- Skip only, dedupe reverted: G91 fails; the other 119 pass.
- Dedupe only, skip reverted: all 120 pass.

So:

- G91 fails without the dedupe. It pins the dedupe.
- No test fails without the skip. G90 fails only when both changes are gone.
- The skip changes no answer. The parity runs below show it.

### Probe timing, single runs

origin/main, four thenables, `layer` named:

- Declaration form: 22.2 s.
- Assignment form: 22.4 s.

This branch, same probe, five runs per form:

- Declaration form: 0.66 to 0.76 s.
- Assignment form: 0.71 to 0.79 s.

Each time includes Node start and a Core pack.
A reviewer saw one plain probe build take 4.8 s on this box.
So the deadline is 5 s, not 1 s.
It is a hang check, not a benchmark.

### Parity: assignment form vs `for (const …)` form

A scratch script ran G72 to G91 in both forms on both trees.
It is not committed.
Each plant reads `flag` when the guard fails the build.

- G72 to G87: flag in both forms (16 plants).
- G88: pass in both forms.
- G89: pass; it is not a for-of, so it has no declaration form.
- G90: pass as a declaration; it has no assignment head.
- G91: flag in both forms.

All 20 rows give the same verdict on `origin/main` and this branch.
That is 38 runs per tree.
Logs: `/tmp/size-guard-forof-cost-parity2-main.log` and
`/tmp/size-guard-forof-cost-parity2-fixed.log`.

### Build proof and gates

- The nine dist files match the `origin/main` build byte for byte.
- Write mode gives the committed 55 names.
- `private-fields.json` has no diff.
- `vp run -r build`: exit 0.
- `vp check`: 0 errors, 27 warnings, the same as main.
- `vp run -r test`: exit 0.
- `scripts/ticket.sh --check-only --no-mutation core 47`: exit 0.
- `vp run core#test:dist`: exit 0; 1014 tests pass, 120 of them guard tests.
- `pnpm validate`: exit 0; all 20 lanes pass.
- Complexity: oxlint caps it at 8; both changed files pass.
- Ratchets: `scripts/fast-code-baseline.json` is unchanged.
- Fix round: the guard file (120), `vp check` (27 warnings), `vp run -r test`,
  the ticket check-only gate, `core#test:dist` (1014), `pnpm validate` (20 lanes),
  and `vp run prose` (0 hits) all passed again on `d3e384cb`.

### Build time, benchd queue

Single series, three runs each, median:

- Before, `origin/main`: 6625 ms (min 6149, max 6743).
- After, this branch: 4861 ms (min 4802, max 4871).

`benchctl ab` was not run.
It sees one folder, and each side here needs its own.
Read the gap as two single series, not a verdict.

### Mutation

Mutation was not run.
`packages/core/src` is unchanged.
`build/` is not mutated.
The pins are listed under "Which test pins which change".

### Jev and style

- Preflight ran once on `origin/main..HEAD`.
  It exited 1 with HTTP 402: "API key budget exceeded".
  It was not retried.
- `tests.mjs core` ran.
  It flagged 7 of 846 entries, none in `build/private-fields.test.ts`.
- `promises.mjs core` did not run.
  It hit the same 402 budget error.
- No labels were written.
- `calibrate.mjs` did not run.
- `tools/jev/cases.jsonl` is unchanged.

### Core feedback

None.

### Open

- The guard log prints `context canceled` lines from the checker.
  Full runs print 6 on `origin/main` and 13 on this branch.
  No test fails from them.
  The cause is not traced.
- The 5 s deadline on G90 and G91 is wall-clock.
  A very slow box could still hit it; raise it if that happens.

## core/closed-read-stale

Branch: `core/closed-read-stale`.
Cut from `origin/main` `aae70504`, then rebased onto `origin/main` `eff48797`.
Commits, in order:

- Fix and tests: `4de3d199`.
- README and ADR 0069: `849ca0c6`.
- Timing CSV: `e693f132`.
- This section, and one README line about the hook's `resolve`: the last commit.

The lead owns the board and landing.

### Bug and contract

A closed layer leaves its parent's child list first.
So a later write on an ancestor never reaches the layer's memo.
A memo is a saved copy of an ancestor's value on a layer's record.

The contract, as built: always look the value up again.

- A closed layer reads the cells at and above it.
- It never reads a memo.
- Once no layer above it holds a write, it reads the initial value.

Why this one:

- `held.get()` stays non-throwing, as the README says.
- Close adds no walk.
- An open layer's warm read is unchanged.

Not chosen: throw `Disposed` on `get`.
That would change the README and the held-controller tests.

Cost: a closed read walks its parents on each call.
Closed reads are not on the warm path.

### Change

- `dataController` `get`: a closed layer reads through `effectiveEntryNs`.
  The memo is not read or written.
- `effectiveEntryNs` takes an optional chain.
  With no chain it walks only the cells.
- `resolveHeld`: a data cell reads through `effectiveEntryNs`.
  So `resolve` in a `session` hook reads live too.

Choices made on the way:

- A first version added a helper, `readClosed`.
  It made the Core slot count 339, above `origin/main`'s 338.
  The helper was dropped.
- `resolveHeld` reached complexity 9 (cap 8) with a `??` in it.
  The `??` moved into `effectiveEntryNs`, and the count is 8.

### Failing first

On `origin/main` `eff48797` (`/tmp/main-check-closed-read-stale`, removed after).
Four new tests in `packages/core/tests/with-data.test.ts` fail there:

- `a closed leaf reads the open middle's write made after the leaf's own read`: expected 5 to be 7.
- `a closed leaf reads the open root's write made after the leaf's own read`: expected 0 to be 8.
- `a closed leaf reads the initial value once every layer above it has closed`: expected 5 to be 0.
- `a session hook reads an ancestor's write made after the session closed`: expected [0, 0] to deeply equal [8, 8].

Passing on `origin/main`: `a session hook reads its own held write after next`.
It is the keep case, and the other 11 tests in the file.

### Claims and the tests behind them

- README: "They return the nearest ancestor's current write, or the initial value when no ancestor holds one."
  Tests: the three closed-leaf tests above.
- README: "A closed scope's held controller reads the nearest ancestor's current write, or the initial value."
  Tests: the same three.
- README: "That `resolve` also reads an ancestor's current write, or the initial value."
  Test: `a session hook reads an ancestor's write made after the session closed`.
- README: "Once the hooks return, its reads no longer see that write."
  Tests: `a held controller reads the initial value once the root closes` (`with-data.test.ts`),
  and `a closed scope's held controller still reads the initial value` (`index.test.ts`).
- ADR 0069: "In the hook window `resolve` and a held data controller read."
  Tests: `a session hook reads its own held write after next`,
  and `a session hook reads the session's cells and tags after next`.
- `held-controller-retention.test.ts`: unchanged, and it passes.

### Timing

- N=61.
- A = `origin/main` `eff48797` (`/home/paseo/next/tinkered-closed-read-base`, removed after).
- B = `849ca0c6`. Its Core source is the same as `4de3d199`.
- Run under `flock /tmp/mutation.lock`: `N=61 A=... bench/queued.sh`, one job per row, 16 rows.
- Verdict: paired sign test, two-sided, exact, ties left out.
  A row is "B slower" only when p < 0.01 and most rounds are slower.
- Raw rows: [CSV](closed-read-stale-vs-eff48797.csv).

| Row           | A → B (ns)        | Change | Slower | p      | Verdict                    |
| ------------- | ----------------- | ------ | ------ | ------ | -------------------------- |
| `op`          | 62.70 → 63.40     | +1.1%  | 32/58  | 0.5118 | no difference we can see   |
| `run`         | 78.10 → 78.50     | +0.5%  | 31/60  | 0.8974 | no difference we can see   |
| `opres`       | 278.60 → 278.70   | +0.0%  | 32/60  | 0.6989 | no difference we can see   |
| `inline`      | 102.10 → 101.50   | −0.6%  | 33/61  | 0.6089 | no difference we can see   |
| `session`     | 469.20 → 464.80   | −0.9%  | 23/61  | 0.0722 | no difference we can see   |
| `tagged`      | 191.30 → 190.90   | −0.2%  | 26/60  | 0.3663 | no difference we can see   |
| `taggeddefer` | 259.40 → 260.20   | +0.3%  | 32/61  | 0.7982 | no difference we can see   |
| `taggedres`   | 2541.50 → 2565.00 | +0.9%  | 40/61  | 0.0204 | no difference (above 0.01) |
| `create`      | 26.40 → 26.40     | +0.0%  | 19/42  | 0.6440 | no difference we can see   |
| `cold`        | 667.80 → 671.20   | +0.5%  | 35/60  | 0.2451 | no difference we can see   |
| `warm`        | 9.20 → 9.20       | +0.0%  | 7/21   | 0.1892 | no difference we can see   |
| `lifecycle`   | 833.70 → 836.10   | +0.3%  | 35/61  | 0.3057 | no difference we can see   |
| `s1_getctl`   | 123.90 → 123.70   | −0.2%  | 36/60  | 0.1550 | no difference we can see   |
| `s2_data`     | 183.90 → 183.80   | −0.1%  | 33/61  | 0.6089 | no difference we can see   |
| `s3_doubled`  | 447.30 → 451.90   | +1.0%  | 28/60  | 0.6989 | no difference we can see   |
| `s4_warm_ctl` | 1.40 → 1.40       | +0.0%  | 0/0    | 1.0000 | all 61 pairs tie at 1.4 ns |

No row is B slower.
`taggedres` is the closest: 40 of 61 rounds slower, p 0.02, above the bar.
`lifecycle` is +0.3%, p 0.31.
`s1_getctl` is −0.2%, p 0.16.

### Mutation

Run: `flock /tmp/mutation.lock scripts/ticket.sh --check-only 48 "closed-read-stale"`.
Commit: `e693f132`, on a clean tree.
The gate chain exited 0: `vp check`, `vp run -r test`, core on built files, size, mutate.

- Killed 3027.
- Timed out 86.
- Survived 425.
- No coverage 35.
- Errors 3.
- Kills alone: 3027 / (3027 + 425 + 35) = 86.8%. Floor 85.
- With timeouts counted: 87.13%.

### Gates

On `4de3d199`, and the docs commits after it:

- `vp run -r build`: exit 0.
- `vp check`: 0 errors, 27 warnings. Same count as `origin/main`.
- `vp run -r test`: exit 0. Core: 44 files, 899 tests.
- `vp run core#test:dist`: exit 0. 45 files, 1019 tests.
- Size: 16006 B gzip before, 16030 B after (+24 B). Cap 16384 B.
- `pnpm validate`: exit 0. "All deterministic budget lanes PASS (20)".
- `vp run prose`: 0 hits in 229 files.
- `node scripts/check-fast-code.mjs`: all five checks PASS.
- Core slots: 338 on `origin/main` and on this branch. The saved ceiling stays 339.
- `runOnce`: 498 bytes, as before.
- No private field was added or renamed. The private-fields write mode was not run.

### Jev

- `node tools/jev/preflight.mjs origin/main..HEAD`: HTTP 402, "API key budget exceeded".
  Not retried.
- `node tools/jev/tests.mjs core`: exit 0, no 402 in the log.
  All the `with-data.test.ts` tests this ticket touches show ✓.
  It flagged 7 of 851 entries, none in `with-data.test.ts`.
  The flags are in other test files, and they are not this ticket's.
- `node tools/jev/promises.mjs core`: HTTP 402. Not run.
  The README lines above were checked by hand against the test titles.
- No Jev labels were added. `calibrate.mjs` was not run, as the lead asked.

## core/held-resolve-ns-test

Branch: `core/held-resolve-ns-test`, from `origin/main` `d7dbee23`.
Commit: `bfa7d922`, `test(core): pin resolve ns in a session hook window`.
Test only. No `packages/core/src` change, so no timing run.

### Survivor and equivalence

- Survivor: `packages/core/src/index.ts:4627`, in `resolveHeld`.
  The line is `const chain = ns?.ns === undefined ? layer.ns : nsChainOf(ns.ns);`.
- Ignoring `ns` is not equivalent.
  A named read that misses falls back to the session's default bucket.
  A value in `alice` and a value in the default bucket show the difference.

### Test

- File: `packages/core/tests/with-data.test.ts`.
- Name: `a session hook reads the cell in the namespace its resolve names after next`.
- It writes 3 in `alice`, then 4 in the default bucket, then closes.
- The hook reads `{ ns: alice }`, then `{ ns: bob }`, then no `ns`.
- It expects `[3, 4, 4]`.

### Mutant proof

On `origin/main` `d7dbee23`, in a scratch worktree (removed after):

- Without the mutant: the file passes, 17 of 17.
- With `const chain = layer.ns;` at line 4627: the new test fails.
  `expected [ 4, 4, 4 ] to deeply equal [ 3, 4, 4 ]`.

Per-line kill check, `npx stryker run --mutate "src/index.ts:4627-4627"`, on `bfa7d922`:

- 4 mutants, 4 killed, 0 survived.
- The new test kills one of them.

### Mutation score

Run under `flock /tmp/mutation.lock`, on `bfa7d922`, clean tree.
Gate exit 0.

- Killed 3035. Timeout 78. Survived 425. No coverage 35. Errors 3.
- Kills alone: 3035 / (3035 + 425 + 35) = 86.8%. Floor 85.
- Stryker total, timeouts counted: 87.13%.

### Gates

On `bfa7d922`:

- `vp run -r build`: exit 0.
- `vp check`: 0 errors, 27 warnings. Same as baseline.
- `vp run -r test`: exit 0. Core: 44 files, 900 tests.
- `scripts/ticket.sh --check-only 50 "held-resolve-ns-test"`: exit 0. It ran core tests on built files, size, and mutate.
- `pnpm validate`: exit 0. All 21 lanes pass.
  `pnpm-workspace.yaml` was not edited.

### Jev

- Preflight on `origin/main..HEAD`: exit 0. No flags.
- `tests.mjs core`: exit 0. 7 of 852 entries flagged, none in `with-data.test.ts`.
- `promises.mjs core`: "API key budget exceeded". Not retried. Not run.
- No labels were added. `calibrate.mjs` was not run, as the card asked.

### Open

- The new test title names `ns` on a hook's `resolve`.
  The README does not say that yet.
- `promises.mjs` could not check the title.
  The lead decides: add a README line, or accept the title as is.

## core/size-guard-overload-intersection

Branch: `core/size-guard-overload-intersection-sol`.
Started from `origin/main` at `d7dbee23`.
Rebased onto `origin/main` at `5b6622d9` first.
The final base is `origin/main` at `b8c118e3`.
Initial code and tests: `18fdb011`, now `46b63227` after the rebases.
The first writer stays on its own branch and worktree.
Its work is saved by the local tag `archive/overload-intersection-haiku-ca70df33`.
Nothing was pushed.
The lead owns `TODO.md` and landing.

### Rules as built

The precedent is TypeScript's iteration checker.
The declaration form is `for (const { layer } of s)`.
The guard must flag every private-field read whose declaration form gives `any`.
It may flag more.

- Join every iterator method overload that might take zero arguments.
- Skip an overload only when a parameter surely needs an argument.
- Read optional and defaulted parameters through signature parameter types.
- A parameter containing `void` may be left out.
- An array rest takes zero arguments.
- Required tuple rest entries can exclude an overload.
- No optional-parameter check casts a node to read `questionToken`.
- Join all sync and async `next()` results in one source list.
- Keep a nested `any`, even when another result has a typed property.
- Do not call `isTypeAssignableTo` to drop async `any` results.
- A result whose `done` cannot take `false` does not yield its value.
- An overload with no yielding result makes the element `any`.
  G98 pins this case.
- Name the false literal `falseLiteral`.
- Read parameter zero from every callable `then` overload.
- Read parameter zero from every callback signature.
- A missing callback parameter contributes `never`.
- A later callback parameter typed `any` still flags.
- The `then` overload follow-up is handled here too.
- Typed promises and thenables can settle beyond eight layers.
- Open each distinct `type.id` once per settle walk.
- A repeated type adds no new path.
- A cycle with no leaf answers `any`.
- A cycle with a typed leaf keeps that leaf.
- After 1024 opened types, add `any` to the leaves already found.
  Overflow can never turn an unchecked read into a clean one.

Earlier safety work stays in place:

- Find the real iterator symbol through `resolveName("Symbol")` and its unique id.
- Keep each type id once in the source lists.
- Skip `checkForOf` unless the target is an object or array literal.
- Keep each function at complexity 8 or less.

### Failing tests first

The 26 added tests were written before the guard change.
They ran on `origin/main` at `d7dbee23` in `/tmp/main-check-overload-intersection-sol`.

- Main: 11 failed, 135 passed, exit 1.
- Head: all 146 guard tests pass, exit 0.
- Main missed G98 and MY32's later `then` overload.
- Main accepted MY32b; the new test pins its known false flag.
- Main gave false flags for the required iterator overload controls and tuple rest control.
- Main gave false flags for optional `done: true`, deep typed promises, deep typed thenables, a cycle with a typed leaf, and the callback with no parameter.
- Main already flagged S1, the optional and third iterator overloads, both void parameter plants, the async subtype plant, and the overloaded callback plant.
  These pin the false negatives in the first writer's head.
- Z4 and Z18 expect a flag now.
  They are known false flags, kept on the safe side.

Red log: `/tmp/overload-intersection-sol-red-tests.log`.
Green log: `/tmp/overload-intersection-sol-green2.log`.
The budget probe uses 1025 thenables with an early typed leaf.
It flags on the head, exit 0.
Log: `/tmp/overload-intersection-sol-budget.log`.

### Probe results

The supplied `run.mjs` was used with both probe files joined.
The proof run removes its diagnostic timers; it measures no speed.
The original runner also runs under the timing lock.

- TS means the `IsAny` result for `layer` in the declaration form.
- Main means the assignment form on `d7dbee23`.
- Head means the assignment form with this guard.
- Probe ids are the prefixes of the supplied names.
- 54 rows ran; all 35 TS-any rows flag on the head.
- No row where TS gives `any` is clean on the head.
- The head keeps 15 known false flags.
- Some supplied rows also have TS2490, TS2547, or TS2763 call errors.
  The list keeps the runner's `IsAny` result.
- The S1, optional, third, void, tuple rest, MY19b async subtype, and overloaded callback plants compile clean.

- S1: TS flag; main flag; head flag.
- S2: TS flag; main flag; head flag.
- Y4: TS clean; main flag; head clean.
- Y5a: TS flag; main flag; head flag.
- Y5b: TS clean; main flag; head clean.
- G98: TS flag; main clean; head flag.
- S6: TS flag; main flag; head flag.
- Z4: TS clean; main flag; head flag.
- Z4r: TS clean; main flag; head flag.
- Z5: TS flag; main flag; head flag.
- Z2: TS flag; main flag; head flag.
- Z18: TS clean; main flag; head flag.
- MY1: TS clean; main flag; head flag.
- MY1r: TS clean; main flag; head flag.
- MY1b: TS flag; main flag; head flag.
- MY1c: TS flag; main flag; head flag.
- MY1d: TS clean; main flag; head flag.
- MY1e: TS flag; main flag; head flag.
- MY5: TS clean; main flag; head flag.
- MY5r: TS clean; main flag; head flag.
- MY6: TS clean; main flag; head flag.
- MY7: TS flag; main flag; head flag.
- MY9: TS flag; main flag; head flag.
- MY10: TS flag; main flag; head flag.
- MY10b: TS clean; main flag; head flag.
- MY11: TS flag; main flag; head flag.
- MY12: TS flag; main flag; head flag.
- MY12b: TS flag; main flag; head flag.
- MY13: TS flag; main flag; head flag.
- MY13b: TS flag; main flag; head flag.
- MY14: TS flag; main flag; head flag.
- MY14b: TS flag; main flag; head flag.
- MY15: TS flag; main flag; head flag.
- MY15b: TS flag; main flag; head flag.
- MY16: TS flag; main flag; head flag.
- MY17: TS flag; main flag; head flag.
- MY19: TS clean; main flag; head flag.
- MY22: TS clean; main flag; head flag.
- MY25: TS flag; main flag; head flag.
- MY26: TS clean; main flag; head flag.
- N10: TS clean; main flag; head clean.
- P7: TS flag; main flag; head flag.
- MY30: TS flag; main flag; head flag.
- MY31: TS flag; main flag; head flag.
- MY31b: TS flag; main flag; head flag.
- MY32: TS flag; main clean; head flag.
- MY32b: TS clean; main clean; head flag.
- MY33: TS flag; main flag; head flag.
- MY34: TS flag; main flag; head flag.
- MY10c: TS flag; main flag; head flag.
- MY10d: TS clean; main flag; head flag.
- MY13c: TS clean; main flag; head clean.
- MY19b: TS flag; main flag; head flag.
- MY35: TS flag; main flag; head flag.

Full names and call errors: `/tmp/overload-intersection-sol-combined.log`.

### Known false flags

- Z4, Z4r, Z18, MY1, MY1r, MY1d, MY6, MY19, MY22, and MY26 retain async `any` results that TypeScript drops.
- MY5 and MY5r retain a plain `Promise<any>` beside a typed result.
  The optional pruning rule was not used.
- MY10b and MY10d retain required parameters whose types accept `undefined`.
  The signature API does not mark these differently from optional parameters.
- MY32b joins a later `then` overload that TypeScript drops.
- The 1024-type budget may flag a very deep typed chain.

These choices flag more, never less, on the probes.
No wide-union memo was added.
The wide-union follow-up stays separate.

### Initial build proof and gates

- `vp run -r build`: exit 0.
- `vp check`: exit 0, zero errors and the same 27 warnings as main.
- `vp run -r test`: exit 0; Core has 899 passing source tests.
- `vp run core#test:dist`: exit 0; 1045 tests pass, including all 146 guard tests.
- `scripts/ticket.sh --check-only --no-mutation 49 "Join iterator and thenable overloads safely"`: exit 0.
- `pnpm validate`: exit 0; all 21 lanes pass.
- `vp run prose`: exit 0; zero hits in 229 files.
- Chain result: `EXIT 0`.
- No timeout or OOM retry was needed.
- Write mode found 55 names and left `private-fields.json` unchanged.
- Core's nine dist files match the separate `origin/main` build byte for byte.
- All 158 dist files also match in one worktree, with paths held fixed.
  The guard from `origin/main` and the restored head each build byte-identical output.
- The two apps have different server paths across worktrees.
  The all-file proof holds the worktree path fixed.
- Dist proof: `/tmp/overload-intersection-sol-dist-proof.log`, exit 0.
- Core source, the saved field list, and the fast-code ratchets are unchanged.

Gate log: `/tmp/overload-intersection-sol-gates.log`.
Code proof head: `18fdb011`.

### Build time and wide union

Both A/B runs used `benchctl ab` under `flock /tmp/mutation.lock`.
Each used 10 rounds and one run per side per round.
The trees were clean when the timing started.
A is `d7dbee23`; B is the guard in `18fdb011`.

The real Core build runs `vp pack`, including declarations and the guard.
The two worktrees share one writable parent for this run.

- A median: 6297 ms.
- B median: 6092 ms.
- 95% range for B minus A: -662.0 to 455.7 ms.
- Verdict: `no difference we can see`.
- Log: `/tmp/overload-intersection-sol-build-ab.log`.

The wide probe is a union of 100 thenables.
Each callback takes the whole union, with no plain leaf.
Both guards flag the read.
The probe calls the real checker walk.
No settle memo was added.

- A median: 47850 ms.
- B median: 8008 ms.
- 95% range for B minus A: -42108.7 to -38838.6 ms.
- Verdict: `b is faster`.
- Exit 0.
- Log: `/tmp/overload-intersection-sol-wide-ab3.log`.

The first build launcher passed `cd` as a program and failed before timing.
It was replaced with a Bash wrapper.
The wide probe first hit Node's ban on stripping types under `node_modules`.
It then hit a missing package from the root folder.
Both failed before timing.
The final probe uses stripped JavaScript under Core's own `node_modules`.

### Jev and style

- Preflight ran once on `origin/main..HEAD`: exit 1, HTTP 402, budget exceeded.
- It was not retried.
- No file or unit judge completed.
- `tests.mjs core` ran without a gateway call: exit 0.
  It printed 7 notes among 851 entries, all in unchanged source tests.
  The build guard tests are outside that tool's test folder.
- `promises.mjs core` did not run because the gateway budget is spent.
- `calibrate.mjs` did not run, as requested.
- The ticket gate left the key unavailable to its advisory review.
  No gateway retry ran there.
- No labels were added; `tools/jev/cases.jsonl` is unchanged.
- Changed functions and tests pass the strict style census.
- Full-file strict counts match `origin/main`.
  Prior build-tool and plant-string hits were not changed.
- TSDoc: zero S26 rows in both changed files.

### Scope and choices

The ticket's safety rule replaces the old card's demand for exact agreement.
Async result pruning was dropped so a typed result cannot hide an `any`.
Required parameters accepting `undefined` stay when the signature data is uncertain.
The optional plain `Promise<any>` pruning was left out.
Joining all `then` overloads was cheap, so that follow-up is handled here.

The worktree hook installed and built the tree during creation.
All later long jobs ran detached and were watched in this turn.
The writer did not edit `TODO.md` or `pnpm-workspace.yaml`.
No mutation lane ran: `build/` is not mutated and `src/` is unchanged.
The temporary main-check and base worktrees are removed at handoff.
The ticket worktree and branch stay for review.

### Review fix round

Fix code and tests: `53b5e9b6`, first committed as `93519cc6`.
The guard logic is unchanged.
The new test names a generic thenable that grows at each layer.
It finds a typed leaf before the 1024-type budget runs out.

```ts
interface Gt<X> {
  then(cb: (v: Gt<[X]> | { layer: number }) => void): void;
}
declare const s: Gt<0>[];
for await ({ layer } of s) {}
```

- The full guard suite on `origin/main` at `5b6622d9`: 11 failed, 136 passed, exit 1.
  Log: `/tmp/overload-intersection-sol-round-main-all.log`.
- The new budget test on that main: one passed, exit 0.
  Main's old depth limit also flags this plant.
- On the head: one passed, exit 0.
- Remove only `checker.getAnyType()` from the budget return: one failed, exit 1.
  The guard wrongly returns clean after finding the typed leaf.
- Restore the original return: one passed, exit 0.
- The delete-and-restore run held `flock /tmp/mutation.lock` throughout.
- Logs: `/tmp/overload-intersection-sol-round-budget-main-test.log`,
  `/tmp/overload-intersection-sol-round-budget-mutant.log`,
  and `/tmp/overload-intersection-sol-round-budget-restored.log`.
- MY32b now says it keeps a known false flag, as Z4 and Z18 do.
- The 54 probe rows are a list.
- The direct address about setup is removed.
- The `acceptsZeroArguments` TSDoc now states what the helper does.
- One `packages/start/tests/typecheck.test.mjs` test hit its 5000 ms timeout.
  The test file is unchanged; the test gate was rerun once.
- The first gate run stopped on a missing blank line before this section.
  Formatting was fixed before the next run.
- No gateway step was retried after the prior HTTP 402.
- The build-time A/B above is the initial run.
  No timing run was repeated: this round changes tests and words only.

The seven gates pass after the fixes:

- `vp run -r build`: exit 0.
- `vp check`: exit 0; zero errors and 27 warnings.
- `vp run -r test`: exit 0 on the one retry; Core has 900 passing source tests.
- `vp run core#test:dist`: exit 0; 1047 tests pass, including 147 guard tests.
- `scripts/ticket.sh --check-only --no-mutation 49 "Join iterator and thenable overloads safely"`: exit 0.
- `pnpm validate`: exit 0; all 21 lanes pass.
- `vp run prose`: exit 0; zero hits in 229 files.
- Chain result: `EXIT 0`.
- Logs: `/tmp/overload-intersection-sol-round-gates2.log`
  and `/tmp/overload-intersection-sol-round-retry.log`.
- Dist proof: 158 files, zero differences between main's guard and the restored head.
  Log: `/tmp/overload-intersection-sol-round-dist-proof2.log`, exit 0.
- Write mode still finds 55 names; `private-fields.json` matches `origin/main`.
- The strict census passes for the changed functions and tests.
- Both files have zero S26 rows.
- Plain Jev tests: 7 of 852 source entries flagged, all outside this change.
- The temporary main-check worktree is removed.

After the first proof commit, main moved with the scaffold hook fix.
The branch was rebased onto `b8c118e3`, and `vp install` ran again.
All seven gates ran again on that base and passed by exit code.
No timeout or OOM retry was needed on the final base.
Core still has 900 passing source tests and 147 passing guard tests.
The dist gate has 1047 passing tests.
Check has zero errors and 27 warnings.
Validate clears all 21 lanes; prose has zero hits in 229 files.
Final chain: `EXIT 0`.
Log: `/tmp/overload-intersection-sol-round-final-gates.log`.
The final same-worktree dist proof also has 158 files and zero differences.
It checks main's guard and then the restored head, both on the final base.
Log: `/tmp/overload-intersection-sol-round-final-dist-proof.log`, exit 0.
Write mode still leaves the 55-name field list unchanged.

### Core feedback

None.

## core/size-guard-iterable-fallbacks

Branch: `core/size-guard-iterable-fallbacks-sol`.
Base: `origin/main` at `59425c22`.
Code and tests: `c0803fa7`.
The local tag `archive/iterable-fallbacks-haiku-24a4cd65` saves the first writer's head.
The first writer's branch and worktree were left alone.
Nothing was pushed.
The lead owns `TODO.md` and landing.

### Rules as built

The precedent is TypeScript's for-of and for-await element rule.
The guard may flag more than TypeScript, never less.

- Only a real array or tuple with a library-declared iterator uses its index type alone.
- Under `for await`, its async iterator must also be library-declared or absent.
- Every other iterable joins its index type with the iterator walk.
- A library iterator can still give `any` through a type argument.
- A typed numeric index cannot hide that `any`.
- Library declarations are found through the program's default-library file check.
- An optional or undefined async iterator also reads the sync iterator.
- An async method with no zero-argument overload also reads the sync iterator.
- All answers join on these fallback paths.
- Only the global `Promise` symbol gets the built-in promise shortcut.
- A local `Promise` class or interface follows its `then` callbacks.
- `hasMethod` reads its member once.
- The existing type-id dedupe, overload walk, literal-target skip and settle budget stay.
- No public symbol or runtime source changed.

### Failing tests first

The first writer's tests were reused before its guard code.
Five more plants were added before changing the guard.
The guard still matched `origin/main` at `59425c22` for the red run.
The run used this ticket's own worktree.

- Red: 11 failed, 8 passed, 147 skipped; exit 1.
- Log: `/tmp/iterable-fallbacks-sol-red-all.log`.
- Green: all 166 guard tests pass; `EXIT 0`.
- Log: `/tmp/iterable-fallbacks-sol-step.log`.

The six kept plants flag:

- R9c: an array intersected with a custom `any` iterator.
- R9d: an Array subtype overriding its iterator with `ArrayIterator<any>`.
- A6: an optional async iterator with a sync `any` iterator.
- A7b: an undefined async iterator with a sync `any` iterator.
- A7: an async iterator requiring an argument with a sync `any` iterator.
- T14: a local `Promise` class with an `any` callback value.

The five new plants compile, give `any`, and flag:

- G105: `{ layer: number }[] & Iterable<any>`.
- G106: an `Array<any>` subtype with a typed numeric index.
- G107: `Iterable<any> & { [n: number]: { layer: number } }`.
- G108: `Set<any> & { [n: number]: { layer: number } }`.
- G109: `ArrayLike<{ layer: number }> & Iterable<any>`.

Eight kept controls stay clean:

- A plain typed array.
- An Array subtype with no override.
- An array with a typed iterator override.
- A typed async iterable.
- An undefined async iterator with a typed sync iterator.
- An optional async iterator with a typed sync iterator.
- The global promise of a typed object.
- A typed tuple.

A copied guard made every iterator walk throw.
Real `T[]`, tuples and `Promise<T>[]` still passed without reaching that walk.
This checks that the array fast path stays in use.

### Corrected probe counts

The supplied `p1.mjs`, `p3.mjs`, `run.mjs` and `pf-fix.ts` were read.
The supplied runner was adapted to this head and the ticket's own toolchain.
A row counts as `any` only if it compiles and its `IsAny` assertion passes.
An error on the loop line is a compiler error, not evidence of `any`.
No supplied probe file was changed.

- Reviewer `p1`: 40 rows; 30 compiling `any`, 8 typed, 2 compiler errors.
- All 30 compiling `any` rows flag on the head.
- Reviewer `p3`: no row compiles with an `any` read.
- R11 and A14 fail with TS2339 on `unknown`.
- M3 fails with TS2488; its optional `next` is not an iterator.
- A7 also has TS2322; it still flags on the safe side.
- Log: `/tmp/iterable-fallbacks-sol-probes2.log`.

The earlier 118-row set was rerun with the same counting rule:

- Files: `probes.new`, `probes.all`, `probes.more` in `/tmp/rev3-probes`.
- T10 is typed: its element is a union of typed objects, so the guard is right.
- 72 `any`-read rows, 18 typed, 28 errors.
- Main misses 5; head misses none.
- Head flags 6 more rows and loses no flag from main.
- The old count of 88 mixed compiler errors into the `any` count.
- Log: `/tmp/iterable-fallbacks-sol-matrix.log`.
- `probes.t10` and `probes.budget` were not part of this set.
- The suite still pins the 1024-type settle budget.

### Open misses for a follow-up card

One gap is open: a suppressed for-of assignment target.
`untypedReads` visits the declaration form but misses the assignment form:

```ts
import { createScope } from "@tinker/core";
declare const s: Iterable<{}>;
let layer: number;
// @ts-expect-error
for ({ layer } of s) {}
```

- Assignment form: clean.
- Replace the target with `const { layer }`: flag.
- Both forms were checked through the real build plugin.
- Log: `/tmp/iterable-fallbacks-sol-suppressed.log`, exit 0.
- Main has the same gap.
- It belongs to a follow-up card; it was not fixed here.

### Build time and output

- `benchctl ab`: 10 rounds, one run per side per round.
- The whole run held `flock /tmp/mutation.lock`.
- A: clean `origin/main` at `59425c22` in the scratch base tree.
- B: clean code head `c0803fa7` in the ticket tree.
- Each command ran the real Core build: `vp pack`, including declarations and the guard.
- A median: 4960 ms; B median: 4929 ms.
- 95% range for B minus A: -166.1 to 107.4 ms.
- Verdict: `no difference we can see`; `EXIT 0`.
- Log: `/tmp/iterable-fallbacks-sol-ab.log`.
- Core's 9 dist files match main byte for byte, including maps.
- `vp run core#fields`: exit 0.
- Write mode leaves `private-fields.json` unchanged: 55 names.
- Proof is at the start of `/tmp/iterable-fallbacks-sol-gates2.log`.

### Final gate chain

Every gate ran from the ticket worktree.

- `vp run -r build`: exit 0.
- `vp check`: exit 0; zero errors and the same 27 warnings as main.
- `vp run -r test`: exit 0; Core has 900 passing source tests.
- `vp run core#test:dist`: exit 0; 1066 tests pass, including all 166 guard tests.
- `scripts/ticket.sh --check-only --no-mutation 51 "size-guard-iterable-fallbacks"`: exit 0.
- `pnpm validate`: exit 0; all 21 lanes pass.
- `vp run prose`: exit 0; zero hits in 229 files.
- Chain: `EXIT 0`.
- Log: `/tmp/iterable-fallbacks-sol-gates2.log`.
- No timeout or OOM retry was needed.
- The ticket gate's extra advisory review had no key, so it made no gateway call.
- No labels or calibration file changed.

My first gate ran while the A/B build was rebuilding Core's dist.
Seven scaffold suites then failed to find the Core entry.
The A/B run was allowed to finish before the full chain ran again.
That second chain passed.
The first log is `/tmp/iterable-fallbacks-sol-gates.log`.
This was a job-order error; no code change was needed.

### Jev and style

- Preflight ran once on `origin/main..HEAD`: exit 0, no HTTP 402.
- Seven notes are in unchanged function bodies.
- `noteAssignment` and `privateFields`: `shapeGrowsPerCall`.
- `followVariable`, `readTypes`, `declared`, `assigned`, `returnFlows`: `stateOutsideCell`.
- These hold private state for one build walk; no new shared app state was added.
- `tests.mjs core`: exit 0; 7 of 852 entries flagged, all outside this change.
- The build guard tests are outside that tool's source-test folder.
- No labels were added or changed, as requested.
- `promises.mjs core`: exit 0; 47 of 824 titles have no README line, 71 more unsure.
- Those titles and the README match main; these older gaps are outside this card.
- No new guard-test title is part of that tool's input.
- Promise log: `/tmp/iterable-fallbacks-sol-jev-promises.log`.
- Neither gateway run hit HTTP 402; no failed gateway call was retried.
- `calibrate.mjs` was not run, as requested.
- Logs: `/tmp/iterable-fallbacks-sol-jev.log` and `/tmp/iterable-fallbacks-sol-jev-tests.log`.
- Added code and plants pass the strict style census.
- Full-file strict counts match main; existing build-tool and plant-string hits remain.
- Both changed files have zero S26 TSDoc rows.
- `vp check` keeps complexity at 8 or less per function.

### Scope and choices

The archive saved the first writer's commits without changing its tree.
Its code and tests were reused by file, then the array gate was tightened.
The optional promise-symbol cache was left out to keep this fix small.
The worktree hook installed and built both new trees.
All later long jobs ran detached and were watched in this turn.
No mutation lane ran: runtime source is unchanged and the ticket excludes it.
No git config, labels, `TODO.md` or workspace config was changed.
The scratch base worktree is removed.
The ticket worktree and branch stay for review.

### Core feedback

None.

## core/size-guard-settle-memo

Branch: `core/size-guard-settle-memo`.
Base: `origin/main` at `fbdcf333`.
The first base was `9f3c062e`; `fbdcf333` touches no Core file.
Code and test: `6300ea7d`.
Jev label: `c7e278c3`.
Nothing was pushed.
The lead owns `TODO.md` and landing.

### Problem

- A for-await over a union of N thenables settles each member.
- Each thenable settles to the whole union.
- Each settle asked the checker about every type again.
- The whole probe took about 8 s for 100 thenables.
- 300 thenables took about 13 times as long as 100.

### Fix

- `expanded`: each type's promised values are read once per for-of walk.
- `reach`: a finished settle keeps every type it reached.
- A later settle that reaches that type adds the whole set at once.
- Both live in one walk: the same `at` and the same checker.
- The budget still counts every type a settle reaches, saved or not.
- So `SETTLE_TYPES` (1024) means what it meant before.

### Failing test first

- G110: a for-await over 300 thenables must flag `layer` in under 2 s.
  The timer covers the guard step, not the Core pack.
- On `origin/main`: the guard ran past 20 s and was killed. The test fails.
- On head: G110 passes.
- Full guard file: head 167 of 167 pass.
- Full guard file on `origin/main` with G110: 166 pass, G110 fails.

### Timing

Measured with `benchctl run` on benchd. Each number is the whole probe command: node start, Core pack, guard.

- 100 thenables, base: median 8294.5 ms, 3 runs.
- 100 thenables, head: median 1222.5 ms, 3 runs.
- 300 thenables, base: median 109768.2 ms, 1 run.
- 300 thenables, head: median 1664.9 ms, 3 runs.

### Build A/B

Run with `benchctl ab`, 10 rounds, under `flock /tmp/mutation.lock`.

- A: `origin/main` at `fbdcf333`. B: head `6300ea7d`.
- A median 4907 ms. B median 4911 ms.
- Delta +3.9 ms (+0.1%). 95% range -111.9 to 147.9 ms.
- Verdict: no difference we can see.

### Proof

- No verdict changed: 427 plants, flags equal on `origin/main` and head.
- The 427 are 118 saved probe rows and 309 new plants.
- 244 plants flag on both sides; 0 differ.
- Budget edge: a chain of 1023 stays clean, 1024 flags, on both.
- Core dist: 9 files, byte-identical to `fbdcf333`.
- Private fields: write mode leaves the list unchanged, 55 names.
- Gate chain: `vp run -r build`, `vp check`, `vp run -r test`,
  `vp run core#test:dist`, `scripts/ticket.sh --check-only --no-mutation 52`,
  `vp run prose`: `EXIT 0`.
- `vp check`: 0 errors, 27 warnings.
- `core#test:dist`: 1067 pass.
- `pnpm validate`: `EXIT 0`, 21 of 21 lanes pass.
- Mutation: not run. The lane mutates `src/**` only. `src` did not change.

### Jev

- Preflight on `origin/main..HEAD`: exit 0, no HTTP 402.
- Preflight flags 7. Six are in function bodies this change did not touch.
- `expandOnce` is the seventh: `stateOutsideCell`.
- Label: `stateOutsideCell false` on `expandOnce`, with a reason.
- `tests.mjs core`: exit 0. No flag on the guard tests.
- `promises.mjs core`: exit 0. G110 is not in its input.
- `calibrate.mjs`: not run, as asked.

### Core feedback

- A build test run alone finds no tests:

  ```bash
  cd packages/core
  vp test run build/private-fields.test.ts
  # No test files found, exiting with code 1
  ```

- Add `--config vite.dist.config.ts` to run it.

## core/size-guard-forof-gaps

Branch: `core/size-guard-forof-gaps`.
Base: `origin/main` at `cb976380`.
Nothing was pushed.
The lead owns `TODO.md` and landing.

Commits, oldest first:

- `57689506` the fix, with its first tests.
- `289a1959` cleanup: drop the unused `walk` from `checkAssignment`.
- `04336fec` cleanup: move the saved-reach merge into `adoptReach`.
- `8b6b573d` cleanup: `methodElements` and `iterationTypes` take `read`.
- `9ebbaa47` tests: script target, name-cast read, budget edge.
- `1bfe75a7` Jev label for `forOfTarget`.
- `05d548da` this section.
- `a625be08` correction: the timing script is gone.
- `301b2439` fix round: later-read plants replace the directive-line read.
- `b7727223` fix round: reword the `forOfTarget` doc.
- The newest commit fixes this section's own text.

### Gap

- A for-of loop with an assignment target was not visited.
- Only the declaration form, `for (const { x } of s)`, was checked.
- A directive above `for ({ layer } of s)` left the read clean.
- The source here is `Iterable<{}>`, so TypeScript flags the read.

### Rules as built

- `gatherCasts` visits `ForOfStatement`, as `declared()` does.
- A directive above the target makes its names casts (`forOfTarget`).
- `untypedReads` checks each key of the target, as it does for `const`.
- A script checks every key of the target, as it does for any destructure.
- A typed element still goes through the checker only.
- A plain identifier target, `for (x of s)`, reads no property. It stays clean.
- No public symbol changed. Core's runtime source did not change.

### Failing tests first

- Red on `origin/main`, in `/tmp/main-check-forof-gaps`: 14 of 186 fail.
- The six loop patterns: object, array, nested, default, rest, and await.
- The script target.
- The seven name-based reads: the identifier plant and six bound patterns.
- The const form, the controls, and the budget test pass there.
- Green on the branch: 186 of 186 pass.
- Logs: `/tmp/forof-gaps-red-main3.log`, `/tmp/forof-gaps-fix1-head.log`.

### Fix round: each plant needs its own mechanism

- The directive-line read was caught by its key alone.
- It passed with `forOfTarget` off, so it proved nothing about it.
- It is replaced by an identifier plant.
- Six bound-name plants bind `v`, and a later read uses `v.layer`.
- With `forOfTarget` returning early in a scratch tree: 7 of 186 fail.
  - The identifier plant and the six bound-name plants.
  - The six loop plants and the script still pass: their key check flags them.
- With the key visitor in `untypedReads` returning early: 7 of 186 fail.
  - The six loop plants and the script target.
- Logs: `/tmp/forof-gaps-off-fot.log`, `/tmp/forof-gaps-off-key.log`.

### Verdicts on both trees

Each row is one real build of one plant: flag or clean.

- Script `for ({ layer } of [...])`: clean on main, flags on head.
- Directive, then a read of `layer.layer`: clean on main, flags on head.
- Thenable chain, `for await`, 1023 layers: clean on both.
- Thenable chain, 1024 layers: flags on both. 1025, 1026, and 1030 flag too.
- Budget edge: 1023 clean, 1024 flags, on both trees.
- The card said 1024 clean and 1025 flag. This chain's edge is 1023 and 1024.
- Main and head agree at every depth, so the budget did not change.
- Log: `/tmp/forof-gaps-verdicts-main.txt` and `-head.txt`.

### Open gap, not fixed here

- A read of an element from a cast iterable stays clean.
- This holds for the `const` form and the assignment form, on main too.
- The read is typed, not `any`, so it is outside this card.

```ts
import { createScope } from "@tinker/core";
const x = createScope() as unknown as
  Iterable<{ layer: number }>;
for (const { layer } of x) {}
```

- Expected: flag. Actual: clean.

### Cleanups

- Dropped the unused `walk` from `checkAssignment`. Only `ForOfRead` holds one.
- Moved the saved-reach merge in `settled` into `adoptReach`.
- `methodElements` and `iterationTypes` take `read`, not five parameters.
- The guard file passes after each step. No verdict changed.

### Build time

- `benchctl ab`, 10 rounds, under `flock /tmp/mutation.lock`.
- A: `origin/main` in `.bench/base`. B: head `9ebbaa47`.
- A median 9441 ms. B median 9398 ms.
- Delta -43.5 ms (-0.5%). 95% range -113.0 to 16.2 ms.
- Verdict: no difference we can see.
- Both sides ran a small script: the `vite.config.ts` pack options, with `exports: false`.
- The script wrote into the job folder. It was deleted after the run.
- Its output was not compared byte for byte with `dist`.
- Their medians do not compare with older rows: the harness differs.
- Log: `/tmp/forof-gaps-ab.log`.

### Gates

- `vp run -r build`: exit 0.
- `vp check`: 0 errors, 27 warnings. Same as main.
- `vp run -r test`: exit 0. Core: 900 pass.
- `scripts/ticket.sh --check-only --no-mutation 53`: exit 0. Size budget passes.
- `vp run core#test:dist`: exit 0. 1080 pass at `9ebbaa47`; 1086 pass after the fix round.
- `pnpm validate`: exit 0. 21 of 21 lanes pass.
- `vp run prose`: exit 0. 0 hits in 229 files.
- Core `dist`: 9 files, byte-identical to `origin/main`, maps included.
- `vp run core#fields`: exit 0. `private-fields.json` unchanged: 55 names.
- Gate chain log: `/tmp/forof-gaps-gate.log`.
- Fix round, after `b7727223`: build, `vp check`, guard file, dist lane, prose: all exit 0.
- Fix round: `vp check` 0 errors and 27 warnings; guard file 186 of 186.
- Fix round log: `/tmp/forof-gaps-fix1-gate.log`.

### Jev

- Preflight on `origin/main..HEAD`: exit 0. No HTTP 402.
- Nine model hits. Eight sit in bodies this change did not touch.
- The new hit is `forOfTarget`, `stateOutsideCell`. Labeled `false`.
  - Reason: its names live in one build walk's `gathered` set.
- `tests.mjs core`: exit 0. Seven flags, none in this change.
- `promises.mjs core`: exit 0. Build guard tests are not in its input.
- `calibrate.mjs`: not run, as asked.
- Label: `stateOutsideCell false`, `packages/core/build/private-fields.ts#forOfTarget`.

### Scope and choices

- Timing runs the `vite.config.ts` pack options through the JS API.
- The CLI rewrites `package.json` for a non-`dist` folder, and the job is read-only.
- `.bench/base` is a worktree inside this one. A job sees only its own folder.
- The guard writes a scratch project under `packages/core/node_modules`.
- One stray `benchctl run` on `sh` ran outside the lock. It timed 5 ms. No result is used.
- `build/` is not in the mutation lane, so no mutation run.

### Core feedback

- The guard writes a scratch project into Core's `node_modules` at build time.
- A read-only build root fails:

```text
EROFS: read-only file system, mkdtemp
.../packages/core/node_modules/core-guard-XXXXXX
```

- The cast iterable gap above is also feedback.

## core/size-guard-directive-skip-lines

Branch: `core/size-guard-directive-skip-lines-sol`.
Base: `origin/main` at `0f121817`.
The first writer's head is saved at
`archive/directive-skip-lines-haiku-c09a6393`.
Its old worktree was left alone.
The three first-writer commits were rebased onto this base.
Commits, oldest first:

- `8105c5bd`: the first writer's red plants.
- `c535c200`: the first writer's blank and comment skip.
- `58bd52f8`: the first writer's proof, corrected here.
- `7780abbe`: all TypeScript line breaks and ten new plants.
- The last commit records this proof.

Nothing was pushed. The lead owns `TODO.md` and landing.

### TypeScript 7 probes

Run with `tsc` 7.0.2, `strict`, one real error on the probe line.
Each item says whether the directive hides the probe line.
Both directive names were checked.

- Directive, then code: hidden.
- Directive, blank line, code: hidden.
- Directive, one `// why` line, code: hidden.
- Directive, two `//` lines, code: hidden.
- Directive, space-and-tab-only line, code: hidden.
- Directive, blank, `//`, blank, code: hidden.
- Directive, `/* why */` line, code: not hidden.
- Directive, `/** why */` line, code: not hidden.
- Directive, multi-line `/**` JSDoc, code: not hidden.
- Directive, then a code line, then the error: not hidden.
- Directive at the end of the file: nothing hidden.
- Two directives in a row, code: hidden; the upper one is unused.
- `@ts-ignore`, then `@ts-expect-error`, code: hidden.
- `@ts-expect-error`, then `@ts-ignore`, code: hidden.
- Directive, code line with trailing `// why`: hidden.
- Directive, line starting with `/* why */` and code: hidden.
- Trailing directive on a code line, then blank, code: hidden.
- Trailing directive on the error line itself: not hidden.
- `/* @ts-expect-error */`, blank, code: hidden.
- A directive on the first line of a multi-line block
  comment does not count.
- A directive on the last line does count:

```ts
/**
 * @ts-ignore */
```

- `//@ts-expect-error` with no space: a directive.
- `@ts-expect-error: reason`: a directive.
- `@ts-ignorexyz` and `@ts-expect-errorxyz`: directives.
- CRLF, lone CR, U+2028 and U+2029: same line breaks as LF.
- A blank CR line below the directive: hidden.
- Directive, LF, `// why`, CR, code: hidden.
- A directive after each of those breaks: hidden.
- A block comment stop with each of those breaks: not hidden.
- Lines holding only `\v`, NBSP or BOM stop TypeScript's search.
- In `.tsx`, `{/* @ts-expect-error */}`, blank, JSX line: hidden.
- In `.tsx`, `// @ts-expect-error` as JSX text: not a directive.
- The new run checked 78 probes: all gave the expected answer.
  The earlier review checked 48 probes and found the five gaps below.

### Rule as built

- A directive hides the first line below it that is not blank and not `//`.
- A block comment line ends the search. TypeScript does the same.
- The name match has no word end, so `@ts-ignorexyz` counts.
- Trailing directives work as before: the next line counts.
- The scan now uses LF, CRLF, lone CR, U+2028 and U+2029.
  CRLF counts as one break.
- The directive scan uses the parser's comment-end offsets.
  The five plants check those offsets with the new breaks.
- `suppressedLines` keeps offset ranges; it does not split lines.
  It gets each range from `codeLineBelow`.
- Messages name files, with no line numbers to change.
  The only line-splitting code was `codeLineBelow`.
- The five known TypeScript-hidden reads now all flag.
  The first writer missed them, so its superset claim was false.
- The guard may flag more than TypeScript. These extra flags are allowed:
  - `// see @ts-ignore`.
  - A directive on the first line of a multi-line block comment.
  - Lines holding only `\v`, NBSP or BOM.

### Failing tests first

- The first writer added 22 plants that failed on its main base.
- Five new plants fail on `c09a6393`, each with a clean build:
  - Directive, lone CR, private read.
  - Directive, CR, blank CR line, private read.
  - Directive, U+2028, private read.
  - Directive, U+2029, private read.
  - Directive, LF, `// why`, CR, private read.
- The exact old head was checked in a separate scratch tree.
  Its archived worktree was not touched.
- Red proof: `/tmp/dsl-sol-first-red.log`.
- Green proof: the five plants now flag in the dist gate.
- Focused rerun: ten of ten pass, including the typed controls.
  Log: `/tmp/dsl-sol-green-plants.log`.
- Five typed-read controls check the block-comment stop with LF,
  CRLF, lone CR, U+2028 and U+2029. All stay unflagged.

### Verdicts elsewhere

- All old guard tests pass, including the budget edge:
  1023 clean, 1024 flags.
- The first writer made the LF-comment-CR plant go clean.
  This fix restores its flag and flags the other four gaps.
- Core `dist`: 9 files, byte-identical to `origin/main`, maps included.
- `vp run core#fields`: `private-fields.json` unchanged, 55 names.

### Build time

- `benchctl ab`, 10 rounds, under `flock /tmp/mutation.lock`.
- A: `origin/main` in `.bench/base`. B: `7780abbe`.
- Both use the `vite.config.ts` pack options.
- The script skips `dts` and the exports rewrite, as the earlier run did.
- A median 10781 ms. B median 10887 ms.
- Delta +106.4 ms (+1.0%). 95% range -952.4 to 898.2 ms.
- Verdict: no difference we can see.
- Both sides ran three packs per round, for ten rounds.
- Timing used a clean worktree and a read-only base tree.
- Log: `/tmp/dsl-sol-ab-fixed.log`.
- The first harness attempt imported the Vite config directly.
  Native Node could not resolve its extensionless plugin import.
  It failed before timing; that log is not used.
- The working script imports the plugin by its exact file path
  and fills in the same pack options.
- Scratch trees and scripts are removed after the checks.

### Gates

- `vp run -r build`: exit 0.
- `vp check`: 0 errors, 27 warnings, the main baseline.
- `vp run -r test`: exit 0. Core: 900 pass.
- `vp run core#test:dist`: exit 0. 1120 pass.
  The guard file has 220 pass, including all 210 old tests.
- `scripts/ticket.sh --check-only --no-mutation 54`: exit 0.
  The title was `size-guard-directive-skip-lines`.
- The full gate chain printed `EXIT 0`.
- `pnpm validate`: exit 0. All 22 lanes pass.
  This main base adds a registry lane to the earlier 21.
- `vp run prose`: exit 0. Zero hits in 229 files.
- `vp run core#fields`: exit 0. The list remains unchanged, with 55 names.
- The final byte check compares all nine dist files, including maps.
  Log: `/tmp/dsl-sol-dist-proof.log`.
- Gate chain log: `/tmp/dsl-sol-gate.log`.
- Ticket log: `/tmp/dsl-sol-ticket.log`.
- Mutation: not run. The lane mutates `src/**` only; `src` did not change.
- The strict style census reports the same rule IDs on main and head.
  Its hits are old code, regex match text, and deliberate source text in plants.

### Jev

- Preflight on `origin/main..HEAD`: exit 0. Run once; no HTTP 402.
- Nine model hits, all in functions this fix did not touch.
- `suppressedLines` and `codeLineBelow`: no hit.
- No label written: no new hit in changed code.
- `tests.mjs core`: exit 0. Seven flags in old tests.
  Build guard plants are outside its input.
- `promises.mjs core`: exit 0. 45 of 824 old titles lack a README line.
  Another 77 answers were unsure.
- Both test readers exclude `build/`; no changed plant was in their input.
  Their old test and README findings are outside this card.
- These files did not change, so no label or README edit was added.
- No HTTP 402 occurred in either test reader.
- No retry after HTTP 402.
- `calibrate.mjs`: not run, as asked.

### Scope and choices

- One shared regex defines the breaks, with CRLF matched first.
  The search resets its position for each directive.
- This keeps the regex out of each directive's allocation work.
- Long jobs use the requested detached shell and exit files.
  Every job is awaited before the final report.
- No main-checkout command was used beyond fetch, tag and worktree add.
- No git config changed. `TODO.md` was not edited.

### Core feedback

- None.
