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

2026-09-29: the probe now times every scenario the same way, and `bench/ab.sh` runs one probe
against both trees. The numbers to use are in "Call paths with warm-up and one probe" below.

## perf/tagged-close (2026-09-29)

A = main `917ee14` (core last changed in `233139d`).
B = `105d82b` on main (timed as `bdf9ed7`: same code, before a board rebase).
N=61 through `benchd`, one warmed probe, medians in ns per call.
Every row: batch in 61 of 61 on both sides.

```bash
N=61 A=../tinkered-tagged-land-base \
  SCEN="<all 20>" bench/queued.sh
```

- The 20: the 18 above, plus `taggeddefer` and `taggedres`.
- `taggeddefer`: a tagged call whose body adds a `defer`.
- `taggedres`: a tagged call that builds a session resource.

### The run

- **`s1_getctl`** — 265.5 → 197.8 (−67.7, −25.5%), slower 0/61: B faster
- **`s2_data`** — 281.9 → 224.1 (−57.8, −20.5%), slower 0/61: B faster
- **`s3_doubled`** — 516.5 → 430.4 (−86.1, −16.7%), slower 0/61: B faster
- **`s4_warm_ctl`** — 10.6 → 10.9 (+0.3, +2.8%), slower 53/61: B slower
- **`op`** — 95.9 → 80.8 (−15.1, −15.7%), slower 0/61: B faster
- **`opres`** — 301.2 → 265.3 (−35.9, −11.9%), slower 0/61: B faster
- **`asyncsub`** — 751.9 → 720.9 (−31.0, −4.1%), slower 5/61: B faster
- **`run`** — 112.3 → 94.5 (−17.8, −15.9%), slower 0/61: B faster
- **`inline`** — 187.1 → 165.3 (−21.8, −11.7%), slower 0/61: B faster
- **`tagged`** — 2150.3 → 198.0 (−1952.3, −90.8%), slower 0/61: B faster
- **`taggeddefer`** — 2303.2 → 372.9 (−1930.3, −83.8%), slower 0/61: B faster
- **`taggedres`** — 3190.9 → 2486.6 (−704.3, −22.1%), slower 0/61: B faster
- **`session`** — 1684.9 → 572.8 (−1112.1, −66.0%), slower 0/61: B faster
- **`cold2`** — 575.5 → 523.8 (−51.7, −9.0%), slower 0/61: B faster
- **`cold`** — 752.7 → 673.2 (−79.5, −10.6%), slower 0/61: B faster
- **`create`** — 192.0 → 121.7 (−70.3, −36.6%), slower 0/61: B faster
- **`warm`** — 16.0 → 15.9 (−0.1, −0.6%), slower 12/61: no difference we can see
- **`get1`** — 0.4 → 0.4 (+0.0, +0.0%), slower 0/61: no difference we can see
- **`lifecycle`** — 918.4 → 828.0 (−90.4, −9.8%), slower 0/61: B faster
- **`inferdi_cold`** — 195.9 → 192.7 (−3.2, −1.6%), slower 15/61: no difference we can see
- Raw rows: `tinkered-inv-reports/tagged-close-land-ab-2.csv`.

### Exception (user, 2026-09-29)

- `s4_warm_ctl` 10.6 → 10.9 ns (+2.8%, slower 53/61) is accepted.
- It is the trade for `warm`: 16.0 → 15.9 after the `nodeState` fix.
- The stack without the fix (`42556fa`) had `s4_warm_ctl` −8.3% and `warm` +22.5%.
- A follow-up card, perf/warm-ctl-trade, tries to win it back.

### Rule changes

- `tagged` ≤ 250 ns; measured 198.0.
  - It replaces ≤ 2000 ns.
  - The user's target was 200 ns (2026-09-29).
- `promises_tagged` = 2, exact; it replaces 17.
- The older tables below stay as history.

## Call paths with warm-up and one probe (2026-09-29)

### Why the probe changed

- mitata 1.0.34 picks, once per process, how it times a scenario.
- **Batch mode:** each timed sample runs 4096 calls, then divides.
- **One-call mode:** each timed sample runs one call.
  - The timer's own cost lands on every sample.
  - A single call's minimum leaves out the GC work its garbage causes.
- mitata picks batch mode only when the first call takes ≤ 500 µs and a later warm-up call ≤ 65.5 µs.
  - Source: `mitata/src/lib.mjs` lines 133, 135, 177, 185.
- A cold first call (V8 compiling each function on first use), or a GC landing in it, crosses that
  line at random.
- The base (`c5d1921`) ran `tagged` and `session` in one-call mode in every run of 2026-09-28/29
  (7 runs, 31 processes each).
