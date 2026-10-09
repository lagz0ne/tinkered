# tinkered

## Toolchain: Vite+

`vp` is the one CLI: runtime, packages, dev, build, test, lint, format. It
wraps Vite, Rolldown, Vitest, tsdown, Oxlint, and Oxfmt.

- `vp <name>` runs a built-in. `vp run <name>` runs a `package.json` script
  or a `vite.config.ts` task. Check both files first; they can differ.
- `vp help`, `vp <command> --help`, `vp toolchain` for versions.
- Docs: `node_modules/vite-plus/docs`.
- Setup looks wrong: run `vp env doctor` and share its output.

## Checks before you call it done

- `vp install` after a pull.
- `vp run -r build` first: apps import the packages' built `dist`.
- `vp check` and `vp run -r test` (every package with its own config; a bare root
  `vp test` runs them all under the root config and fails on react, drizzle, and the
  playground).
- `vp run prose` after editing any `.md` (it also runs on commit).

## Stay on latest main

Main moves while you work. Catch up in small steps,
so the gap never grows big.

- Run `git fetch origin`, then `git rebase origin/main`:
  - before you start;
  - after each green commit, if main has moved;
  - before review, and again before landing.
- Then run `vp install` and `vp run -r build`.
  `scripts/worktree-sync.sh` does all of it in one step.
- A new worktree sets itself up: a git hook installs and builds it.
  `TINKER_SETUP=0 git worktree add …` skips that.
- Commit first. Never `git stash`.
- Fix a conflict at once, while it is small.
- A pinned tree (trial runner, bench base) stays on its commit.

## Writing (every `.md`)

The reader is on a phone. Rules and word list: `docs/writing-style.md`.

- A word with no `docs/glossary.md` row and a plainer twin is jargon. Cut it.
- One fact per line. Lists over tables. Code fences under 60 characters.
- Diagrams flow top to bottom.

## Designing

For a plan, a design, a decision, or "how does X work":

1. **Find the precedent first.** Look for a known model the problem already
   fits (POSIX signals, a DB transaction, an HTTP rule). Borrow its words and
   its settled trade-offs; note where ours is simpler. Example: ADR 0028
   treats close as graceful vs forced shutdown, as POSIX does.
2. `grill-with-docs`: one round of questions at a time. Write decisions to
   `docs/decisions/` and terms to `docs/glossary.md` as they settle.
3. `show-me`: show structure before asking about it.
4. `to-tickets`: split the settled design into tickets.
5. `coding-convention`: for every TypeScript file and test after that.

Skills live in `.agents/skills/`, linked from `.claude/skills/`.

## Finding code: SCIP

`scripts/scip.sh` finds a symbol's definition and every file that uses it.
Grep cannot tell two `run()` methods apart; SCIP can.

```bash
scripts/scip.sh index
scripts/scip.sh symbols 'OperationController' core
scripts/scip.sh refs 'Handle#\w+:run\(\)\.$'
```

When a public symbol changes across packages, the lead writes an impact block
before the code and checks `refs` at review (ADR 0065). Inside one package,
`vp check` and the tests are enough.

## The board: `TODO.md`

Work with more than one step runs from `TODO.md`. Its header defines the
lanes. The rules:

1. **Card first.** Name, next step, Verify line. Then code.
2. **One Doing card per lead.** Name the owner.
3. **Saved is not done.** Saved work waits in Review.
4. **Done needs proof you saw:**
   - code: `vp check` and the right tests green; for `core`, also
     `scripts/ticket.sh`;
   - a size or speed claim: `pnpm validate`; timing via
     `N=61 bench/queued.sh` (or more), never a bare `ab.sh`;
   - a bug fix: a test that fails without the fix;
   - "it works": the output that shows it.
5. **Keep it true.** Blocked names what is missing. Parked names what would
   restart it. Never start parked work just to clear the board.

Ticket detail and proof go in the track's `docs/roadmap/<track>/PROGRESS.md`.

## Timing: send it to the queue

This box runs about 65 containers. Two benchmarks at once
ruin both. `benchd` is the queue that stops that: one job
runs at a time, the rest wait.

Never time code by hand, and never run `bench/ab.sh`
straight. Use the wrapper.

```bash
git worktree add ../tinkered-base <sha>
N=61 A=../tinkered-base bench/queued.sh
```

