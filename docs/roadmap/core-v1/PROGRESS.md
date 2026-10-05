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

| tag      | ticket                                                                                                             | blockers   | status                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------- |
| core/t01 | Packaged scope + data read                                                                                         | —          | [x]                                                  |
| core/t02 | data write + watch                                                                                                 | 01         | [x]                                                  |
| core/t03 | Sync commands (incl. effects)                                                                                      | 02         | [x]                                                  |
| core/t04 | Scope tags, all modes                                                                                              | 03         | [x]                                                  |
| core/t05 | Async commands + work ownership                                                                                    | 03         | [x]                                                  |
| core/t06 | Sessions + inheritance + copy-on-write                                                                             | 04         | [x]                                                  |
| core/t07 | Structured close + onClose                                                                                         | 05, 06     | [x]                                                  |
| core/t08 | Sync scope resources + cleanup                                                                                     | 07         | [x]                                                  |
| core/t09 | Async resource builds + close                                                                                      | 08         | [x]                                                  |
| core/t10 | Resource targets + owner-context                                                                                   | 08         | [x]                                                  |
| core/t11 | Outcome hooks + session(fn)                                                                                        | 09, 10     | [x]                                                  |
| core/t12 | Single-node release                                                                                                | 09, 10     | [x]                                                  |
| core/t13 | Release cascade within owner                                                                                       | 12         | [x]                                                  |
| core/t14 | Release cascade across owners                                                                                      | 13         | [x]                                                  |
| core/t15 | Command / manual observation                                                                                       | 07         | [x]                                                  |
| core/t16 | Resource observation                                                                                               | 09, 10, 15 | [x]                                                  |
| core/t17 | Data/command presets                                                                                               | 05         | [x]                                                  |
| core/t18 | Resource presets                                                                                                   | 09, 10, 17 | [x]                                                  |
| core/t19 | v1 validation milestone                                                                                            | 01–18      | [x]                                                  |
| core/t31 | A resource dep is its value; deps build before the body; async typed through the graph; lazy Proxy gone (ADR 0044) | —          | [x] fa7282f, 227 tests, mutation 78.51, opres −95 ns |

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

| tag      | ticket                                                               | blockers | status |
| -------- | -------------------------------------------------------------------- | -------- | ------ |
| core/lt1 | Converged ctx + reverse-registration close                           | t14, t16 | [x]    |
| core/lt2 | Release + cross-owner via the same drain                             | lt1      | [x]    |
| core/lt3 | Cancellation hardening + `close()` shutdown-mode redesign (ADR 0028) | lt2      | [x]    |
| core/lt4 | Prove the contract + remove old paths + budgets + accepted limits    | lt3      | [x]    |

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
- **State:** Review.
- **Next:** run the full Core checkpoint before marking Done.
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
- **Build assumption:** the published files never included the map files.
  The build still emits those maps, with hidden links in the shipped code.
  Local tools must load a map by path instead of finding its footer link.
  The one private shared chunk uses `s.mjs`; the package version supplies its version.
  These cuts remove map footer links and a cache hash from shipped code.
- The first ticket run was stopped with exit 143 before its mutation gates finished.
  Its log is `/tmp/close-hook-ticket.log`.
  Source changed after the first mutation score of 85.50.
  Both proofs will be rerun on the final source; neither old run is the final gate.

- The final runtime is 16,152 bytes gzip, four bytes below the supplied base.
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
