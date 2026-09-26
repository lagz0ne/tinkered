# core v1 — budget baselines (ADR 0016)

Enforced now; **finalized at the v1 validation milestone (#19, tag `core/t19`)**. A change that
regresses a gate does not land. Release gate: **`pnpm validate`** (`scripts/validate.mjs`) runs every
deterministic lane and fails on any regression (proven: a seeded cast fails it). The mutation lane runs
via `vp run core#mutate`; the wall-clock timing lanes run via `bench` in a clean sandbox (not
in-container).

## Timing follow-up status — 2026-09-19

The user accepts having no dedicated bench resource. `perf/op-parity` is Parked in
[TODO.md](../../../TODO.md); no runner provisioning is required and this follow-up does not
block sync completion. The off-host comparison remains unverified. Local timings remain
reference measurements, not proof of the off-host gate. Resume only when the user revisits
this work and a suitable runner is available; the recipe and budgets below remain the reference.

## All lanes at t19 (green together)

| lane                | budget                          | t19 measurement                          | how                                           |
| ------------------- | ------------------------------- | ---------------------------------------- | --------------------------------------------- |
| bundle size (gzip)  | ≤10 kB preferred / 15 kB max    | **8,056 B** (2026-09-21, minified)       | `vp run core#size` → `scripts/check-size.mjs` |
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

| scenario              | t27 reference (min of 5) | main at t24 (same A/B) | rule                                                                                       |
| --------------------- | ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------ |
| `op`                  | 78.3 ns                  | 78.3 ns                | must not exceed main's t24 number + 2 ns in alternating A/B                                |
| `run`                 | 88.5 ns                  | 88.5 ns                | must not exceed main's t24 number + 2 ns in alternating A/B                                |
| `inline`              | 180.7 ns                 | 180.3 ns               | ≤ run + one handle+controller allocation (~90 ns)                                          |
| `session`             | 1600.0 ns                | — (new probe)          | reference only                                                                             |
| `op` (t31, ADR 0044)  | 99.2 ns (med 101.7)      | 89.0 (med 106.4)       | in-container A/B min of 7: +10 min (one main outlier) / −4.7 med; sandbox re-check pending |
| `run` (t31)           | 110.6 ns (med 113.6)     | 116.4 (med 117.7)      | −5.8 min / −4.1 med                                                                        |
| `opres` (t31, new)    | 320.5 ns (med 328.6)     | 415.1 (med 424.4)      | op over a built sync resource: −95 ns (no lazy Proxy per call)                             |
| `tagged`              | 1939.0 ns                | — (new probe)          | ≤ 2000 ns here (= session + op + ~16%; the 16% is the sandbox question)                    |
| `promises_tagged`     | **17** (exact)           | — (new census)         | exact: a change that adds one fails                                                        |
| `heap_tagged_per_req` | 4901 B                   | — (new figure)         | informative (no gate yet)                                                                  |

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
- **Warm read is O(1) in chain depth.** It lives in `bench/warm-read.mjs`, not in core's tests.
- A wall-clock ratio in the default test run failed by luck on a busy box (tests/busy-host-flake).
- Run it through the queue: `benchctl exec -- node --experimental-strip-types bench/warm-read.mjs`.
- **Historical baseline:** t01 = 401 B gzip.
- **2026-09-21:** the build ships minified (`minify: true`, `sourcemap: true` in
  `packages/core/vite.config.ts`). Before that, TSDoc rode along in `dist/index.mjs`:
  25,901 B gzip with comments, 10,630 B without, 8,056 B minified. The cap moved
  30,720 → 15,360 B; TSDoc still ships in `dist/index.d.mts`.

## Big-sample A/B after the drivers track (2026-09-20)

`f92444b` (this morning: before the `session` hook, extension-as-dependency, `watch(next, prev)`, and the
four driver extensions) vs `bf532ef` (`main` after ADR 0051 landed). `bench/core-probe.mjs`, one scenario per
process, **31 process runs per tree per scenario, interleaved A B A B on `taskset -c 6`**, in-container (the
`bench` sandbox wrapper is not installed on this box, so absolutes are indicative; the alternation cancels the
drift). ns/iter; Δ is B against A.

| scenario  | n   | A min  | A med  | A p90  | B min  | B med  | B p90  | Δ med | Δ min |
| --------- | --- | ------ | ------ | ------ | ------ | ------ | ------ | ----- | ----- |
| op        | 31  | 99.3   | 101.7  | 102.7  | 91.6   | 101.4  | 102.6  | −0.3% | −7.8% |
| run       | 31  | 111.8  | 113.0  | 114.0  | 111.1  | 112.8  | 114.3  | −0.2% | −0.6% |
| opres     | 31  | 309.5  | 330.8  | 333.9  | 308.0  | 329.4  | 341.4  | −0.4% | −0.5% |
| inline    | 31  | 193.1  | 200.4  | 202.5  | 190.9  | 200.0  | 202.1  | −0.2% | −1.1% |
| session   | 31  | 1585.0 | 1631.0 | 1690.0 | 1560.0 | 1615.0 | 1658.0 | −1.0% | −1.6% |
| tagged    | 31  | 1948.0 | 2016.0 | 2072.0 | 1945.0 | 2015.0 | 2131.0 | −0.0% | −0.2% |
| create    | 31  | 167.7  | 168.2  | 168.9  | 167.5  | 168.3  | 169.9  | +0.1% | −0.1% |
| cold      | 31  | 700.0  | 712.1  | 728.6  | 693.4  | 710.1  | 729.4  | −0.3% | −0.9% |
| warm      | 31  | 28.6   | 29.0   | 29.8   | 28.6   | 29.2   | 29.8   | +0.7% | +0.0% |
| lifecycle | 31  | 863.8  | 878.1  | 911.6  | 867.0  | 894.9  | 927.5  | +1.9% | +0.4% |

Reading: every median within ±2%, well inside each scenario's own p90 spread — the `session` chain, the
`SESSIONS`/`SESSION_SETTLERS` side tables, and the `watch` `prev` argument cost nothing measurable when no
extension declares a hook, as ADR 0050 §5 requires. `session` itself is 1% faster (the t01 inline of the
unwrapped path). The one `op` min outlier (91.6) is the known bimodal host floor (t27 note above), not a change.
Raw data: `/tmp/ab.csv` at the time of writing; the runner is `/tmp/ab.sh` (10 lines; worth moving under
`bench/` if a second big-sample run is wanted).