- `fb35497` ran `tagged` in one-call mode in 9 to 11 of 31 processes, about 200 ns slower.
- The old CSVs (op-parity and cost timeline, 16 files), read by the heap column:
  - `tagged`: one-call in 990 of 990 rows;
  - `session`: 122 of 122;
  - `lifecycle`: 41 of 244; `cold`: 22 of 244;
  - `create`, `op`, `run`: 1 to 3 rows each; `warm`, `inline`: none.

### What changed in `bench/`

- `bench/core-probe.mjs` runs each scenario 10,000 times first, then calls mitata's `measure()`
  with both warm-up limits lifted. Every process is timed in batch mode by construction.
- Warm-up alone was not enough: with 10,000 warm-up calls, 3 of 31 `tagged` processes still
  landed in one-call mode (a pause in mitata's first call).
- The METRIC line says `mode=batch` or `mode=one` (4096 ticks per sample, or 1).
- `bench/ab.sh` runs B's probe against A's build and B's build (`CORE_DIST`), so a probe change can
  never pose as a core change.
- Each `ab.sh` "done" line counts the batch-mode runs per tree.

### The mode check

- `origin/main` (`31613e7`), both sides of the re-baseline below: batch in 31 of 31 per tree, in
  every scenario (18).
- `fb35497`: batch in 31 of 31, in every scenario.
  - `tagged`, `session`, `op`, `run`: from the A/B run below.
  - The other 14: a one-tree check, 434 of 434 runs.

### Re-baseline: main against itself

Both trees at `origin/main` `31613e7` (core last changed in `233139d`). N=31 through `benchd`, medians in ns
per call. The gap between two copies of one build is the noise floor at N=31.

```bash
N=31 A=../tinkered-main-base \
  SCEN="<all 18>" bench/queued.sh
```

- The 18: `op run opres inline session tagged create cold warm lifecycle s1_getctl s2_data`
  `s3_doubled s4_warm_ctl asyncsub cold2 get1 inferdi_cold`.

- **`op`** — 99.5 → 98.1 (−1.4, −1.4%), slower 10/31: no difference we can see
- **`run`** — 112.6 → 112.4 (−0.2, −0.2%), slower 11/31: no difference we can see
- **`opres`** — 312.5 → 314.1 (+1.6, +0.5%), slower 19/31: no difference we can see
- **`inline`** — 207.0 → 204.4 (−2.6, −1.3%), slower 11/31: no difference we can see
- **`session`** — 1689.3 → 1689.0 (−0.3, −0.0%), slower 17/31: no difference we can see
- **`tagged`** — 2196.9 → 2175.8 (−21.1, −1.0%), slower 13/31: no difference we can see
- **`create`** — 192.9 → 192.0 (−0.9, −0.5%), slower 11/31: no difference we can see
- **`cold`** — 762.5 → 759.9 (−2.6, −0.3%), slower 15/31: no difference we can see
- **`warm`** — 16.5 → 16.5 (+0.0, +0.0%), slower 5/31: no difference we can see
- **`lifecycle`** — 932.3 → 933.4 (+1.1, +0.1%), slower 19/31: no difference we can see
- **`s1_getctl`** — 265.8 → 266.8 (+1.0, +0.4%), slower 18/31: no difference we can see
- **`s2_data`** — 283.9 → 284.3 (+0.4, +0.1%), slower 15/31: no difference we can see
- **`s3_doubled`** — 514.1 → 515.1 (+1.0, +0.2%), slower 18/31: no difference we can see
- **`s4_warm_ctl`** — 10.8 → 10.8 (+0.0, +0.0%), slower 9/31: no difference we can see
- **`asyncsub`** — 777.4 → 775.8 (−1.6, −0.2%), slower 12/31: no difference we can see
- **`cold2`** — 646.5 → 647.9 (+1.4, +0.2%), slower 16/31: no difference we can see
- **`get1`** — 0.4 → 0.4 (+0.0, +0.0%), slower 0/31: no difference we can see
- **`inferdi_cold`** — 193.4 → 194.7 (+1.3, +0.7%), slower 16/31: no difference we can see
- Every row: batch in 31 of 31 on both sides.
- Noise floor: no gap past 2%; the largest is `op`, −1.4%.
- `get1` (one data read through a controller) is under 1 ns: too small to read at this scale.

### `fb35497` against main, both in batch mode

A = `origin/main` `31613e7`; B = `fb35497` (core) with this `bench/`. N=31.

- **`tagged`** — 2193.4 → 943.8 (−1249.6, −57.0%), slower 0/31: B faster
- **`session`** — 1715.3 → 831.3 (−884.0, −51.5%), slower 0/31: B faster
- **`op`** — 99.8 → 95.8 (−4.0, −4.0%), slower 5/31: B faster
- **`run`** — 113.3 → 110.1 (−3.2, −2.8%), slower 13/31: no difference we can see
- Every row: batch in 31 of 31 on both sides.

### Older tables are not comparable

- The older tables below mixed modes: large scenarios (`tagged`, `session`, some `lifecycle` and
  `cold` rows) ran in one-call mode.
- A batch number includes each call's share of young-generation GC; a one-call minimum did not,
  and it carried the timer's cost.
- So compare only numbers from this section on.

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

## Lazy log and obs tools (2026-09-29)

- **A** — `a462360`, the tagged-close tip named in the brief.
- **B** — `6f12546`, after `bdc63da` added lazy body tools.
- Both full context classes build `log` and `obs` on first read and keep them for that run or build.
- The caches are own fields; the getters live on the classes.
- Constructor-owned fields use `declare` to avoid writing each field twice.
- The shared OFF values stay shared.
- `raiseFrom` reads the saved span without building the body's observation tools.
- Automatic spans and step logs keep their existing paths.

### V8 before timing

- Node `v22.23.3`, with the same driver on both trees.
- Allocation sampling includes collected objects across 100,000 warmed runs.
- **`opsink`** — sampled `logFor` allocations: 60,013,800 → 0 bytes.
- **`opobs`** — sampled `obsCtx` allocations: 20,803,952 → 0 bytes.
- Automatic `openSpan` allocations remain at about 21.7 MB on both sides.
- These samples show removed work; they are not exact bytes per run.
- The built-code trace keeps every other inlined function in all six scenarios.
- In `oplog`, `logFor` is inlined into the new getter.
- Both built trees show zero deoptimization bailouts in all six scenarios.
- The diagnostic uses `--no-concurrent-recompilation` so compile order is stable.
- The timing screen uses the wrapper's normal Node flags.
- Source-only traces choose different inlining when the smaller constructor enters `runOnce`.
- The proof above uses the shipped, minified build.
- A bytecode check also finds `CreateFunctionContext` and `CreateClosure` in A's tool builders.
- Neither builder is called on B's unread-tool paths.
- V8 lines and allocation profiles live in `/home/paseo/next/tinkered-inv-reports/lazylog/`.
- `v8-proof.txt` names the trace files and lines.

### One N=31 screen

- One probe runs against both builds through `bench/queued.sh` and `benchd`.
- The wrapper holds `/tmp/mutation.lock` for the whole screen.
- Each scenario uses one core and 31 A/B pairs.
- Every scenario is in batch mode for 31/31 runs on each side.
- Values below are median ns per call, A → B.
- The bar is a gap over 2% and more than 23/31 pairs in the same direction.

```bash
N=31 A=../tinkered-lazylog-base \
  SCEN="opsink oplog opobs op run tagged" \
  OUT=.bench/lazylog.csv \
  flock /tmp/mutation.lock bench/queued.sh
```

- **opsink** — 224.1 → 67.0 (-70.1%); B faster.
- **opsink pairs** — slower 0/31.
- **oplog** — 280.1 → 282.2 (+0.7%); no difference we can see.
- **oplog pairs** — slower 16/31.
- **opobs** — 208.9 → 185.2 (-11.3%); B faster.
- **opobs pairs** — slower 1/31.
- **op** — 80.5 → 67.1 (-16.6%); B faster.
- **op pairs** — slower 0/31.
- **run** — 94.5 → 80.5 (-14.8%); B faster.
- **run pairs** — slower 0/31.
- **tagged** — 201.6 → 193.3 (-4.1%); B faster.
- **tagged pairs** — slower 7/31.
- Neither target misses its B faster bar; no scenario meets the B slower bar.
- The wrapper ends with `BENCH_EXIT=0`.
- Raw rows: `/home/paseo/next/tinkered-inv-reports/lazylog/lazylog.csv`.
- The six verdict lines are in `screen-summary.txt` beside the CSV.

### Behavior and gates

- Five new public-seam tests cover tool identity, logger destructuring, levels, order, manual resource spans, and caught error origins.
- Existing tests also check repeated operation tool reads and automatic full-factory spans without a body tool read.
- **Gate** — `vp run -r build && vp check && vp run -r test`, `EXIT=0`.
- **Core** — 705 tests pass, including five new tests.
- **Lint** — zero errors and 25 warnings, the same warning count as A.
- **Validate** — all 44 budget lanes PASS.
- **Promises** — sync 0, async toggle 5, tagged 2.
- Every test command holds `/tmp/mutation.lock`.
- **Prose** — `node scripts/prose-lint.mjs` and `vp run prose` pass.
- Mutation is left to landing, as the brief requires.
