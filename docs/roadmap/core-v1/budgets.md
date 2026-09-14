# core v1 — budget baselines (ADR 0016)

Enforced now; tightened at the v1 validation milestone (#19). A change that
regresses a gate does not land.

## Size (gzip, built entry)

- Budget: **≤20 kB preferred, 30 kB hard max** (zero runtime deps).
- Gate: `vp run core#size` (fails over the cap). Wired ticket 01.
- Baseline: **t01 = 401 B gzip**.

## Complexity / quality

- Cyclomatic complexity ceiling **8** — oxlint `complexity` (root `vite.config.ts`).
- Mutation score — Stryker `break: 60` (`vp run core#mutate`).
- A true CRAP metric (complexity × coverage) is deferred to #19, where numeric
  thresholds are finalized; oxlint + Stryker are the interim complexity gates.

## Performance (added per lane as tickets land)

- 0 promises on the sync lane (data read/write/flush) — bench lane from t02/t03.
- ≤10 promises for a representative async toggle — from the async tickets.
- Live-heap-per-request budget — from the resource/session tickets.
- Benchmark measurement is the explicit exception to the no-clock test rule.
