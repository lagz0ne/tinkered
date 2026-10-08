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
