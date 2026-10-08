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
  Ticket gate: exit 0, including all package tests and Core dist tests.
  Scaffold check: exit 0 when run alone.
  Remaining: the final clean-tree mutation run; proof is linked below.

- Full check: 0 errors, 27 warnings; main has 28 warnings.
  The callback type removes one existing release warning.
- Jev preflight: 0 file flags; 114 unit flags, including 3 noisy notes.
  All 170 non-noisy judge hits have false labels with reasons.
  106 new cases were appended; the rest matched saved cases.
  Core owns its private state and must await owned close/hook work.
  Old lazy fields stay on the separate shape-preinit card.
  The three cold wrappers set their override fields once at birth.
- Jev tests: new tests have no plain notes.
  Core has 7 old test flags plus one old sleep note; React has 0 flags.
  The old test files are outside this card.
- Census: the new handle class passes strict checks (exit 0).
  Full source has the same four failing rule IDs as main.
  The required prototype tests add T05, allowed by the brief.
  TSDoc parser: 0 rows, exit 0.
- Do not build Core during a consumer test run.
  Its build removes dist files first, so concurrent checks can fail to import Core.
  The full ticket gate runs these in order and passed.
- Core feedback: none; this card changes Core's handle contract itself.
  Jev calibration stays a lead landing step under the fixed brief.

### Final Core gates after the restart

- The restart stopped the waiting jobs; both source commits stayed clean.
- Fetch/rebase, install, and full build: exit 0.
  Main stayed at `8d75634f`; its Core code is unchanged from `e911871f`.
- Ticket: exit 0, with `--no-mutation --check-only`.
  Its full package test run passed; Core source 870, dist 880.
  Mutation runs separately under the shared lock, on the final clean source.
- Validate: exit 0; all 19 lanes passed again.
  Runtime: 15,805 B gzip of 16,384; base: 15,724 B.
- Prose and the scaffold check: exit 0.
- N=61 queue: exit 0; each row used 61 batch runs on each tree.
  A: clean origin/main `8d75634f`, in `handle-proto-base`.
  B: clean `6623c702`; later edits change only docs and proof.
  Engine: Node v24.21.0, V8 13.6.233.17-node.53.
- **session:** b is faster; 510.4 -> 432.2 ns median.
- **lifecycle:** b is faster; 866.2 -> 770.7 ns median.
- **op:** no difference we can see; 59.1 -> 59.3 ns median.
- **run:** no difference we can see; 74.0 -> 74.1 ns median.
- Verdicts use a paired, two-sided sign test at p < 0.05.
  Ties are left out; counts and p values are in the saved timing log.
- The separate scope-loop `benchctl ab` used five paired rounds.
  Verdict: no difference we can see.
  Median: 301 -> 254 ms; the 95% range crosses zero.
  No speed claim for that loop; no claim about full app throughput.
- [Timing proof](handle-proto-timing.log).
  Raw rows: `/home/paseo/.cache/tinkered-briefs/handle-proto-ab.csv`.
- Jev review: 0 flags; the file is too big for its file judge.
  Preflight still read all 300 units and its labels are committed.
- Core promise check: 41 old README gaps, 69 unsure, across 794 titles.
  The three new test titles each matched a README promise.
  Old test promises are outside this handle card.
  React: 0 gaps, 6 unsure, across 85 titles.
- SCIP: old `handleFor` refs are empty in Core and React.
  Release refs still cover Core tests and React's scope source.
- [Final mutation proof](handle-proto-mutation.log).
  It records the clean source HEAD, command, exit code, and kills-only score.
  Only that proof log is committed after its run.
- The lead still reviews and lands this branch.
  Nothing is pushed or published.

### Mutation follow-up

- The first final run tested clean source `8eed57a2` and returned exit 0.
  Its built-in score counts timeouts; kills alone were 84.9845%, below 85.
  Counts: 3,011 killed, 29 timeout, 468 survived, 35 no coverage.
  Three runtime errors leave 3,543 valid changes in the denominator.
- A surviving change removed the copy returned by `spans()`.
  A saved list then changed when a later run replaced bounded history.
  The new public test fails with that change and passes with the copy.
  This preserves the old handle's behavior; Core source is unchanged.
- The final mutation run is repeated after saving this test and all proof.
  The final log must clear 85 on kills alone.
- Rebased onto `9890672b`; kept both writers' progress notes and Jev labels.
  Upstream changed React and docs; its Core source is unchanged.
  The queued Core timing proof still covers the same runtime source.
- Install, full build, ticket, and validate: exit 0 again after the rebase.
  Core source has 871 tests; dist has 881.
  The runtime remains 15,805 B gzip; all 19 budget lanes pass.
- All four handle tests pass; the test judge flags none.
  The promise judge matches the saved-span test to the README.
- Prose and scaffold checks: exit 0 after the rebase.
  The scaffold check stopped only its own proof services.

## scaffold/app-rules, 2026-10-08

Owner: writer (Codex), branch `scaffold/app-rules`.
The lead reviews and lands this ticket; nothing is pushed.

### Change and proof

- The app's 24 per-call module loads are static imports.
  The two remaining run-body imports belong to startup migrations.
  Report probe: 26 -> 2 imports in run bodies.
- Scaffold backend files use `.server.ts`.
  Registry targets, copied seams, schema config, and proof paths follow the names.
  Server functions keep TanStack's `.functions.ts` split.
  Value imports outside those two file types: 14 -> 0.
  The report's stricter count falls from 17 to four server-function imports.
  Built browser chunks have zero server-only markers.
- Start-min calls `src/transport/greet.functions.ts` from its page.
  The brief's backend path failed the existing browser import guard.
  The transport folder follows the scaffold's shipped pattern.
