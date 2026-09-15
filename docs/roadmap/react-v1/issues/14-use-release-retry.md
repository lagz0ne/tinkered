# 14: `useRelease` + retry/reset

**What to build:** `useRelease()` returns a thin `release(cellOrResource)` over `scope.release`. Paired with an error-boundary reset, releasing a failed resource drops the failed instance so a re-resolve rebuilds a fresh generation (ADR 0032, core release-and-rebuild).

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] error boundary `onReset` calls `release(handle)`; the retry rebuilds the resource and renders the value (fresh generation)
- [ ] releasing a `data` cell reverts it to its inherited/initial value and notifies `useData` readers
