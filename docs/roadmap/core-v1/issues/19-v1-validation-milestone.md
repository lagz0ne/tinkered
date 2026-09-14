# 19: v1 validation milestone

**What to build:** the release gate — all budget lanes green together: bundle size (=20 kB gzip preferred / 30 kB max), promise budgets (0 on the sync lane, =10 for a representative async toggle), a live-heap-per-request budget, Stryker mutation score, CRAP complexity ceiling, both browser and node entry builds, and cast-free public examples. Benchmark measurement is the explicit exception to the no-clock test rule. (ADR 0016)

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18

**Status:** ready-for-agent

- [ ] every budget lane passes; a regression fails the run
- [ ] browser and node entry builds both pass
- [ ] concrete numeric thresholds recorded (heap, mutation, CRAP, timing-regression)