- SMTP uses one shared pooled transport.
  Sign-up and reset enqueue root-owned sends and reply without waiting.
  The owner consumes each send result, logs `mail.failed`, and drains on close.
- Profile save and retry commit, start owned mail work, then return the ID.
  Duplicate IDs share one send; completed work leaves the held map.
  Mail failure still saves a partial result and leaves the saved name usable.
  A separate work failure logs `profile.notification.failed`.
- Three regressions fail with the old behavior and pass with the fix.
  Sign-up and duplicate profile receipts each timed out while mail was held.
  Retry also timed out with main's profile body and only its import paths changed.
  No sleeps or mocks were added; final-result checks poll saved events.
- Auth already has one process owner on the fetched main.
  Its two-session identity test still passes.
  Session-target count stays at two; the study's three included the old auth owner.

### A1 limit and assumptions

- A1 is dropped for these two bodies, with compiler proof.
  Core's AsyncBody type requires a promise for an async resource dependency.
  Removing async from currentUser and readAccount returns TS2322.
  The report's React audit accepts this same type constraint.
  The two async run/factory bodies without await stay at two.
- Scope is app code and its copied files; no package runtime changes.
  Changing the Core type rule would cross this lane's boundary.
  The failing example is recorded in `core-feedback.md`.
- The broader server-file rename is needed to keep A5's count from rising
  when A3 adds static Drizzle imports.
- No timed speed claim is made, so there is no paired timing verdict.
  The proof is changed call counts and replies that finish while mail is held.
- Mutation is not run: neither app ships a mutation task, and no package
  runtime changed; the common Start requirement applies to packages/start edits.

### Proof ownership

- The first real-service proof failed at its immediate Mailpit assertion.
  It expected sign-up to wait for SMTP, which this ticket removes.
- The app now owns that proof in `maintain/scaffold-proof.mjs`.
  It polls Mailpit for delivered verification mail after the reply.
  The original package script is kept because package files are outside this lane.
  The remainder of that service proof is unchanged.
- The writer saved every Jev label.
  Full calibration belongs to the lead at landing, per the contributor rules.
  The optional writer run was stopped before it wrote a file.

### Checks

- Setup fetch/rebase, install, and full build: exit 0.
- Full build: exit 0.
- `vp check`: exit 0; zero errors, 27 existing warnings.
- `vp run -r test`: exit 0 on the repeat; all nine tasks passed.
  Core 871, React 118, Start 432, scaffold 27 tests passed.
  The first run hit Flight's five-second supplier search limit.
  Flight then passed all 148 tests without a source change.
- Prose: exit 0; no hits.
- `pnpm validate`: exit 0; all 19 budget lanes passed.
- The standalone real-service proof: exit 0.
  Real signup, SMTP, profile mail, and two live tabs all passed.
  Its two browser sessions, server, relays, and own compose project stopped.
- Style census: exit 0 for changed TypeScript files and app backend.
- Jev preflight: exit 0; no file flags.
  Twelve final unit flags have answers with reasons.
  Earlier account-read and profile-read flags have answers too.
  Eight labels are new; six matching labels were already in the bank.
  Settings use the declared env/settings owners.
  Native idle clients keep the original owned cleanup.
  Mail work uses Core cancellation and drains at graceful close.
  The no-op note is noisy and needs no label.
- Jev tests: exit 0; none of the 12 reviewed tests flagged.
- Jev promises: exit 0; zero README gaps, three unsure.
  The unsure titles include existing account-refresh cases.
- TSDoc parser: exit 0; zero S26 rows.
- Reviewed callers: auth verification/reset hooks; saveProfile and
  retryNotification through their transport functions; saveName and retryMail.
  Frontend actions still wait for saved result events.
- `vp run @tinker-start-scaffold#check`: exit 0 after the proof fix.
  All nine named checks passed, including registry build and registry checks.
  Ten registry items and 91 emitted files match source.
  Both copied app compositions build and pass doctor.
- Saved work waits in Review; the lead still reviews and lands it.
  No push, publish, deployment, or package runtime edit was made.

## Start server lane — 2026-10-08

- Five tickets saved on `start/server-lane`; the lead reviews and lands them.
  [Full proof](SERVER-LANE.md).
- Start promises per page: 73.57 → 34.04, below 45.
  Body promises: 25 → 12, with one held response stream.
- Warm retained static files: four file resources → zero.
  Static A/B: **b is faster**; page A/B: **no difference we can see**.
- Server body chunk: three bindings; `hold` and Core `createScope` have no wide context loads.
  Client chunks omit the full package settings table and server auth key names.
- Main joined: `f360f870`; all package tests pass, Start 437 and scaffold 27.
  Check: exit 0, zero errors and 27 warnings, the same count as main.
- Build, all tests, prose, scaffold check, and validation: exit 0.
  Validation passes all 19 budget lanes.
- [Final fault-test proof](SERVER-LANE-MUTATION.txt) names the clean source commit.
  Only its header and summary are saved after the run.
- No push or publish; no Core feedback.

## react/rules-lane

- Owner: React lane writer (Codex), branch `react/rules-lane`.
- Assumption: this is writer work; the lead reviews and lands it.
  No push or publish.
- The specific React brief needs mounted hooks.
  Its two identity tests use the package's existing browser seam.
  This overrides the common brief's ban on browser tests here.
- `react/run-lean`: port the study's owner and cache its handle.
  Keep sync results sync, callback errors visible, and startup reset safe.
  Reuse the controller until the scope or operation changes.
  The study's per-render controller lookup raised Disposed after close.
- The new parent-render identity test failed before the fix, exit 1.
  React's 93 tests then passed, exit 0.
- Final sampled hook bytes per render: 1,190.0 before, 106.9 after.
  Same study probe; Maglev stays on, both inline passes stay off.
  The final pair gets one queued A/B, then full gates and mutation.
