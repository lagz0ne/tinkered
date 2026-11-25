# 0170 The mutation gate runs on the change, in CI

Date: 2026-11-25. Status: accepted; step 1 built.
Accepted: Duke, 2026-11-25 04:20 UTC, option A
(mutation on the change, before release;
B: a canary on `next`, then `latest`;
C: release on green CI, mutation after).
Where: Duke, 2026-11-25 04:24 UTC, option A
(CI, on GitHub-hosted runners;
B: the box, by the lead, as before;
C: the box, on its own core).
Amends: ADR 0114 (a new version on main publishes).
Amends: CLAUDE.md, "Helper writers", lead step 3.
Page: Tinker Trunk Pipeline, v6.

## Context

A fix took hours to reach npm.
CI and release took about 20 minutes of that.

Measured on main `721be1a0`, 2026-11-24:

- CI: 17 minutes. Its three jobs run in turn
  on the box's one runner.
- Release: 2 minutes on the box,
  then under a minute on a hosted runner.
- #54: opened 11-23 06:43 UTC, work began
  11-24 15:38, landed 20:44.
  Its Core lane gave 84.17 on kills,
  with 328 timeouts under load. It ran again.
- cli, the whole lane: about 9 hours
  at box load 34.
- Core: 7,061 mutants. 17 to 18 minutes
  on a quiet box in October, with 3,574.

Each fix ran the whole lane again,
on the box that the model runs load.
No config set `incremental`.

## Precedent

- **Stryker incremental mode** (StrykerJS 6.2).
  It keeps the last run's results in a file.
  It tests again only a mutant whose code
  changed, or whose tests changed.
  The report still scores the whole package.
- **Continuous Delivery** (Humble and Farley):
  a fast commit stage, then slower checks
  in their own stage, on every commit.
- **The app Diff gate** (Duke, 2026-10-19):
  changed lines per change,
  the full run on a schedule.

## Proof

Cloud container, 4 cores, Stryker 10.0.0,
main `721be1a0`, cli `src/graph-rules.ts`:

- Run 1, full: 80 mutants, 14 min 21 s.
  3 min of that is the dry run.
- One line changed, same behavior.
- Run 2, `--incremental`: 74 of 82 results
  reused, 8 mutants ran.
  3 min 49 s, score 100 both times.

The dry run (every test, once) runs each time.
It is the floor of a run on the change.

Full lanes on hosted `ubuntu-24.04`,
branch `claude/project-thread-p5j11r`,
2026-11-25, no base (every mutant):

- core: 6,868 mutants, 103 min, 86.77
  (60 timeouts; the box run gave 328).
- react: 507 mutants, 50 min, 90.14.
- flight-trial: 1,775 mutants, 26 min, 88.62.
- bun: 843 mutants, 12.5 min, 86.95.
- bun run: 59 mutants, 8 min, 91.53.
- entry: 457 mutants, 1.7 min, 86.18.
- entry run: 8 mutants, 15 s, 87.50.
- devtools: 153 mutants, 12 s, 98.04.
- cli: 3,638 mutants, the longest lane.
- blueprint: its dry run finds no test,
  on main too. Out of the matrix until
  card `tools/blueprint-mutation-lane`.

## Decision

1. Each mutation lane runs on a
   GitHub-hosted runner (`ubuntu-24.04`),
   one job per lane, side by side.
   Workflow: `.github/workflows/mutation.yml`.
2. A lane is one Stryker config.
   `bun` and `entry` have two lanes each:
   the main config and `stryker.run.config.mjs`.
3. Each lane runs `stryker run --incremental`.
   It restores the newest base from the
   Actions cache and saves its own result.
   A failed lane saves its result too:
   its results are still true.
4. The score is the whole package's,
   so the floor stays 85 per package.
   Each config keeps `break: 85`.
5. Each night, and on demand, every lane
   runs with `--force`: all mutants.
   That run is the new base.
6. Step 1: the workflow runs on each push
   to main and gates nothing,
   until it is green on main.
7. Step 2: the release waits for the
   mutation workflow on the same commit,
   as it waits for `ci`.
8. Then the lead no longer runs a lane
   by hand before landing.
   The card's proof names the CI run.
   A writer may still run
   `--incremental` at home, for speed.
9. A red lane on main is a red trunk:
   fix forward or revert in 10 minutes.

## What incremental does not see

Stryker says so in its own docs:

- a change in a file it does not mutate
  and that is not a test file;
- a new dependency, a config, an env value;
- a test change, for a command-runner lane
  (`bun` run, `entry` run):
  it sees mutant changes only;
- static mutants: no coverage, so no
  test link.

The nightly `--force` run sees all of it.
So a gap lasts a day at most.

## Not chosen

- **Canary on `next`** (Q1 B): a fix
  reaches users in 20 minutes, but npm
  carries two versions per fix, and a
  `next` build has not passed mutation.
- **Mutation after release** (Q1 C):
  npm could ship code with weak tests.
- **The box** (Q2 B and C): load causes
  the timeouts. One kept core is too slow
  and blocks the benchmarks.

## Found while building

`ubuntu-latest` is Ubuntu 26.04 now.
Playwright 1.55 has no Chromium for it.
So the lanes pin `ubuntu-24.04`.
