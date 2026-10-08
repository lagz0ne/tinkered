# Fast-code fixes

## Start batch 1

### Assumptions

- The brief is writer work; the lead reviews and lands it.
- No push or publish.
- No fix diff exists for these three cards.
  Use the study's filled compression module as the patch.
- Auth owns only the database, fixed settings, and mail action.
  Each principal reads its own request headers.
- The app has no auth template file.
  Registry copies come from its backend source.

### scaffold/auth-scope

- Removed auth's session target; the process owns its native client.
- Added a two-request scope test with distinct headers.
- Before the fix: the identity check failed (exit 1).
- Existing account tests cover per-request headers and mail callbacks.
- No auth template exists; regenerate the registry from source.
- Green proof: backend 6 tests; registry build and check; vp check; prose (exit 0).
- Jev tests: 0 of 6 flagged.
- Jev labels: configNotTag=false; ignoresAbortAfterAwait=false.
  Fixed settings come from the env tag; module loading acquires no IO handle.
- The promise judge accepts only packages, so it cannot read the scaffold app.
- Strict style census and TSDoc checks: exit 0.

### start/abort-reasons

- All 17 reasonless source aborts now pass a shared AbortError.
- Kinds: owner close, account change, finished wait, deadline.
- Names and code 20 remain native AbortError values.
- Two scope checks failed before the fix (exit 1).
- Assumption: test the tab owner through Core, without booting TanStack.
  The brief bans TanStack inside tests.
  The page census will cover the router entry too.
- Page census: 20 identity SSR pages on each built tree.
  Main: 20 reasonless aborts; fixed tree: 0.
  Per page: 1 -> 0.
  Logs: `/home/paseo/.cache/tinkered-briefs/start-b1-census-{a,b}.log`.
- Green proof: Start 428 tests; check; prose (exit 0).
  Check warnings match main: 28.
- Strict style census: exit 0.
- Jev tests: 0 of 2 flagged.
  Added the two README promises that its promise check named.
  The label tool has no promise-gap judge; the README is the resolution.
- Jev source flags each have a false label and reason in cases.jsonl.
  Native private state belongs to its resource.
  Root readiness can await start hooks; shutdown must drain owned work.
  Existing router shape and request-hop findings remain separate tickets.

### start/compress-stream

- Start from the study's b-compression.mjs, with its error and cancel wiring.
- Flush gzip and Brotli per write; use pipe instead of compose.
- Regression reads decoded shell bytes before allowing the source to end.
  Both gzip and Brotli fail before the fix (exit 1, test timeout).
- Added source-error and reader-cancel checks for the new stream ownership.
- Trade: each write adds a flush marker; compression may use more bytes.
- Jev preflight ignores .mjs source; direct lint also reads no .mjs units.
  Read the compression diff by hand; its 10 behavior tests pass.
  Jev tests reports 0 of 8 plain titles flagged; it skips test.each titles.
- Full Jev calibration is a lead landing step, not a writer gate.
  Stopped an extra full run after three summaries; no calibration file was written.
- Auth's native cookie plugin reads response headers inside each callback.
  It captures only its own warning state when built, no request headers.
- Core feedback: none; the existing resource and scope rules fit these fixes.

### Final gates

- Initial fetch and rebase: exit 0; main stayed at 8c2d406c.
- vp install: exit 0.
- vp run -r build: exit 0.
- vp check: exit 0; 28 warnings, the same as main.
- vp run -r test: exit 0; 10 package tasks, Start 432 tests.
- vp run prose: exit 0.
- vp run @tinker-start-scaffold#check: exit 0.
  Includes real Postgres and Mailpit; all owned services stopped.
- pnpm validate: exit 0; all 19 budget lanes passed.
- Strict style census and TSDoc parser: exit 0.
- Gate logs: `/home/paseo/.cache/tinkered-briefs/start-b1-final-*.log`.
- Mutation proof will be saved in start-b1-mutation.log beside this file.
  It must name the final clean source commit and meet 75 on kills alone.

### Not proven

- Auth construction has no timed speed claim or request-promise census.
  Its shared identity and per-request behavior are covered by scope tests.
- No claim about full SSR throughput or compressed byte savings.
- The lead still reviews and lands these commits; nothing is pushed.

### Queued first-byte check

- Verdict: b is faster.
- A: clean origin/main at 8c2d406c, in start-b1-base.
- B: the clean fixed tree; the driver imports its compression module.
- Five paired rounds, one run per side per round.
  Each run makes five loopback HTTP requests and stops on the first Brotli bytes.
  The source holds its tail for 300 ms, as in the study probe.
- The command has rounds and runs-per-round, not a runs option.
- Relative paths work inside the queue's shared mount.
- Log: `/home/paseo/.cache/tinkered-briefs/start-b1-ab.log`.
- The verdict covers this first-byte driver, not full-page throughput.