- Core feedback: none; Core supplies the stable controller and sync result.

- `react/resource-lean`: keep one owner per scope, resource, and namespace.
  Its refetch follows the current inherited namespace.
  Its observer depends on both owner and promise, so an old owner detaches
  even when the next owner reads the same promise.
- Cache each query handle until its visible state changes.
  Use Object.is for data and errors, including NaN and signed zero.
  Read native Core promises directly; remove the app-value then probe.
- The query identity regression failed before the fix, exit 1.
  Both new identity tests pass; React now has 94 tests.
- Hook slots: run 9 to 3; both resource modes 6 to 3.
- Sampled bytes per suspense render: 857.8 to 117.9.
  Local query render: 1,067.7 to 117.2.
  These are sampled hook bytes, not whole-page memory.
- Run and query handles each have one V8 shape across their states.
  Old handles remain saved snapshots; only a changed state gets a new handle.
- React module slots: 25 to 21; lower the fast-code ceiling to 21.
  Public exported declarations stay the same.
- Strict census passes; the TSDoc parser reports zero rows.
  Jev tests: 0 of 90 entries flagged.
  Jev promises: zero gaps, six unsure titles.
- Jev preflight: zero file flags; two unit flags explained and labeled false.
  The provider owns its React mount effect.
  The run owner holds local view state, not shared domain state.
  Calibration stays with the lead's landing step.

- App-value then lookup: one megamorphic site before, zero after.
  The probe reads six resource value shapes through the same hook.
- Promise count from mount to local async settle: 22 to 20.
  The turn probe does not prove a one-turn visible render gain.
- [Allocation, slots, shapes, and promise proof](react-rules-probes.log).

- Full lane gate returned exit 0: build, check, every package's tests,
  prose, scaffold check, and all 19 validate lanes.
  Install and fetch/rebase also returned 0.
- Clean main and this lane each have zero errors and 27 warnings.
  React has 94 passing tests in 23 files.
- Runtime size: 4,952 to 5,224 B gzip; cap 10,240 B.
  Exported declaration files match the base byte for byte.
- Remaining: one queued A/B for both hooks, then the clean final
  React mutation run and its summary log.

- Queued pair A/B: exit 0; verdict: b is faster.
  A median 3,950 ms; B 3,162 ms; about 20 percent less time.
  The 95 percent range is -1,124.4 to -366.7 ms.
  Five paired rounds, one run each; production React, 1,500 frames.
  Each of 144 tiles reads data, one run hook, and both resource modes.
  This proves that render scene only, not full-app throughput.
- A: clean main `5d9c0537`; B: clean source `3fca54be`.
  Main stayed at the same commit at the final fetch/rebase.
- [Queued pair timing proof](react-rules-timing.log).
- The lane is saved in Review for the lead.
  The final clean-tree mutation proof follows in its own log-only commit.
  No ticket was dropped; no push or publish.

- The first full mutation run used clean source `e0d1a650`.
  It caught 291 of 352 breaks: 82.67 percent on kills alone.
  The 25 timeouts and two uncovered breaks count as misses.
  The tool's 89.77 score includes timeouts; it does not meet our floor.
- Added four public checks after reading those misses.
  A query that returns no value must still leave pending.
  StrictMode must clear the run from its discarded effect mount.
  A cancelled run must reject with the caller's exact reason.
  A named reset must release a shared scope resource.
  All four pass; React now has 98 tests in 23 files.
  The hook behavior stayed unchanged, so the pair timing still applies.
- Rebased onto `f360f870`; kept both lanes' board and proof notes.
  Its scaffold changes do not change the React source or timing scene.
- Jev reviews: zero file flags; all three flagged units labeled false.
  The resource owner also retains local hook view state; Core owns the value.
  Tests: zero of 94 entries flagged; promises: zero gaps, three unsure.
  Existing helper-size notes belong to prior tests and remain unchanged.
  Strict census and TSDoc checks pass.
- Full rebased gate: exit 0, including all package tests, prose,
  scaffold checks, and all 19 budget lanes.
- Marked class internals private with the TypeScript keyword.
  Stripped JavaScript matches the measured version apart from spaces.
  Full build, check, and 98 React tests pass after this type change.
  All 19 budget lanes pass again.
  The last Jev pass flags only useRun; its existing false label applies.

## Start sync lane: shared frames

Owner: lane writer (Codex), branch `start/sync-lane`.

- Ticket: `start/sync-frame-share` (S3, S9).
- Streams at one cursor share the encoded page per wake.
- Account IDs use length-prefixed keys to stay apart.
- Each stream copies the saved bytes and cursor values.
- Account checks before and after the read stay per stream.
- Existing two-stream proof checks equal frames.
- Existing private, replay, and failed-read tests pass.
- Probe: 100 streams, 10 commits, 11 frame encodes total.
  One is the warm-up; each commit makes one frame.
- Checks: root `vp check` exit 0, 27 warnings.
- Sync and type-check tests: 43 pass, exit 0.
- Full Start test attempt hit five 5 s time limits.
  The same sync and type-check files pass with 60 s.
- Queued speed check at 100 streams, 10 commits:
  `no difference we can see` across five paired rounds.
  The retained gain is one encode per cursor per commit.
- Assumption: the lane includes its sync tests and proof files.
  There is no frame or wheel prototype patch in the study.
- Push revocations stay out of this lane, as the brief says.

## Start sync lane: tab frames

- Ticket: `start/sync-client-frame` (C1-C3, C5, C7).
- Only the network message is parsed.
  The tab passes `{ version, message }` as typed input.
- Frame apply, bootstrap, batch apply, and leave run in place.
- Version reads no longer make an account token.
- Snapshot waits skip an absent account change.
- The two factories with no waits now run in place too.
  Core requires this before their callers can drop async.
