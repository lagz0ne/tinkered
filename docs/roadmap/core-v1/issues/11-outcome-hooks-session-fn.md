# 11: Outcome hooks + `session(fn)`

**What to build:** `session(opts, fn)` — normal `fn` completion = success (outside-in), a thrown error = `failed(cause)` (inside-out); `onOutcome` notifies each resource to commit/rollback; the failure-combination policy of ADR 0017 (cause primary, hook errors aggregated); automatic close.

**Blocked by:** 09, 10

**Status:** ready-for-agent

- [ ] success commits (exact audit count); failure rolls back
- [ ] a throwing `onOutcome`/cleanup is aggregated, does not change the settled outcome, does not stop others
- [ ] the session closes automatically after `fn`
