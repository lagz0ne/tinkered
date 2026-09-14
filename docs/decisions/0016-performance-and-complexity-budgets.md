# 0016 Performance and complexity budgets, set upfront

Date: 2026-09-14. Status: accepted.

## Context

tinker-engine deferred its performance schedule and paid for it: 44 kB gzip
against a 30 kB max, 83 promises per toggle against a ≤10 target, ~31 KB live
heap per request. Performance and complexity must be discussed upfront and used
to eliminate early complexity, not audited late.

## Decision

Set budgets now and enforce them; a change that regresses a budget does not land.

**Performance**

- Core is zero-dependency; bundle **≤20 kB gzip preferred, 30 kB hard max**.
- **0 promises on the synchronous lane** (data read/write/flush, sync resolve).
- **≤10 promises** for a representative async toggle.
- A live-heap-per-request budget (target: a few KB, near hand-wired DI).
- Bench lanes: cold resolve, warm read, write+flush, deep inheritance, many
  sessions. Run with `bench`; report median/p95, allocations, promise census,
  live + retained heap, and full-entry gzip.

**Complexity**

- Stryker mutation score threshold (via `vp run mutate`).
- A CRAP-style complexity ceiling; cut complexity where flagged rather than adding
  coverage around it. Oxlint `complexity` is already capped at 8.

## Consequences

- Complexity is held down from day one; features justify their cost against a
  number, echoing the numbered-hypothesis discipline without its overhead.
- CI/`vp run -r` wires size check + `bench` + `stryker` once the core exists.