- The ready waiter test awaits its own result now.
  It no longer relies on a fixed number of promise turns.
- Regression: settle returns a plain success value.
  It failed before the fix with a Promise instead.
- Tab and client tests: 52 pass, exit 0.
- Frame speed probe at 100 streams:
  `no difference we can see`, including isolated byte copies.
  This is a work-count gain, not a proved speed gain.

### Impact block

- `receiveMessage` is exported from the testing entry.
- Old call: `rawInput: { version: 1, data }`.
- New call: `input: { version: 1, message }`.
- Network door: `streamMessage.parse(JSON.parse(data))`.
- In-package callers: consumeConnection and sync-tab tests.
- App callers: scaffold sse and waste tests.
- Sync client methods are now sync; its source shape changes.
- Scaffold sync-client tests await only calls with a signal.
- Scope grows to those three consumer test files.
  They call the changed testing seam and must stay green.
- Review: `scripts/scip.sh refs` for receiveMessage,
  syncClient, and notifications in start.

- Consumer sync tests: 12 pass, exit 0.
- Root code check: exit 0, 27 warnings, as before.
- Jev test review: 0 of 189 entries flagged.
- Jev promise review flagged the new sync-settle title.
  The README now states the promised behavior.
- All other Jev flags have false labels with reasons.
- Calibration stays with the lead at landing.
  This writer does not land or push.

## Start sync lane: shared heartbeat clock

- Ticket: `start/sync-heartbeat-wheel` (S4-S7).
- One timer serves ten one-second buckets.
- It sleeps to the next exact deadline.
  Staggered heartbeats and leases do not round up.
- A wake clears held timer slots before resuming requests.
- A close clears its subscriber and wakes its held wait.
- The last scheduled close stops the shared sleep.
- A stream wait makes no AbortController or signal graph.
- Activity waiters are made on pull, not on every wake.
- A current account check returns its revision in place.
- The account checks and 30 s leases stay as shipped.
- All 41 stream tests pass, including staggered deadlines.
- New test uses the test clock; no real-time wait.
- The old wait test now ends through close, not a wait signal.

### Impact block

- `notifications` is exported by the testing entry.
- Its wait now takes a lease deadline, not a signal.
- Request close already ends the subscriber's wait.
- Callers: eventStream, start sync tests, scaffold sse tests.
- The scaffold caller now waits for a wake without a signal.
- Review: SCIP refs for notifications in start,
  plus the scaffold test caller through the testing entry.
- Tab frame probe: 2,000 calls, all settle in place.
- Counted promises per frame: 5 before, 3 after.
  This includes the probe loop's own await.
- Count-only probe: 1,000 streams and 10 commits, free auth.
- Held clock sleeps: 1,000 before, 1 after.
- Sleep calls across the run: 11,001 before, 2 after.
- Heap per stream: 15,893 B before, 11,664 B after.
  These are the observed counts, not a speed claim.
- Event selects stay at 1 per commit.
  Account reads stay at 1,000 per commit.
- Queued speed probe: 1,000 streams and 10 commits.
  Five paired rounds returned `no difference we can see`.
- B includes the shared frames and the shared clock.
  This is a work and heap gain, not a proved speed gain.

### Core feedback

Core asks an async resource's caller to return a promise,
even after that resource is built.
Our two factories did no waits, so dropping async fixed it.
This filled-in example fails the type check today:

```ts
import { operation, resource } from "@tinker/core";
const dep = resource({
  label: "async.dep",
  factory: async () => 1,
});
operation({
  label: "sync.read",
  depends: { dep },
  run: ({ dep }) => dep,
});
```

The error is number versus number and PromiseLike.
A warm sync body over an async dependency still needs a
Core type decision; this lane does not change Core.

### Lane gates before fault testing

- Install, full build, and code check returned 0.
- Code check keeps 27 warnings, the same as main.
- Full tests returned 0 with one package at a time.
  An earlier parallel attempt hit a 5 s supplier limit.
- A test run overlapped a check that rebuilt Core files.
  The clean build followed by serial tests returned 0.
- Prose and scaffold check returned 0.
- Scaffold check proved real auth, mail, and two-tab sync.
- Scaffold registry output includes the updated test calls.
  The two generated JSON files belong with those calls.
- All 19 release lanes passed; no ratchet changed.
- Jev: 0 of 191 test entries flagged.
- Jev: 0 of 189 promise titles lacked a README line.
  Another 42 titles were below its confidence floor.
- All source flags have labels with reasons.
- Style census: OK for the sync source.
- TSDoc check: 17 files, no S26 rows.
- Source review found no other caller changes.

```bash
scripts/scip.sh refs \
  'receiveMessage|syncClient|notifications' start
```

- Review also kept clock failures on each stream body.
  One failed shared sleep rejects all its held stream waits.
  The root still closes clean, as it did before the wheel.
- The added scope test proves both body failures.
- The build, code, full test, and prose checks returned 0
  again after that clock error fix.
- The router's last version-only read now skips capture.
  Its 27 tab tests and package code check returned 0.
- Probe baseline: clean, pinned `5d9c0537`.
  The frame prototype was not saved by the study.
  The count probe uses the study's fan-out driver.
  Its heap copy drops time fields and counts sleeps too.

### Final source proof

- Caught up to `f360f870`; all three tickets are saved.
  Both lanes' board cards, notes, and Jev labels were kept.
  The scaffold registry was rebuilt from merged source.
- Fetch and rebase returned 0.
- Install, full build, and root code check returned 0.
  Code check: 0 errors and the same 27 warnings.
- Full tests returned 0, with one package at a time.
  Start has 435 passing tests.
  React retains its one existing skipped test.
