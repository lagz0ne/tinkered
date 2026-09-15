# 06: `useResource` sync value

**What to build:** `useResource(handle)` returns a synchronously-built resource's value directly, with no Suspense and no promise (ADR 0032).

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] a sync resource renders its built value with **no** `<Suspense>` fallback shown
- [ ] the built instance is the same one core caches for that owner (identity)
