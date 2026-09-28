# core v1 — budget baselines (ADR 0016)

Enforced now; **finalized at the v1 validation milestone (#19, tag `core/t19`)**. A change that
regresses a gate does not land. Release gate: **`pnpm validate`** (`scripts/validate.mjs`) runs every
deterministic lane and fails on any regression (proven: a seeded cast fails it). The mutation lane runs
via `vp run core#mutate`; the wall-clock timing lanes run via `bench` in a clean sandbox (not
in-container).

## Timing follow-up status — 2026-09-28

`perf/op-parity` is no longer parked: `benchd` is the runner. `bench/queued.sh` sends
`bench/ab.sh` through the queue, one job per scenario, one pinned core, no network. The
sandbox re-check of the call-path rules is done; see "Call paths through benchd" below.

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
Kept as history: the sandbox re-check is "Call paths through benchd (2026-09-28)" below.

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

## Call paths through benchd (2026-09-28)

The sandbox re-check the t27 table waited for. Each tree runs its own `bench/core-probe.mjs`
against its own `dist`. N=61 process runs per tree per scenario, A then B, on one core through
`benchd`. Numbers are medians in ns per call; "slower k/61" counts the pairs where B took
longer than A.

- **B (current)** — `origin/main` `13e09c8`
- **A1** — `core/t24` `bdc2971`
- **A2** — `core/t27` `2e1f261`

A verdict of "B slower" needs both a median gap over 2% and more than 45 of 61 runs slower;
"B faster" is the same the other way; anything else is "no difference we can see".

### Main vs t24

The t24 probe has no `inline`, `session`, `tagged`, or `opres`, so those are left out.

- **`op`** — 79.0 → 101.0 (+22.0, +27.9%), slower 61/61: B slower
- **`run`** — 88.7 → 113.2 (+24.5, +27.6%), slower 61/61: B slower
- **`create`** — 169.5 → 205.4 (+35.9, +21.2%), slower 61/61: B slower
- **`cold`** — 747.4 → 756.6 (+9.2, +1.2%), slower 39/61: no difference we can see
- **`warm`** — 20.0 → 26.5 (+6.5, +32.5%), slower 61/61: B slower
- **`lifecycle`** — 934.1 → 944.9 (+10.8, +1.2%), slower 31/61: no difference we can see

### Main vs t27

The t27 probe has no `opres`, so it is left out.

- **`op`** — 89.7 → 101.0 (+11.3, +12.6%), slower 61/61: B slower
- **`run`** — 101.6 → 113.1 (+11.5, +11.3%), slower 61/61: B slower
- **`inline`** — 193.9 → 194.0 (+0.1, +0.1%), slower 37/61: no difference we can see
- **`session`** — 1584 → 1681 (+97, +6.1%), slower 58/61: B slower
- **`tagged`** — 1942 → 2149 (+207, +10.7%), slower 60/61: B slower
- **`create`** — 176.5 → 205.7 (+29.2, +16.5%), slower 61/61: B slower
- **`cold`** — 761.0 → 759.4 (−1.6, −0.2%), slower 29/61: no difference we can see
- **`warm`** — 20.0 → 26.6 (+6.6, +33.0%), slower 61/61: B slower
- **`lifecycle`** — 935.9 → 940.3 (+4.4, +0.5%), slower 32/61: no difference we can see

### The t27 rules, checked

- **`op` ≤ t24 + 2 ns** — FAIL: 101.0 > 79.0 + 2 = 81.0
- **`run` ≤ t24 + 2 ns** — FAIL: 113.2 > 88.7 + 2 = 90.7
- **`inline` ≤ `run` + ~90 ns** — PASS: 194.0 ≤ 113.1 + 90 = 203.1
- **`tagged` ≤ 2000 ns** — FAIL: 2149 > 2000

This ticket only measures; nothing was fixed. The t27 `op` median (89.7) sits between its
min (76.3) and main's (101.0): the old bimodal floor still shows in A2, not in B.
Raw CSVs stay outside the repo, in `/home/paseo/next/tinkered-op-parity-csv/`.

The `op` and `run` FAILs are a probe artifact, not a core regression: see "Where the cost went since
t27" below.

## Where the cost went since t27 (benchd, 2026-09-28)

perf/op-parity found main slower than `core/t27`. This section splits that gap into 13 steps, one
per milestone tag. Timing only: nothing in core changed here.

How it ran:

- **One probe for all trees** — main's `bench/core-probe.mjs`, copied into every tree and run
  against that tree's own `packages/core/dist`. So a probe change cannot pose as a core change.
- **Each step** — tree B is a tag, tree A is the tag before it.
  `N=31 A=../<prev> SCEN="op create warm tagged" bench/queued.sh`, from B's root.
- **Numbers** — medians in ns per call, A → B; "slower k/31" counts pairs where B took longer.
- **Verdict** — "B slower" needs a median gap over 2% and more than 23 of 31 slower; "B faster" is
  the same the other way; anything else is "no difference we can see".
- Raw CSVs stay outside the repo, in `/home/paseo/next/tinkered-cost-timeline-csv/`.

### `op` and `run`: the op-parity FAIL is a probe artifact

- op-parity ran each tree's OWN probe: t27 `op` 89.7 → main 101.0.
- Here, with main's probe in the t27 tree, t27 `op` is 100.9; main is 101.8 (step 13).
- The `op` lines are the same in both probes (`operation`, `createScope`, `controller`, `opC.run()`).
- Main's probe only defines more scenarios (`opRes`, `asyncSub`, …). That changes how V8 runs the
  harness loop, not core.
- So the `op` ≤ t24 + 2 and `run` ≤ t24 + 2 FAILs above are not a core regression. `run` tracks
  `op`, so it was not timed per step.
- The real core costs since t27: `warm` (the t31 step), `create` (the http/t07 step), and `tagged`
  (a sum of several steps).
- Two fixes are already in progress: perf/warm-read and perf/create-presets.

### The steps

Each step lists its headline changes, then only the scenarios that moved.

- **1. t27 → t31** `fa7282f` — deps as values (ADR 0044), no lazy deps Proxy; tag edges in
  `resolve`; parse failure type.
  - `warm` — 20.0 → 29.7 (+9.7, +48.5%), slower 31/31: B slower
- **2. t31 → t35** `d9f333f` — extensions (ADR 0050): start, close, resolve, run, write chains.
  - `create` — 176.6 → 168.4 (−8.2, −4.6%), slower 0/31: B faster
- **3. t35 → t36** `d8bea8c` — session hook, extension in depends.
  - nothing moved
- **4. t36 → http/t07** `c84e33c` — Standard Schema parse; `Many<T>` + `readMany`;
  `Tag.Bindings`; `watch(next, prev)`.
  - `create` — 168.3 → 197.3 (+29.0, +17.2%), slower 31/31: B slower
  - `op` — 100.7 → 102.9 (+2.2, +2.2%), slower 30/31: B slower
- **5. http/t07 → namespace-v1/t01** `94fb8b3` — namespaces (ADR 0059); ambient random; log
  levels.
  - `op` — 103.3 → 114.4 (+11.1, +10.7%), slower 31/31: B slower
  - `create` — 197.3 → 206.0 (+8.7, +4.4%), slower 31/31: B slower
  - `tagged` — 2026 → 2103 (+77, +3.8%), slower 30/31: B slower
  - `warm` — 28.9 → 26.0 (−2.9, −10.0%), slower 0/31: B faster
- **6. ns/t01 → ns/t02b-1** `acf1877` — named resources keyed by namespace; hold-aware release.
  - `tagged` — 2097 → 2223 (+126, +6.0%), slower 29/31: B slower
  - `warm` — 25.8 → 26.6 (+0.8, +3.1%), slower 28/31: B slower
  - `op` — 114.5 → 106.6 (−7.9, −6.9%), slower 0/31: B faster
- **7. ns/t02b-1 → tagged-promises** `2584f21` — named release drain; span clock; fewer close
  promises.
  - `tagged` — 2250 → 2118 (−132, −5.9%), slower 1/31: B faster
  - `create` — 206.1 → 213.4 (+7.3, +3.5%), slower 23/31: no difference we can see (one pair
    short of the bar)
- **8. tagged-promises → caught-subflow** `35b6658` — caught subflow errors; namespace watcher
  index.
  - `op` — 106.7 → 101.1 (−5.6, −5.2%), slower 0/31: B faster
- **9. caught-subflow → ext-hooks-every-layer** `1a81f1e` — run and write hooks on every layer.
  - nothing moved
- **10. ext-hooks → errors/t03** `eedf309` — sticky panic, `settle`, origin stamps (ADR 0067).
  - nothing moved (`tagged` +3.3%, slower 22/31: no difference we can see)
- **11. errors/t03 → drivers/t08b** `62f5f52` — units have no meta; release code moved to the
  end of `index.ts`.
  - nothing moved
- **12. drivers/t08b → with-data** `9616bf4` — `close({ withData })` (ADR 0069); cancel reason
  text.
  - nothing moved (`tagged` +2.5%, slower 20/31: no difference we can see)
- **13. with-data → main** `337978e` — TSDoc and comments only.
  - nothing moved
- `run`, `session`, `inline`, `cold`, `lifecycle` were not timed per step.

### Top 3 steps per scenario

- **`warm`** (+48.5% at step 1 alone)
  - step 1 (t31): +9.7 ns
  - step 6 (named resources): +0.8 ns
  - step 5 (namespaces) gave back −2.9 ns
  - likely hot spot: since t31 a default resource controller reads through `resourceSlot`, two
    map lookups where t27 had one (perf/warm-read)
- **`create`**
  - step 4 (http/t07): +29.0 ns
  - step 5 (namespaces): +8.7 ns
  - step 7: +7.3 ns (no difference we can see)
  - step 2 (extensions) gave back −8.2 ns
  - likely hot spot: empty presets walk a shared empty list through a real iterator
    (`readMany`), and preset setup no longer inlines (perf/create-presets)
- **`tagged`**
  - step 6 (named resources): +126 ns
  - step 5 (namespaces): +77 ns
  - step 10 (errors): +69 ns (no difference we can see)
  - step 7 (tagged promises) gave back −132 ns
  - likely hot spots: step 5, the namespace chain passed through every resolve and run (a
    `chain = layer.ns` default argument) and the `call.ns` check; step 6, session resources keyed
    by namespace and the hold-aware release at session close
- **`op`** (net ≈ 0 with one probe)
  - step 5 (namespaces): +11.1 ns
  - step 4 (http/t07): +2.2 ns
  - steps 6 and 8 gave back −7.9 and −5.6 ns

### Do the steps add up?

- **`create`** — steps sum to +31.7 ns; op-parity +29.2 (176.5 → 205.7). About 9% over.
- **`warm`** — steps sum to +7.2 ns; op-parity +6.6 (20.0 → 26.6). About 9% over.
- **`tagged`** — steps sum to +366 ns; op-parity +207 (1942 → 2149). About 77% over.
  End to end with one probe it matches: t27 1943 → main 2176 (+233, +12.0%).
- **`op`** — steps sum to −2.0 ns; op-parity +11.3. The gap is the probe artifact above: with
  one probe, t27 100.9 → main 101.8.
- Why sums drift: each step times its trees again. The same tree's `tagged` median moved up to
  2% between two steps (errors/t03: 2191 as B in step 10, 2145 as A in step 11). Eight `tagged`
  steps rose 1.5–3.3% with "no difference we can see"; together they add +305 ns of noise.

## Warm reads through the saved record (2026-09-28)

`perf/warm-read` restores the default resource controller's direct read of its saved live record.
The read keeps both open checks, one use event, and the stable async promise.
Cold and named reads still use the full resolver.
Release still clears the saved record in place.

- **A** — `origin/main` at `337978e`, in `../tinkered-warm-base`.
- **B** — `c776b11`, the six-line change to `resourceController`.
- **Method** — 61 A/B pairs per scenario through `bench/queued.sh`, one core through `benchd`.
- **Values** — medians in ns per call.
- **Bar** — over 2% median gap and more than 45 of 61 pairs in the same direction.

```bash
N=61 A=../tinkered-warm-base \
  SCEN="warm op run session tagged lifecycle cold" \
  bench/queued.sh
```

- **warm** — 26.4 → 18.0 (-31.8%); B faster.
  Faster 61/61, slower 0/61.
- **op** — 100.9 → 101.0 (+0.1%); no difference we can see.
  Faster 22/61, slower 26/61.
- **run** — 113.1 → 112.9 (-0.2%); no difference we can see.
  Faster 29/61, slower 29/61.
- **session** — 1688.0 → 1682.0 (-0.4%); no difference we can see.
  Faster 31/61, slower 29/61.
- **tagged** — 2160.0 → 2147.0 (-0.6%); no difference we can see.
  Faster 31/61, slower 30/61.
- **lifecycle** — 947.0 → 924.5 (-2.4%); no difference we can see.
  Faster 37/61, slower 24/61.
- **cold** — 789.0 → 797.0 (+1.0%); no difference we can see.
  Faster 18/61, slower 43/61.

No scenario met the B slower bar.
The full wrapper ended with `BENCH_EXIT=0`.

V8 proof came before timing, with Node `v22.23.3`.
`--print-opt-code` shows one `FindOrderedHashMapEntry` call in `warm`, at offset `0x8b`.
The base has two, at `0x8b` and `0x3f2`.
`--trace-turbo-inlining` still shows all six remaining warm functions inlined into the caller.
Both drivers print `CHECK 4200000`; neither logs an actual bailout.
The lesson: reuse the controller's live record, so each warm resolve skips a second owner and record search.

- **Gate** — `vp run -r build && vp check && vp run -r test`, `EXIT=0`.
- **Core tests** — 636 pass.
- **Check warnings** — 21 on both A and B.
- **Promises** — `promises_tagged=17`.
- **Validate** — all 44 lanes PASS.
- **Slots** — 247 hot names; last hot slot 249; headroom 6 names.

### Re-checked on `210e3af` after perf/create-presets

- **A** — `origin/main` at `dc40d00`, with the create fix.
- **B** — `210e3af`, this branch rebased onto it.
- **Method** — N=61 through `bench/queued.sh`, same bar.

- **warm** — 26.4 → 18.0 (-31.8%); B faster.
  Faster 61/61, slower 0/61.
- **create** — 183.9 → 183.9 (0.0%); no difference we can see.
  Faster 30/61, slower 29/61.
- **tagged** — 2132.0 → 2130.0 (-0.1%); no difference we can see.
  Faster 29/61, slower 30/61.

## Notes

- **Deep chains.** Teardown, release and session nesting are iterative/async and survive ≥10k
  (invariant 5). Two BUILD-time paths recurse on the native stack with finite, unrealistic ceilings —
  sync resource _dependency_ chains ~1k, `flushTree` through nested sessions ~5k — documented as
  accepted limitations in ADR 0029 (§8).
- **Timing lanes** (cold resolve, warm read, write+flush, deep inheritance, many sessions — ADR 0016)
  are wall-clock and must run via `bench -- node --experimental-strip-types bench/<lane>.mjs` from a
  clean worktree; report median/p95. Not run in-container (host-noise). The heap lane is a memory delta
  and runs in-container (recorded above); its authoritative value also comes from `bench`.
- **Hot names at V8 slot ≤ 255.** `scripts/check-slots.mjs` (a `pnpm validate` lane) fails when a name above the release block in `index.ts` gets a slot over 255; 5 names of headroom on 2026-09-26.
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