- Prose, scaffold check, and validate returned 0.
  All 19 release checks passed; no ratchet changed.
- A board blank line failed the first post-merge check.
  Formatting it fixed that check; the full chain passed.
- All source judge flags have labels with reasons.
  The last router read also uses the plain version call.
- The final full Start fault test must use the clean source.
  Its source SHA, exit, and kills-only floor go in
  [the mutation summary](start-sync-mutation.log).
- Raw logs and count probes stay in
  `/home/paseo/.cache/tinkered-sync-lane/`.
- No ticket was dropped.
  Push revocations remain outside this brief.
  No push or publish was made.

### After the server lane landed

- The lead asked for a fresh run on the new main.
- Stopped mutation PID `532989` with SIGINT.
  Its four worker PIDs also exited.
  The old run ended with 130 and does not count.
- Rebased onto `0f4152f5`; kept both lanes' changes.
  Sync calls keep the plain return values.
  The copied scaffold tests were rebuilt from source.
- Install, build, code check, and full tests returned 0.
  Start now has 440 passing tests.
- Prose, scaffold check, and validate returned 0.
  All 19 release checks pass; code has 27 warnings.
- A duplicate build overlapped the first scaffold check.
  That check could not find the built Core files.
  A fresh build and the ordered check chain returned 0.
- Count probes were rebuilt against clean `0f4152f5`.
  Held sleeps: 1,000 before, 1 after.
  Sleep calls: 11,001 before, 2 after.
  Heap per stream: 15,896 B before, 11,665 B after.
  Event reads: 1 per commit; account reads: 1,000.
- Tab probe: 2,000 calls; plain returns: 0 before, 2,000 after.
  Promises per frame stay at 5 before and 3 after.
- The earlier speed verdicts name the old baseline.
  They showed no difference we can see.
  No speed gain is claimed for the new base.
- The final fault-test log names the new clean source.
  Only that log's header and summary are saved after it.

## start/telemetry-lane

- Owner: lane writer (Codex), branch `start/telemetry-lane`.
- Assumption: the lane owns telemetry source and its tests.
  I8 changes the shared request body owner outside this lane.
  Leave I8 to the server lane; its old composite signal stays.
- No study diff was supplied for these tickets.
  Use the checked `probes/obs/b.mjs` as the encoding model.
- The existing tests use private Start glue through a real scope.
  Keep that seam; no new public export just for a test.
- The lead reviews and lands; no push or publish.

### start/telemetry-serialize-once

- Keep one JSON string and byte count per retained record.
  Console lines and send bodies reuse that string.
- Size into one scratch buffer; no byte array per size read.
- A trace keeps its side beside its storage JSON.
  Browser framing restores the side without a second encode.
- Span events move out of the export body.
  Attribute primitives skip the bigint replacer.
  Whole milliseconds use text for nanoseconds, including zero.
- Publish queue health once per span.
- Equality tests cover exact UTF-8 log bytes and trace bodies,
  including a retry; existing wire and byte bound tests pass.
- A full queue drops a log without reading its message.
- Full check: exit 0, no errors and 28 warnings.
- Queue timing and final whole-lane gates follow below.

- Full Start tests after encoding: exit 0, 434 pass.
- Count probe, 1,024 spans, queue drained every 32 spans:
  log encodes 3,072 -> 1,024; trace encodes 2,048 -> 1,024.
  Fixed-clock console output is byte-equal, `cmp` exit 0.
- The first queue attempt used absolute sandbox paths.
  It failed to find the bundle, exit 1; it proves no speed result.
  The retry uses relative paths from the pinned base.

### start/telemetry-capacity

- A full 64-record or byte-limited batch starts at once.
  Successful sends keep draining, including the last short batch.
  One batch sends at a time; a failure waits for a later retry.
- Keep the 512-record, 1 MiB, and per-send byte limits.
- Server console output now uses a bounded batch.
  It holds at most 512 lines and 48,000 UTF-8 bytes.
  A pipe that needs drain gets no extra write.
  Storage and console copies each count their own drops.
- The close result's final data includes drops at close.
- All three new checks fail on pinned main `5d9c0537`, exit 1.
  The console tag was copied as an unused test binding only;
  main's console still writes straight to stdout.
  The pinned tree was restored after the check.
- All 39 focused telemetry checks now pass, exit 0.
  The burst sends 300 records at test-clock time zero, peak one send.
- Updated old checks that assumed a full batch waits.
  Their count and byte bounds are unchanged.
- Focused type, lint, and format check: exit 0, no warning.

- Queue A/B for encoding: exit 0, **b is faster**.
  Five paired rounds, one run per side, ten timed runs total.
  100,000 real observer spans, with a send every 32 spans.
  A: pinned clean main `5d9c0537`; B: clean `d1d7ef2e`.
  Bundles were made from those trees before the capacity edit.
  Median A 3,180 ms, B 1,821 ms; range stays below zero.
  This measures that driver, not full app throughput.
  Raw log: `/home/paseo/.cache/tinkered-briefs/telemetry-ab-relative.log`.

### start/ingest-sync

- Browser ingest and receive now finish with plain values.
  No async wrapper or wait around the queue's sync run.
- Transferred log records take the server service in place.
  The route owns its parsed records; raw input still gets a copy
  from the existing schema, so caller data stays unchanged.
- Endpoint helpers live at module scope.
  Each request keeps one class with shared methods.
- Header checks use plain branches.
  The preview rule, id rule, and decoder are shared.
- Join byte chunks in memory; one chunk needs no copy.
  No Blob read around bytes already held by the request.
- The sync-settle check failed before the fix, exit 1.
  It checks a plain result without awaiting it.
- I8 stays outside this lane, as noted above.
  No speed or whole-request promise count claim for ingest.