- Same settings as `ab.sh` — `N`, `CORE`, `A`, `OUT`, `SCEN`.
- One queue job per scenario: the queue stops a job at 1 hour.
- Rows land in `.bench/ab.csv`: tree, scenario, ns, bytes.
- `benchctl status` — what is running, how many wait.

Each job gets one core, no network, no secrets, a read-only
root, and only its own tree writable. So a benchmark cannot
reach the internet or read a token by accident.

### A plain wall-clock number

When the probe is not the point, skip `ab.sh`:

```bash
benchctl run --runs 10 -- node bench/deep.mjs
benchctl ab --a "node a.mjs" --b "node b.mjs"
```

`run` prints min, median, MAD, max, spread.
`ab` runs the two sides turn by turn, flipping the order
each round, then says one of:

- **b is faster** — the gap held up.
- **b is slower** — the gap held up.
- **no difference we can see** — it did not.

Put that verdict on the card, not a raw millisecond count.

### The bench core

- The box is one Xeon: 4 cores, 8 threads.
- CPUs 3 and 7 share one core.
- About 65 containers run on the box.
- Since 2026-10-09 the sandbox runs only on CPUs 0-2 and 4-6.
- CPUs 3 and 7 are kept for `benchd`.
- `benchd` runs each job on CPU 7, on the host.
- CPU 3 stays mostly idle.
- `bench/ab.sh` keeps its probes on the job's CPU,
  unless `CORE` is set.
- While a job runs, turbo is off.
- CPU 7 then holds 3.5 GHz.
- The job log shows `no_turbo`, `mhz_before`,
  and `mhz_after`.
- Raw ns from before 2026-10-09 ran with turbo on.
- Do not compare them with newer rows.
- Compare only A and B from the same run.

### What the queue cannot do

Some load still lands on CPUs 3 and 7:

- host agent sessions;
- `dockerd`;
- other containers.

So read the median, and believe a gap only when the
verdict does.

## Helper writers

Roles per card (user 2026-10-09: "Instead of using sol as writer, use haiku,
opus drives and review"; 16:32 UTC: "As replacement to current writer"):

- **Lead:** Claude Opus 5.5 (high). It drives: it writes the card and the
  brief, starts the writer, follows it, sends the one fix round, and lands.
- **Writer:** Claude Haiku 5.5 (`claude/claude-haiku-5-5`, thinking high,
  mode auto). Its own Paseo agent, in `../tinkered-<task>`. It writes the
  code, runs the gates, and commits. It never pushes.
- **Reviewer:** a separate Claude Opus 5.5 agent (high). Verdict: READY or
  NOT READY. One fix round, done by the same writer.
- Haiku replaces Codex Sol (`codex/gpt-6.1-sol`) one for one.

One package per writer. The writer's fixed rules:
`docs/roadmap/contributor-brief.md`.

The lead, per ticket:

1. Write the brief: the fixed part, plus the target (and the impact block,
   when there is one).
2. Review: the reviewer agent reads the diff first;
   `node tools/jev/review.mjs main..HEAD` shows where to read.
   Send the writer one fix round.
3. Land: re-run every gate by exit code. Fast-forward `main`. Run the
   package's mutation lane alone (floor 85, every package). Push.
   Run `node tools/jev/calibrate.mjs` when labels changed.
   Remove the worktree and branch.
   - Skip the mutation re-run when the writer's run counts.
     It counts when the log names the commit you land, on a clean tree,
     and clears 85 on kills alone (user 2026-10-06).
   - The floor is per package. Do not add a per-file target.
   - `@tinker/start` breaks at 75; every other package at 85 (user 2026-10-06).
4. Record Core feedback in `docs/roadmap/core-feedback.md`. A row becomes a
   core ticket at its second asker, or at once if the workaround is dishonest.

## Jev: advisory judges

Jev is a model that answers one yes/no question about one piece of code our
own code picked out. Advisory means: it points, it never blocks. What each
judge asks: `tools/jev/README.md`.

- **Writer:** run the steps in the brief. Each flag gets one label with a
  `--why`. That label is the answer.
- **Lead:** label a flag when you disagree with the writer's label.
- **At every landing that adds labels:** `node tools/jev/calibrate.mjs`, then
  commit `calibration.json` (ADR 0054).
- Never add a per-ticket rule to `tools/jev`. If plain code can check it,
  plain code does.
