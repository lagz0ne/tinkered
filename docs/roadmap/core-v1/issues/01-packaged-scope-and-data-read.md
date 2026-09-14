# 01: Packaged scope + `data` read

**What to build:** `packages/core` builds and exposes `createScope()` and `data({ initial, parse, eq })`; through the scope seam you can read a data cell (`get`/`read`) and get its parsed initial value, with fully inferred types and no userland casts. First budget lanes (bundle size baseline, oxlint complexity, CRAP) are wired.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `createScope()` + `getController(data).read()` returns the parsed `initial`
- [ ] a cast-free public example type-checks (raw input parsing to a different type included later)
- [ ] `vp check` and `vp test` green; one behavior test at the seam (no mocks, ADR 0003)
- [ ] size + complexity gates record a baseline (ADR 0016)