- All 15 ingest and record checks pass, exit 0.
  The real server ingest also returns a plain settled result.
  A split UTF-8 character and nonzero byte-view offsets read correctly.
- Trusted `input` transfers ownership; `rawInput` is copied by parsing.
  The service check now uses `rawInput`, as the route's door does.

### Whole-lane review

- Both sync result checks fail on pinned main, exit 1.
  One binds a sync ingest function; one uses the real server part.
- Observer export bytecode: 511 -> 144 bytes, default engine.
  This is a size count, not an inlining or speed claim.
- Fast-code ceilings are unchanged: no watched Core or React
  function, slot, closure, or client dependency ceiling changed.
- Jev preflight: zero file flags; seven unit flags labeled false.
  Delivery performs HTTP work, not settings declaration.
  Ingest updates an existing required service field.
  Endpoint waits on its signalled call, not a storage send.
  Queue state belongs to its buffer owner; close is bounded,
  and every send loop checks its stop signal.
- Test judge: zero test flags.
  Private imports stay: the brief requires scope tests of Start glue.
- Strict census: one new array-index hit fixed with `at(0)`.
  Remaining S06 is the three old browser console calls.
  Their output is a shipped promise and part of this brief.
  Remaining T04 is the required private glue-test seam.
  No rule or public API was changed to hide either exception.
- TSDoc parser: no error.
- Promise judge: added the exact cached-record promise.
  The old sync reconnect README gap stays outside this lane.
- Initial full test run: exit 1, a flight supplier check timed out
  after five seconds during concurrent package runs.
  Retry with one package task at a time; no timeout setting changed.
- Core feedback: none; sync settle and final close data already exist.
- Final mutation proof will name the clean source commit in
  [telemetry-lane-mutation.log](telemetry-lane-mutation.log).
  Only that header and summary are committed after the run.

### Final close guard

- A forced close without the telemetry extension exposed a bug
  in the new final health write: Core had sealed its data owner.
- The new check failed on the first version of this change, exit 1.
  It now passes with no teardown error.
- The extension's close hook publishes final health while data is live.
  A forced defer only releases its buffers after that owner is sealed.
  No late write or caught Disposed error hides the close state.
- All 40 focused checks pass after this guard, exit 0.
- Main gained the scaffold lane while this work ran.
  Rebased onto `f360f870`; kept both progress sections and both label banks.
  Core, React, and Start source on the pinned base did not change upstream.
- A later full-driver timing check lacked the shared mutation lock.
  Its result is discarded; the last check waits on that lock.
  The first encoding verdict above remains the valid ticket proof.
- The complete gate is repeated after the close guard and rebase.
  The merged progress file needed one blank line for the formatter.

### Final source gates

- Fetch, rebase, install, build, check, package tests, prose,
  scaffold check, and validate all exit 0.
- Check prints zero errors and 28 warnings.
  Start has 439 passing checks; all 19 release lanes pass.
- Package tasks ran one at a time to avoid the first timeout.
  No test timeout, mutation floor, or fast-code ceiling changed.
- Scaffold checks used real services and stopped their own processes.
  Nothing was published or pushed.
- The board now waits in Review.
  The final clean source commit will be named in the mutation log.
  Only that proof log changes after the mutation run.

### Locked final timing proof

- The final export driver ran alone under the shared mutation lock.
  It used the pinned clean base and a bundle of the final source.
- `benchctl ab` exits 0: **b is faster**.
  Five rounds, one run per side in each round.
  A median 2,285 ms; B median 1,076 ms; change -52.9%.
  The 95% range for the change is -1,876.5 to -701.2 ms.
- This times observer export and its queue, with fake HTTP replies.
  It makes no claim about live storage or HTTP ingest speed.
- The B bundle was built from clean `9b4e0f08`.
  Its record encoding and ingest source matches the rebased lane.
  A later fix changes the send cleanup; main adds the settings table.
  This timing proof predates both changes.
  The encoding-only verdict remains the serialization ticket proof.
- The full locked mutation run remains queued.
  Its wrapper reads the clean HEAD only after it gets the lock.

### Server-lane rebase before the run of record

- The lead asked for the new main before the mutation run.
  Main gained six commits, ending at `0f4152f5`.
  They change Start source, including telemetry settings.
- Cancelled this lane's own queued PID `447036` before rebasing.
  It had not acquired the lock; its log was empty.
  It exited 143 and supplies no mutation proof.
- Fetch and rebase exit 0.
  Kept both lanes' board cards, progress notes, and Jev labels.
  There were no TypeScript conflicts.
- The encode, queue, send, and ingest source is unchanged.
  The rebased lane includes main's new settings table and server work.
- Gates run again on this base before one clean mutation run.
  Its log will name the rebased source commit, not the old source commit.

- All nine gates on the rebased lane exit 0: fetch, rebase, install,
  build, check, all package tests, prose, scaffold check, and validate.
- Check has zero errors and 28 warnings; Start has 444 passing checks.
  All 19 release lanes pass.
- Scaffold proof passes and stops its own browser, server, relay,
  and Compose processes; nothing is published.
- The source commit is saved before the new mutation job is queued.
  After its run, only the mutation header and summary log are committed.

### A full batch when a send ends

- A check of the send boundary found a second full batch left waiting.
  Storage had 64 records; health said 64 pending; the clock stayed at zero.
- The async send returned before its promise's `finally` cleared `pending`.
  A new full batch could join that finishing promise and miss its send.
- Cleanup now runs inside the async send, in the same step as its return.
  A later producer sees the free sender and starts a new batch at once.
- The new scope check failed before this fix, exit 1.
  It now checks 14 arrival points with real response-body cancellation.
  It sends 128 records, leaves zero pending, and keeps the clock at zero.
