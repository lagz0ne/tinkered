# Fast-code fixes: Start batch 1

## Assumptions

- The brief is writer work; the lead reviews and lands it.
- No push or publish.
- No fix diff exists for these three cards.
  Use the study's filled compression module as the patch.
- Auth owns only the database, fixed settings, and mail action.
  Each principal reads its own request headers.
- The app has no auth template file.
  Registry copies come from its backend source.

## scaffold/auth-scope

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

## start/abort-reasons

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

## start/compress-stream

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

## Final gates

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

## Not proven

- Auth construction has no timed speed claim or request-promise census.
  Its shared identity and per-request behavior are covered by scope tests.
- No claim about full SSR throughput or compressed byte savings.
- The lead still reviews and lands these commits; nothing is pushed.

## Queued first-byte check

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
