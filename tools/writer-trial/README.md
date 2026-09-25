# Writer trial

Tools to run model writers on a task, in isolation, and score them.
Writers use only core and React from Tinker.
Three suites, one repeatable flow per suite:

- **Booking** — grows over rounds 1-5.
- **Stock** — one fresh round.
- **Plan** — one fresh round with course prerequisites.

## What workers can see

- Built `@tinker/core` and `@tinker/react` packages.
- Their public type declarations.
- A blank Vite project, React, TypeScript, and Playwright.
- Rules and task packets through the current round.
- Their own code from earlier rounds.

No `examples/`, `apps/`, tracker code, source maps,
repo history, package tests, or worked examples are copied.
No teacher checks or other submissions are mounted.
The host checkout is absent from the container.
Network access is off.

Pi runs through Paseo on the host.
Its only active tools are `work_shell` and `jev`.
Other tools are blocked even if requested by name.
The worker shell runs in a container as an unprivileged user.
The image is read-only; `/work` and temporary files are writable.
The Docker socket and gateway key never enter the container.

Jev reads a chosen source file through the container.
A teacher-owned copy of the question bank judges that text.
It does not import or execute the submitted source on the host.
Findings are advice unless the gate marks them blocking.
Missing output is not a pass.

## Prepare

From the repo root:

```bash
vp install
vp run core#build
vp run react#build
node tools/writer-trial/prepare.mjs --models --build
node tools/writer-trial/workers.mjs \
  create trial-02 --suite stock
node tools/writer-trial/workers.mjs \
  stage trial-02 1
```

`create` freezes one suite into the trial:
task, full rules, tool copies, limits, and the Jev copy.
It records hashes and refuses a silent refresh.

- **Booking** — the default suite.
  Stages rounds 1-5 from frozen packets.
  Old trials without frozen files still stage rounds 1-4.
- **Stock** — needs `--suite stock`.
  Stage 1 loads `stock/01-stock-moves.md`.
- **Plan** — needs `--suite plan`.
  Stage 1 loads `plan/01-learning-plan.md`.
- **Loans** — needs `--suite loans`.
  Stage 1 loads `loans/01-tool-library.md`.
- **Ballot** — needs `--suite ballot`.
  Stage 1 loads `ballot/01-team-poll.md`.
- **Kitchen** — needs `--suite kitchen`.
  Stage 1 loads `kitchen/01-kitchen-queue.md`.
- **Locker** — needs `--suite locker`.
  Stage 1 loads `locker/01-parcel-locker.md`.
- **Cinema** — needs `--suite cinema`.
  Stage 1 loads `cinema/01-seat-map.md`.

The first command that registers models adds only the
`writer-gateway` provider to Pi's model file.
It uses a command to read the existing token file at request time.
No token value is saved in this repo or the worker setup.

The image installs tools beneath `/home/pwuser/toolchain`.
The host keeps setup and results beneath
`~/.local/share/tinker-writer-trial/`.
Each trial manifest records its exact image ID and source commit.
Keep the same image for all rounds and writers.
Do not rebuild halfway through a comparison.

Creation adds four Paseo projects and workspaces.
It trusts only their teacher-owned extension folders in Pi.
Workers cannot write those host folders through their tools.
Staging copies only the current and earlier packets.
Neither command starts an agent.

## Launch through Paseo

Use the workspace IDs in the trial's `manifest.json`.
Start one fresh agent per model per round.
The writer is `pi/writer-gateway/deepseek/deepseek-v4.1-flash`
(`models` in `config.json`). MiMo Flash, MiMo Pro, and GLM Flash
ran in trials up to locker-01; they were dropped for cost on
2026-09-25.

Use thinking `high`, as in readiness checks.
Send this prompt:

> Read TASK.md and GUIDELINES.md through work_shell.
> Restate the rules briefly, then finish this round.
> Use only the current task and allowed tools.
> Run check, test, and build; use Jev on changed source and tests.
> Fix every finding under gate.blocking before you report done.
> Fix or explain other findings. Report actual results, then stop.

Record the returned agent ID in the manifest.
Let Paseo report completion; do not poll running agents.
Do not send future packets or teacher test bodies.

## Limits

Teacher controls live in `config.json`.
`limits.disabled` is now `true`: trial stops are off,
because the user asked to finish testing before comparing budgets.
The stored thresholds below apply only when it is `false`:

- 45 minutes.
- 160 tool calls and 80 model turns.
- 300,000 reported tokens, including cached tokens.
- $3 estimated writer cost.
- 60 Jev requests, counted separately.
- Each shell command has at most 120 seconds.

