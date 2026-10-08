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