```bash
DRIVER=../../.cache/tinkered-briefs/start-b1-ttfb.mjs
flock /tmp/mutation.lock benchctl ab \
  --cwd /home/paseo/next/start-b1-base \
  --rounds 5 --runs-per-round 1 \
  --a "node $DRIVER ." \
  --b "node $DRIVER ../fix-start-b1"
```

- Final fetch/rebase, install, and build: exit 0.
  No upstream code changed; all earlier gate proof still applies.
- Refreshed the starter's formatted test copy after the scaffold gate built it.

## React rules batch 1

- Branch: `react/rules-batch-1`.
- Owner: React batch writer (Codex).
- Scope: the three React tickets in the supplied brief.
- Assumption: use the existing React test runner for hook behavior.
  Tests start no server and patch no global value.
- Assumption: report each thrown callback error and still call `onSettled`.
  The operation keeps its own result.
- Assumption: byte counts describe package code in the common paths.
  React, Core, mounts, and writable pairs still make objects.

### react/run-callback-errors

- The two required tests failed on the original source, exit 1.
  `runAsync` rejected with the callback error.
  `run` produced no global error event.
- Callback errors now reach the host error reporter.
  Each callback is guarded; `onSettled` still runs.
  `runAsync` returns the operation value or failure.
- Added two outcome cases for a failed final callback.
- Removed the shared no-op rejection handler.
  The resource observer also reports unexpected errors.
  This keeps React at the existing 25-slot ceiling.
- Build, check, and all package tests returned 0.
  React: 91 tests pass.
  Code check: 0 errors and 28 warnings, the same as main.
- Prose returned 0.
- Jev: four source flags explained and labeled false.
  Test and promise judges found no new flag.
- The strict census initially failed on clean main too.
  The final pass clears its config comments and tracks the
  resource observer's promise, as the coding rules require.
- Next: count sync renders before the next fix.

### react/run-sync-first

- Strengthened the sync operation test to count renders and commits.
  It failed before the fix, exit 1: pending, then success.
- Core's sync result now publishes success at once.
  Only a promise enters pending state.
  The async caller still gets a promise.
- React: all 91 tests pass, including late results and reset.
- The focused code check returned 0 with no warning.
- Production click probe: 2 renders and 2 commits before;
  1 render and 1 commit after, with no pending status.
- The async click still renders pending, then success.
- Next: remove repeated objects from cell reads and writes.

### react/data-zero-alloc

- Read optional arguments into locals, in their original order.
  No result object per render.
- Split store selection into a hook to keep complexity at 8 or below.
  It returns an existing store and adds no hook slot.
- Raw cache hits create no closure context.
- Raw and selected stores have the same fields in the same order.
- A selected store changes its one saved memo in place.
  It creates that memo on its first read only.
- All 91 React tests pass, including all cell tests.
- The built public types match main byte for byte.
- Sampled package bytes per raw render: 89.5 before, 0.3 after.
- Sampled package bytes per board write with 144 selectors:
  8,222.8 before, 0.3 after.
  The selector reader alone: 8,174.7 before, 0.2 after.
- These are sampled bytes, with both inlining switches off.
  The small remainder is probe noise, not proof of literal zero.
  Mounts, writable pairs, and caller-made selectors still allocate.
- Default-tier mixed trace: two varying-shape read sites before,
  zero after, including the subscribe and read sites in useData.
- Final tests copied into the pinned main tree: five fail, exit 1.
  The two callback tests, both final-callback cases, and sync count fail.
  The pinned tree was restored after this check.
- Queued A/B verdict: **no difference we can see**.
  Scene: 144 tiles, 1,500 board writes, whole process.
  Five rounds with one run per side: ten timed runs total.
  A: clean pinned main `8c2d406c`.
  B: clean React code commit `4170d350`.
  No speed gain is proven; the byte reduction is the measured gain.
  The first queue attempt failed on absolute sandbox paths.
  The measured run uses relative paths.
- Every required gate returned 0:
  fetch/rebase, install, full build, check, package tests,
  prose, scaffold check, and validate.
  Validate: all 19 lanes pass, including the 25-slot ceiling.
  One existing test remains skipped outside React.
- The scaffold gate starts its own proof project.
  It passed real auth, mail, migrations, and two-tab sync.
  Its own servers stopped and its own proof project was removed.
- Jev preflight: no file flag; five flags on three units labeled false.
  They are the adapter's scope effect, promise observer, and settle helper.
  Existing test-helper notes stay outside this ticket.
  No new test or promise flag; TSDoc parser has no error.
- Calibrated the four judges whose bank gained a label.
  The full bank pass was stopped; unrelated judges stay as they were.
- Cleared the inherited package census hits because the skill
  requires every strict hit to be fixed.
  Config changes are comments only.
  The resource observer holds its pending promise and releases it
  on completion or unmount; its visible behavior is unchanged.