- All 38 focused checks pass, exit 0.
  The extra test-body lint warning is fixed; check has 27 warnings,
  matching main, and zero errors.
- Stopped only this lane's active mutation tree, rooted at PID `570755`.
  That partial run exits 143 and is discarded; it is not the run of record.
- Main gained the React lane, ending at `ba808cc5`.
  Rebased again; kept both progress sections and both label banks.
- The fix and test stay in the capacity ticket's commit.
  Gates are repeated before the one complete mutation run on the fixed HEAD.
- The old encoding A/B verdict still proves the serialization ticket.
  No fresh timing claim is made for the send cleanup fix.

### Fixed source gates

- The final source joins main `ba808cc5`, including server and React work.
- All nine gate exits are 0: fetch, rebase, install, build, check,
  all package tests, prose, scaffold check, and validate.
- Start has 445 passing checks; React has 98.
  Check has zero errors and 27 warnings, matching main.
  All 19 release lanes pass; scaffold proof stops its own services.
- One rebase gate first found unsaved proof notes.
  Saved them and repeated the clean gate; no source check was skipped.
- Jev preflight has zero file flags and four flagged units.
  All seven source questions have false labels with scope reasons.
  The queue's labels now name its fixed source.
- Test judge: zero of 196 entries flagged.
  The new send-boundary promise is explicit in the README.
- Promise judge: one of 194 titles has no README line.
  It is the old sync check that injects a frame from a closed source.
  That private sync rule is outside this telemetry lane.
  Its existing README gap stays with the sync lane.
- Strict census still exits 1 for S06 and T04 only:
  three required browser console calls and 32 private glue imports.
  These are the same brief-required exceptions; no rule was changed.
- Only the complete mutation run on the clean fixed HEAD will count.
  After that run, commit only its header and summary log.

### Sync-lane rebase before the run of record

- The lead asked for main `ae452162`, which adds Start sync work.
- Stopped only this lane's queued PID `674290`.
  It had not acquired the lock and its log was empty.
  Its exit is 143; it supplies no mutation proof.
- Fetch and rebase return 0.
  Kept both progress sections and both Jev label banks.
  Formatted the merged Markdown; there were no source conflicts.
- Telemetry source and tests match the fixed source before this rebase.
- All nine gates return 0: fetch, rebase, install, build, check,
  all package tests, prose, scaffold check, and validate.
- Start has 448 passing tests; React has 98.
  Check has zero errors and the same 27 warnings.
  All 19 release checks pass; no ratchet changed.
- Scaffold proof passes real auth, mail, and two-tab sync.
  Its browser, server, relay, and Compose processes stop cleanly.
- Jev preflight has zero file flags and four flagged units.
  All six flagged questions have false labels with scope reasons.
  The source and its labels remain the same after this rebase.
- Test judge has zero of 199 entries flagged.
- Promise judge returns 0 with one of 197 titles lacking a README line.
  It is the old sync test for frames from a closed connection.
  That private sync rule stays outside this telemetry lane.
- TSDoc parser checks all 13 telemetry files with zero S26 rows.
- Strict census exits 1 for S06 and T04 only:
  three required console calls and 32 private glue imports.
  The lane brief requires that test seam; no rule was changed.
- The complete mutation run must name this rebased clean source.
  After that run, only its header and summary log are committed.

## Core rules: batch A (2026-10-08)

- Owner: Core rules writer (Codex), branch `core/rules-lane`.
- Scope: `core/shape-preinit`, `core/run-budget`, `core/slot-order`.
  The tested run-budget change is dropped; layer defaults are dropped too.
  Kept V10 and V11 hook and controller fields, and V34 slot order.
- Source base: origin/main `0ff097b2`; pinned timing base: `5d9c0537`.
  Main's Core source stayed unchanged between these commits.
  Kept other lanes' saved proof and the lower React slot ceiling of 21.
- Assumption: public behavior stays the same.
  Existing public tests cover the same promises; no new bug is claimed.
- Assumption: the closing probe uses a resource context.
  Operation contexts have no `closing` field in the public API.
- Batch B waits for the lead to land A.
  Nothing is pushed or published.

### core/shape-preinit: keep V10 and V11; drop V9

- Set three hook-run fields and two controller fields at birth.
  Keep collections and callbacks lazy: only their slots exist at birth.
  Layer fields and tagged-frame defaults keep their original lazy shapes.
- The hook-run literal alone raised `runHookChain` from 235 to 250 bytes.
  `createHookRun` keeps the fields together and lowers the root to 222 bytes.
  Its saved ceiling falls to 222; no ceiling rises from main.
- Removed the one-use `hasCallNs` helper.
  Its same namespace check sits at its only call site.
  This pays for `createHookRun` without adding a module slot.
  `runOnce` falls from 502 to 499 bytes; its ceiling follows.
- Closing driver: hook access reads fall from two shapes to one.
  Sites with several shapes fall from 41 to 37.
  Layer reads keep three shapes before and after.
- The session-resource driver reads `ctx.closing` on every request.
  Sites with several shapes fall from 40 to 36.
  Layer reads keep four shapes before and after.
  Both drivers complete 70,000 reads and close each scope with success.
- Heap probe: 7/7 rounds without GC, which means memory cleanup.
  Min and max young space are both 64 MB; 10,000 calls per round.
  Hooked runs: 860 -> 865 B; nested operation-dependency runs: 739 -> 753 B.
  Both keep zero promises; no heap saving is claimed.
- Controller callbacks still belong to their controller.
  The settle callback and twin are made on first read and kept.
  The run callback can be passed alone, as before.

### core/run-budget: dropped

- Tried moving dispatch outside `runOnce` and guarding empty borrow releases.
  Bytecode fell from 499 to 429 bytes; several inline edges improved.