When enabled:

- Token and cost stops apply after completed model responses.
  One response may cross the limit; these are not billing caps.
- The wall-clock stop aborts the agent and stops its container.
  A stopped container keeps its `/work` volume for the next round.

Costs use gateway catalog rates and are estimates.
The current adapter records Jev usage and cost as unknown.
Its call limit still applies.

Teacher can change the enabled judge IDs in `config.json`.
Record any change to that file as a new trial phase.
Response and context allowances use the live gateway model catalog.
A provider can still cut off a response; resume unfinished work
rather than counting that cutoff as a completed attempt.
Calibration and labels remain teacher-owned.

## Save, check, and retry

No command here launches a model.
Launch stays through Paseo tools.
The finish callback names the saved files.

```bash
node tools/writer-trial/review.mjs save trial-02 1 1 \
  --session <pi-session.jsonl> --report <report.md>
node tools/writer-trial/review.mjs check trial-02 1 1
node tools/writer-trial/review.mjs feedback trial-02 1 1 \
  --teacher <teacher-notes.md>
```

- **`save`** — stops the container, then saves one attempt:
  source archive, native session copy, report copy,
  event copy, and per-file hashes. It refuses overwrite.
- **`check`** — runs the worker's own check, test, and build
  in a fresh pinned container, then the suite checker
  in a second one, then the Jev gate on the saved files.
  It writes named `check-N` folders with
  checker hashes and the image ID beside exit codes.
  Repeats never reuse a folder.
- **`feedback`** — copies only teacher text, restages frozen
  task, rules, tools, and limits, and starts a fresh
  event log. Saved tries are kept.

Machine pass or fail is recorded apart from lead review.
Lead review stays pending until the lead sets it.
A missing checker fails unavailable, never passes.
The Jev gate reads `src/` and `tests/` from the archive
with the frozen Jev copy; it never runs them.
A shape finding or a hit on a `proven` judge blocks.
Other hits are advice. An unavailable gate fails.
`machine-pass` needs own, teacher, and gate to pass.
Trials without `frozen/` record `jev: not-frozen`.

## Clean up

Stop writers before exporting or deleting their projects.
Keep each round's source archive and events before moving on.
Exports use a separate folder per round and refuse to overwrite it.
Staging the next round requires an export of the previous round.

```bash
node tools/writer-trial/workers.mjs export trial-01
node tools/writer-trial/workers.mjs cleanup trial-01
```

Cleanup refuses to run before export.
For frozen trials it also needs every worker's
current attempt saved through `review.mjs save`.
It archives each workspace, deletes its Paseo project,
removes its container and named volume, removes its trust entry,
and deletes only its recorded worker folder.
Results stay outside those folders.
The shared image and model routes stay ready for later trials.

## Readiness checks

Create a fresh trial for checks, then run:

```bash
node tools/writer-trial/workers.mjs create readiness-02
export TRIAL_NAME=readiness-02
node tools/writer-trial/readiness.mjs
node --test tools/writer-trial/limits-check.mjs
```

- `readiness.mjs` checks all four containers, real browser clicks,
  package imports, tool versions, timeout, network isolation,
  missing host files, absent keys, and the Jev path boundary.
- `limits-check.mjs` proves tool blocking and stops for time and usage.

Live model probes also check each route through Paseo,
its shell tool, and its real Jev tool.
Readiness uses a tiny disposable file, never the app task.

## Which checker runs

- Booking 1-3: `evaluate.mjs <archive> <round> <image>`.
- Booking 4: `acceptance.mjs <archive> repair <image>`.
- Booking 5: `acceptance.mjs <archive> transfer <image>`.
- Stock 1: `stock-acceptance.mjs <archive> <image>`.
- Plan 1: `plan-acceptance.mjs <archive> <image>`.

Own check, test, and build always run apart.
Submitted code runs in Docker only.

## Teacher checks

Export the round first. Keep writers stopped while exporting.
Run `evaluate.mjs` with the archive path, round number,
and image ID from the trial manifest.
For example, with those values in shell variables:

```bash
node tools/writer-trial/evaluate.mjs \
  "$snapshot" 1 "$image_id"
```

It creates a separate container with no network or host mounts.
It restores the archive and adds the private teacher checks there.
Core checks run first, then real browser checks.
The container is removed on success or failure.
Never run submitted code through `teacher/check.mjs` on the host.

Checks stop at the first failure.
Later checks are not run; do not count them as failures or passes.
These checks sample the task rules; they do not cover every rule.
The empty starter was rejected by the isolated runner.
Accepted learning apps pass repair 29/29 and transfer 43/43.