- Core feedback: none; Core already supplies the needed sync result.
- Saved in Review; no push, publish, or main change.
- The first full mutation pass finished before the Start rebase.
  Clean input: `b1496178`; 259 kills of 366, or 70.77 percent.
  It had 68 timeouts, 33 survivors, one uncovered change, and five errors.
  Every timeout and error counts as a miss.
- Rebased onto the Start batch and re-ran all gates: every exit was 0.
  Both requested React diffs were empty at `720d61a0`.
- A 30-second retry was stopped when browser cleanup's own
  30-second limit showed that the runner limit was too short.
  Its exit was 130; it supplies no completed score.
- The full 60-second run finished on clean `837693c4`.
  It killed 309 of 366, or 84.43 percent on kills alone.
  It had 18 timeouts, 33 survivors, one uncovered change, and five errors.
  The tool prints 90.58 because it counts timeouts and drops errors.
  That printed score is not the required kills-only score.
- The five error rows were wrong host errors outside test assertions.
  Existing tests now record and check the host error channel for
  normal calls, omitted callbacks, and synchronous calls.
  No test was added; no global value is patched.
  Cleanup releases the paused operation and closes each scope once.
- Rebased onto the blank-line rule and the later board update.
  Before the test edits, the React diff ignoring blank lines was empty.
  Added the rule's three needed blank lines to the new callback test file.
- The test edits change more than blank lines, so a fresh full
  mutation run on the final clean commit is required.
- All gates after the blank-line rebase and test edits returned 0.
  Install, full build, check, package tests, prose, scaffold, and validate pass.
  React still has 91 tests; validate still has 19 passing lanes.
  The strict census passes; public types still match the pinned base byte for byte.
  Preflight has the same five explained source flags and no file flag.
- The restart killed the next run at 231 of 366 changes.
  It has no completed score and does not count.
- Rebased onto the five newer main commits without a conflict.
- Found a startup reset bug in the sync-first change.
  An async body can reset the view before it returns its promise.
  The older call then wrote pending over idle.
  Pending writes now check that this run is still the latest.
- The new public reset test fails before this guard, exit 1.
  It flushes React updates before checking idle.
  An earlier check without that flush passed too soon.
- The final proof is the clean input and summary in
  [the mutation log](react-b1-mutation.log).
  Timeouts and runtime errors count as misses.
- All resumed gates returned 0: install, full build, check,
  package tests, prose, scaffold, and validate.
  React has 92 passing tests in 23 files.
  Check has zero errors and the same 28 warnings.
  Validate has 19 passing lanes; public types still match the base.
- Strict census and the five-file TSDoc parser pass.
  Jev has the same five explained source flags with saved false labels.
  The test judge has no flag in 88 entries.
  Added the missing README promise for local pending queries.
  The promise judge now has no gap in 88 titles.
- Next: one full mutation run on this clean code, then lead review.
## core/handle-proto

- Owner: writer (Codex), branch `core/handle-proto`.
- Assumption: this is writer work; the lead reviews and lands it.
  No push or publish.
- Start from the study's prototype, with typed overloads.
  No `any` or cast through `unknown` from that probe remains.
- One class builds plain scopes, child sessions, and `session(body)` handles.
  Their verbs live on its shared prototype.
- `release` keeps one function, made on first read.
  Most handles never release a node, so they pay for no bound function.
  The class accessor keeps callback use and ignores a forEach index.
- The three internal handle spreads now keep the handle as their prototype.
  The root lifetime test now passes the handle itself.
- The study missed a second handle spread in React's StrictMode test.
  Its counting fixture now keeps the real handle as its prototype.
  No React source or test behavior changed.
- The brief asks for prototype and own-function checks.
  That overrides the census's T05 ban for these three tests.
  Existing Core S04, S10, S14, and P06 hits stay outside this card.
- Three new checks fail on clean main `e911871f` (exit 1).
  They cover shared verbs, a passed release callback, and no own verb functions.
  All three pass here; Core has 870 tests.
- Live request heap: 2,924 -> 2,123 B.
  ADR 0016 ceiling: 4,096 -> 2,304 B.
  This leaves 181 B for run-to-run noise and rejects the old handle.
- Built runtime: 15,724 -> 15,805 B gzip, +81 B.
  Cap: 16,384 B; 579 B remains.
- Fast-code ratchets: slots, hot bytecode, and watched closures are unchanged.
  Their baselines stay unchanged; no lower ceiling was measured there.
- Impact: `Scope.Handle.release` now says `this: void`.
  This states its existing callback contract and removes an unbound-method warning.
  SCIP refs cover Core tests and `packages/react/src/index.ts`.
  Only Core source, its docs/tests, and the React counting fixture need edits.
- Initial build, check, prose, and validate: exit 0.
  Validate passed all 19 lanes.
  Remaining: full ticket gate, queued timing, Jev labels, clean-tree mutation.
