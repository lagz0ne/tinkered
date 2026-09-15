# 07: `useResource` async + Suspense

**What to build:** for an async build, `useResource(handle)` hands the promise to `use()` so a `<Suspense>` fallback shows while pending and the value renders once it resolves (ADR 0032). Uses the deterministic-async fixture (01).

**Blocked by:** 06, 01

**Status:** ready-for-agent

- [ ] a `<Suspense>` fallback shows while pending, then the value after the fixture resolves
- [ ] **load-bearing invariant:** re-rendering while pending reuses the SAME promise (core build-once caching) — the build runs once and Suspense does not hang forever (ADR 0032)
