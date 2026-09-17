# core v1 — budget baselines (ADR 0016)

Enforced now; **finalized at the v1 validation milestone (#19, tag `core/t19`)**. A change that
regresses a gate does not land. Release gate: **`pnpm validate`** (`scripts/validate.mjs`) runs every
deterministic lane and fails on any regression (proven: a seeded cast fails it). The mutation lane runs
via `vp run core#mutate`; the wall-clock timing lanes run via `bench` in a clean sandbox (not
in-container).

## All lanes at t19 (green together)

| lane                | budget                          | t19 measurement                          | how                                           |
| ------------------- | ------------------------------- | ---------------------------------------- | --------------------------------------------- |
| bundle size (gzip)  | ≤20 kB preferred / 30 kB max    | **15,137 B**                             | `vp run core#size` → `scripts/check-size.mjs` |
| promises — sync     | **0**                           | **0**                                    | `bench/promises.mjs` (async_hooks census)     |
| promises — async    | ≤10 (representative toggle)     | **5**                                    | `bench/promises.mjs`                          |
| live heap / request | a few KB (~hand-wired DI)       | **3,871 B**                              | `bench/heap.mjs` (`--expose-gc`)              |
| mutation score      | Stryker break ≥ 60              | **77.45%**                               | `vp run core#mutate`                          |
| complexity          | ≤ 8 (cyclomatic)                | **8** (hard cap)                         | oxlint `complexity` (`vite.config.ts`)        |
| CRAP                | ≤ 30                            | **8.73** (12.1 at the 60% floor)         | `scripts/check-crap.mjs` (cap² ·(1−cov)³+cap) |
| both entries        | pure universal ESM              | **pure** (no node imports/globals)       | dist purity grep + node import smoke          |
| cast-free examples  | 0 casts, typecheck clean        | **0 casts**                              | `packages/core/examples/*.ts` + `vp check`    |
| deep chains         | teardown iterative, no overflow | **10k+ safe**; build ceilings documented | `bench/deep.mjs` (see below)                  |

## Call paths (t27)

In-container references (min of 5, pinned core 7, this box, 2026-09-17) plus the
main-at-t24 comparison from the same alternating A/B runs. Wall-clock rows are
references — the sandbox `bench` is unavailable in this container today — and the
census rows are gates (`pnpm validate` runs `bench/promises.mjs` and `bench/heap.mjs`).

| scenario              | t27 reference (min of 5) | main at t24 (same A/B) | rule                                                                    |
| --------------------- | ------------------------ | ---------------------- | ----------------------------------------------------------------------- |
| `op`                  | 78.3 ns                  | 78.3 ns                | must not exceed main's t24 number + 2 ns in alternating A/B             |
| `run`                 | 88.5 ns                  | 88.5 ns                | must not exceed main's t24 number + 2 ns in alternating A/B             |
| `inline`              | 180.7 ns                 | 180.3 ns               | ≤ run + one handle+controller allocation (~90 ns)                       |
| `session`             | 1600.0 ns                | — (new probe)          | reference only                                                          |
| `tagged`              | 1939.0 ns                | — (new probe)          | ≤ 2000 ns here (= session + op + ~16%; the 16% is the sandbox question) |
| `promises_tagged`     | **17** (exact)           | — (new census)         | exact: a change that adds one fails                                     |
| `heap_tagged_per_req` | 4901 B                   | — (new figure)         | informative (no gate yet)                                               |

- **Part 1 residual:** no parity gap was measurable on this box. Main and the
  worktree share the same `packages/core/src/index.ts` at t26/bc60d80, yet both
  alternate between ~78 and ~90 ns for `op` (and ~89/102 ns for `run`) run to run —
  the ADR 0038 landing numbers (78→90, 88→101) sit inside that bimodal host noise.
  The t27 change keeps the hot closure at one optional `call.tags` read with the
  untagged body inline (`hasCallTags` helper, no extra frame or call) and records
  the floor above. Raw A/B lines are in the commit body.
- `tagged` (1939) ≈ `session` (1600) + `op` (78) + ~16%: the tagged path IS the
  session path plus one untagged run. The rule is the measured reference (≤ 2000 ns on
  this box), not a wish; where the extra 16% goes (the `stripTags` call object, the
  `runSessionWith` body closure) is the first question for the sandbox `bench`.
- `promises_tagged` = 17, measured by awaiting the run's own promise inside the
  hook window (awaiting through an extra async wrapper counts 18 — the wrapper's
  own promise, not the run's). Threshold is exactly 17.
- `heap_tagged_per_req` = 4901 B vs 2906 B untagged: one open child session + one
  in-flight tagged run retained per request. Informative only.

## Notes

- **Deep chains.** Teardown, release and session nesting are iterative/async and survive ≥10k
  (invariant 5). Two BUILD-time paths recurse on the native stack with finite, unrealistic ceilings —
  sync resource _dependency_ chains ~1k, `flushTree` through nested sessions ~5k — documented as
  accepted limitations in ADR 0029 (§8).
- **Timing lanes** (cold resolve, warm read, write+flush, deep inheritance, many sessions — ADR 0016)
  are wall-clock and must run via `bench -- node --experimental-strip-types bench/<lane>.mjs` from a
  clean worktree; report median/p95. Not run in-container (host-noise). The heap lane is a memory delta
  and runs in-container (recorded above); its authoritative value also comes from `bench`.
- **Historical baseline:** t01 = 401 B gzip.