- N=61 against the shape-only tree: op was slower, 59.5 -> 81.8 ns.
  Run was slower too, 70.1 -> 73.4 ns.
  These are separate paired verdicts; median gaps do not add together.
- Tried keeping dispatch inside the old execution closure instead.
  Op was slower, 59.0 -> 67.5 ns; run was slower, 70.1 -> 75.2 ns.
  Tagged was faster, but lifecycle was slower, 753.9 -> 761.3 ns.
- Both attempts are dropped; their inline gains are not shipped.
  `runOnce` keeps its 499-byte root exception.

### core/slot-order

- Moved the report's 20 cold declarations below the hot block.
  Moved its 20 per-run and per-close names above the block.
- Replaced two private flag symbols with fields: `borrows` and `mayHook`.
  This is the report's two-slot merge; seven public brands stay for batch B.
  The extra room also fits `settleRun` and `enterHookAccess`.
- Highest Core context slot: 341 -> 339; its ceiling falls to 339.
  Hot block: last slot 254, with one slot left before wide reads.
  The slot check guards all 22 promoted names by name.
- Wide context instructions: 19 -> 5 across 13 exercised functions.
  Six other declarations in the driver list were not exercised.
  This count does not claim that all Core reads fit a small slot.
- `settleRun`: 59 -> 53 bytes; `stepRunHook`: 205 -> 201 bytes.
  Both bytecode ceilings fall with the code.
- Runtime size: 15,805 -> 15,892 B gzip, under 16,384.
  Room left: 492 B.

### Rejected timing attempts

- Each comparison used N=61 per tree and scenario, through the queue.
  Samples use mitata batch mode; the paired sign test leaves ties out.
  A verdict needs p below 0.05; medians alone are not a speed claim.
- The original full batch was slower for op and run.
  Op: 56.1 -> 64.1 ns; run: 69.6 -> 74.8 ns.
  Tagged, session, and lifecycle showed no difference we can see.
  [First timing summary](core-a-timing-first.log) saves that failed gate.
- Ticket isolation found the full shape change slower for op.
  Op: 55.8 -> 56.9 ns; run showed no difference we can see.
  Slot order after run budget showed no difference for op and run.
- Dropping run budget removed the op and run regressions.
  Op, run, tagged, and session showed no difference we can see.
  Lifecycle was still slower, 750.9 -> 757.2 ns; p was 0.020415.
- Dropped the four V9 layer defaults from layer and frame construction.
  The two drivers' layer shape gains from that attempt are not shipped.
  The last queued run compares all five rows without those defaults.
  No retained row is slower; slot order alone did not need a timing run.
  [Attempt summaries](core-a-timing-attempts.log) keep each verdict.

### Gates on the current source

- Fetch/rebase, install, and full build: exit 0.
  Main moved through `f360f870`, `ae452162`, and `0ff097b2`.
  Core code stayed the same; install and the full gates ran again after the last rebase.
  Kept the telemetry progress section and both Jev banks at their append conflicts.
- Ticket: exit 0 with `--no-mutation --check-only`.
  Full package tests, Core source tests (871), and dist tests (881) pass.
  Code check: 0 errors, 27 warnings, matching the starting tree.
- Validate: exit 0; all 19 lanes pass.
  Bytecode, slots, inlining, closures, and client checks pass.
- Prose and scaffold check: exit 0.
- Slot guard: the old tree fails at `settledValue`, slot 298; this tree passes.
- Fast-code break plants: exit 0.
  The engine-refusal plant exceeds 460 bytes even with a smaller root.
  Each planted rise is rejected, then unchanged inputs pass.
- Jev preflight reads 300 units: 113 flagged units, including one noisy hit.
  File judges skip the file because it exceeds their one-call size limit.
  Unit judges still read each unit.
  All 171 non-noisy hits in 112 units have labels with reasons.
  Five new cases are saved; seven earlier shape reasons are made precise.
  Core owns its engine state and must wait for its owned close work.
  Retained lazy layer writes are explained by the rejected V9 speed gate.
- Jev review and TSDoc parser: exit 0; no review flags or S26 rows.
- Changed declarations: strict style census exit 0.
  Full source keeps main's four failing IDs: S04, S10, S14, P06.
  Their counts match main: 2, 1, 1, 1; no new strict hit is added.
- Core feedback: none; this batch changes private engine code.
  No public API changed; no new bug or behavior test is claimed.
- Fault tests run alone under the shared lock, with an 85% kills-only floor.
  [Fault-test summary](core-a-mutation.log) names the final clean source commit.
  Only that header and summary are saved after the run.

### Final batch A timing

- A: clean main `5d9c0537`; B: clean no-layer tree `c36a3dbd`.
  The current built runtime matches that measured tree byte for byte.
  Engine: Node 24.21.0, V8 13.6.233.17-node.53.
- N=61 per side for each of the five required scenarios.
  Verdicts use the same paired sign test as the rejected attempts.
- **op**: no difference we can see; 56.2 -> 56.6 ns median.
- **run**: no difference we can see; 74.4 -> 73.9 ns median.
- **tagged**: no difference we can see; 179.7 -> 179.9 ns median.
- **session**: no difference we can see; 418.3 -> 419.2 ns median.
- **lifecycle**: no difference we can see; 752.0 -> 751.4 ns median.
- [Final timing summary](core-a-timing.log) saves p values, pairs, and the runtime hash.
  Shape and slot gains are limited to the measured drivers; no broad speed gain is claimed.
- The code commits are `96bd2c72` (V10/V11) and `6b951788` (V34).
  V9 and both run-budget attempts are dropped with their failed verdicts above.
- Lead review and Jev calibration come before landing.
  Batch B waits for A to land; no push or publish was made.
