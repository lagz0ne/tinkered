# 19: v1 validation milestone

**What to build:** the release gate — all budget lanes green together: bundle size (=20 kB gzip preferred / 30 kB max), promise budgets (0 on the sync lane, =10 for a representative async toggle), a live-heap-per-request budget, Stryker mutation score, CRAP complexity ceiling, both browser and node entry builds, and cast-free public examples. Benchmark measurement is the explicit exception to the no-clock test rule. (ADR 0016)

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18

**Status:** done (tag `core/t19`)

- [x] every budget lane passes; a regression fails the run — release gate `pnpm validate`
      (`scripts/validate.mjs`); a seeded cast was shown to fail it.
- [x] browser and node entry builds both pass — the engine is import/global pure; one universal ESM
      bundle, node import smoke green, dist has no node imports/globals.
- [x] concrete numeric thresholds recorded (`docs/roadmap/core-v1/budgets.md`): size 15,137 B gzip;
      promises 0 sync / 5 async (≤10); live heap 3,871 B/request (< 4 KB); mutation 77.45% (break 60);
      complexity 8 (hard); CRAP 8.73 (12.1 at the 60% floor, ceiling 30); cast-free examples 0 casts;
      deep chains 10k+ safe (build ceilings in ADR 0029 §8). Timing lanes run via `bench`.
