# 01: Browser harness + deterministic-async fixture

**What to build:** `packages/react` (`@tinker/react`) exists and its behavior tests run in **vitest browser mode** (real browser via the Playwright provider, chromium/headless — ADR 0033), rendering with `vitest-browser-react`. A shared **deterministic-async fixture** — a controllable deferred promise plus a resource/operation built on it — lets every later pending/fallback/settle transition be asserted with **no timers and no sleeps**. `react` is a `peerDependency` (`>= 18.3`); the package depends on `@tinker/core`'s public seam only (ADR 0030).

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] a trivial component renders in a real browser and an assertion passes (`vp test` green)
- [ ] the deferred fixture resolves/rejects on command; a test drives a pending→settled transition without timers
- [ ] `vp check` green; `react` is a peer dep; only `@tinker/core`'s seam is imported (ADR 0030)
