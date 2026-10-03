# Writer trial

Tools to run model writers on a task, in isolation, and score them.
Writers use only core and React from Tinker.
Suites share one repeatable flow:

- **Booking** — grows over rounds 1-5.
- **Stock** — one fresh round.
- **Plan** — one fresh round with course prerequisites.
- **Flight** — Start scaffold and real local services, rounds 1-5.

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
Network access is off for the blank project suites.
Flight has private local networks with no default route.
Their bridges have no host IPv4 address.
The isolation proof checks the first address in the writer subnet:
ports 2377, 7946, 5355, 22, and 80 must refuse connections.
It also checks that `172.17.0.1:80` refuses a connection.

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
The frozen Jev owns copies of its installed packages and their dependencies.
Package links stay inside the frozen Jev folder.
Create imports its `lib.mjs` in a fresh process before saving the manifest.
Check repeats that import before starting any check containers.
A failed import is unavailable, never a pass.

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
- **Gym** — needs `--suite gym`.
  Stage 1 loads `gym/01-class-waitlist.md`.

The first command that registers models adds only the
`writer-gateway` provider to Pi's model file.
It uses a command to read the existing token file at request time.
No token value is saved in this repo or the worker setup.

The image installs tools beneath `/home/pwuser/toolchain`.
Its `node_modules` is read-only, so Vite's cache folders
(`node_modules/.vite`, `.vite-temp`) link to `/tmp`.
A writer can run `npm run dev` or add a `vite.config.ts`.
The host keeps setup and results beneath
`~/.local/share/tinker-writer-trial/`.
Each trial manifest records its exact image ID and source commit.
Keep the same image for all rounds and writers.
The host deletes images no container uses, so one idle
container keeps the trial image:

```bash
docker run -d --name tinker-writer-trial-keep \
  --restart unless-stopped --network none \
  --read-only --memory 64m \
  tinker-writer-trial:20260925.1
```

A copy sits in
`~/.local/share/tinker-writer-trial/image-20260925.1/`
(`image.tar.gz`); `docker load` restores the same ID.
Do not rebuild halfway through a comparison.

Create adds a Paseo project and workspace for each configured model.
It trusts only their teacher-owned extension folders in Pi.
Workers cannot write those host folders through their tools.
Staging copies only the current and earlier packets.
Neither command starts an agent.

## Flight setup

Flight uses its own image; the other suites keep their image.
Build the workspace before preparing it:

```bash
./node_modules/.bin/vp run -r build
runner=tools/writer-trial
node "$runner/prepare.mjs" --suite flight --build
node "$runner/workers.mjs" create flight-01 --suite flight
node "$runner/workers.mjs" stage flight-01 1
```

Flight pins Playwright 1.63.0, as the reference proof does.
Other suites keep Playwright 1.55.0.
The browser uses `flight-app`.
Chromium tried HTTPS for the host name `app` in the proof.
The image reads the Start registry's starter and its required items.
It copies their files, tests, all five skills, and `AGENTS.md`.
It uses the default `@/lib` alias.
Core and React are packed tarballs, with no workspace links.
Generated router files and frozen `TASK.md` are ignored by formatting.
The image and stage write `.prettierignore`.
Vite+ reads this file when the scaffold's Vite config owns formatting.
The image's seam script has its own read-only package link.
Flight runs one Vitest worker at a time to fit the memory limit.
Each new tag saves its build folder and `image.tar`.
Keeper containers hold the app, services, Postgres, and Mailpit images.
Create also keeps the dependency images for older saved app images.
Keepers use no network and survive trial cleanup.
A saved tag refuses rebuild; choose a new tag in `config.json`.
The manifest pins app, services, Postgres, and Mailpit image IDs.

Each worker has its own Postgres, Mailpit, and four service processes.
Its app network and the teacher's control network are private.
Mailpit enables its Chaos API for the round 5 teacher's send-failure proof.
The default send failure chance stays zero.
A filter exposes only `/air/` and `/v1/` service routes.
Control paths return HTTP 403, even with a token.
Service containers have no address on the writer's network.
Payment sends signed callbacks to `/webhooks/stripe` through the filter.
The writer gets service URLs and app settings in `.env`.
It never gets the control token or teacher files.
No ports are published on the host.

`check` makes fresh services and runs the app from the saved archive.
It runs build first to create the Start router's generated file.
Then it runs the writer's check, test, and build.
Teacher checks run in a separate container on both networks.
The scaffold gate also runs the image's `check:plain` on `/work`.
It uses the trusted package and script, not the writer's copy.
Missing `check:plain` fails as unavailable and earns no score.
An available script's findings block the gate.
Saved images keep their bytes; add the script with a new image tag.
The app has only its own network.
All check containers and networks are removed after the run.
`scaffold.log` names the hash and seam results.

The flight gate blocks changed, missing, added, or linked scaffold files.
It runs the image's seam script, not the writer's copy.
Exact starter source bytes are teacher-owned baseline files.
They are read and named in `jev.json`, without asking Jev again.
The generated `src/routeTree.gen.ts` is also named there
when its saved bytes match the router made by the fresh build.
Changed source and tests use the same frozen Jev gate as other suites.
The untouched registry has S17 and S24 findings under that gate;
this baseline rule lets the required starter pass without editing it.

Packets come from `flight/`; checks come from `teacher/flight/`.
Round 1 must exist before create.
Missing later packets are not frozen or staged.
A missing teacher round fails unavailable and earns no score.
Create a fresh trial after new packets land.
Before the branches merge, `create --packet-dir` can read a saved
flight packet folder; its files are frozen and hashed as usual.

Teacher commands use `teacher/flight/check.mjs` with the round number.
The grader alone gets these settings:

```text
APP_URL=http://flight-app:4318
SUPPLIER_A_URL=http://control-supplier-a:4310
SUPPLIER_B_URL=http://control-supplier-b:4310
SUPPLIER_C_URL=http://control-supplier-c:4310
PAYMENT_URL=http://control-payment:4310
MAILPIT_URL=http://control-mailpit:8025
```

`CONTROL_TOKEN` is a new random token for each run.
These teacher URLs serve both service and control paths.
The app gets different URLs through the filter.
Holds last 60 seconds unless the teacher moves the service clock.
`FLIGHT_CHECK_SETTINGS` also holds the round and all URLs as JSON.
Teacher files come only from the repo's `teacher/flight/` folder.
Create freezes their file hashes and one hash for the full set.
A changed, added, missing, or unpinned teacher makes a check unavailable.
The grader receives the same bytes that passed the hash check.
The hash for all teacher files is saved beside each reference result.
The teacher's `grader.env` has the app's WEBHOOK_SECRET.
Creation freezes `flight-services.md` and copies it as `SERVICES.md`.

Rebuild services after a service change with:

```bash
node tools/writer-trial/flight-services-image.mjs
```

This builds Core, packs current service dependencies, and saves a new image.
It keeps the image in an idle container and saves its tar.
It updates only the services tag in `config.json` after success.

After a services rebuild, run one full reference pass per round:

```bash
runner=tools/writer-trial/harness/run-reference.mjs
proof=tools/writer-trial/.logs/reference-services
node "$runner" "$proof" --once
```

This checks rounds 1 to 5 and skips planted breaks.
Without `--once`, each round passes twice and runs its named break.
Each proof needs a fresh folder; saved results are never overwritten.

Flight permits native HTTP clients, including `fetch`.
Its Jev gate omits S24, which requires the old copied HTTP helper.
That helper is absent from the Start registry.
The same rule applies to writer advice and saved checks.
The other suites keep S24.

The teacher command must exit nonzero when any check fails.
The app is already built and running when the command starts.
The worker image includes Playwright and its browser.
The harness never launches the model; launch stays through Paseo.

Flight writes `score.json` after save, check, and feedback.
It also keeps each worker's score in the manifest.
The first failed round stays failed after retries.
The baseline is the count of passed rounds before that failure.
Missing teacher rounds, network setup failures, and old placeholders
have no score.
A model run with a saved agent ID stops staging after a failure.
Its current round must pass before it can stage the next one.
`stage <trial> <round> --explore` lets a stopped model go on
once the latest try of every earlier round passed.
It marks the worker `explore` and never changes the score:
the first failure stays the baseline.
Teacher reference proofs have no agent ID and may test later stages.
Their score record says `modelRun: false`.
They are not a model baseline.

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

## Gate a repo folder

The same Jev gate runs over any folder, such as an app:

```bash
node tools/writer-trial/app-gate.mjs \
  apps/issue-tracker --json /tmp/gate.json
```

- It reads `src/` and `tests/` `.ts(x)` files; it never runs them.
- It uses the repo's live `tools/jev` calibration and bank,
  not a trial's frozen copy.
- The judges are the ones `config.json` names.
- Plain rules run in writer mode: S17-S19 and S25 are on,
  S20 and S22-S24 read the whole file;
  S21 reads unit bodies only.
- It prints, per file, blocking items, then advice,
  then every unavailable check.
- `--json` writes the full report.
- Exit 0: nothing blocks. 1: something blocks.
  2: a check is unavailable, or the call is wrong.

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
  package imports, tool versions, writable Vite cache folders,
  timeout, network isolation,
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

## Saved answer and check promises

The harness also promises these checked rules.
S17 names the plain rule for type assertions.
T08 names the test rule for error checks inside assertions.

- gives the teacher the writer's answer for the same file bytes.
- keeps the writer's last answer for the same bytes.
- never reuses a report with a unit Jev did not judge.
- skips lines that are not complete Jev events.
- cleanup waits for the pending retry save on the active round.
- claims once, fails busy, releases.
- is unavailable with exit 2 for a link that leaves the folder.
- is unavailable with exit 2 when the folder has nothing to judge.
- passes a proven judge answer below its threshold.
- is unavailable when a file could not be judged.
- lets one unavailable file outrank a blocking file.
- is unavailable when no file was judged.
- names the first line of the unit a Jev hit is on.
- tells the writer how to clear a plain rule break with its message.
- blocks on a type assertion in writer source (S17).
- blocks on isError inside expect in a test file (T08).
- sends each test as title, causes, asserts, narrows, and body.
- uses the median of three asks for a proven judge within the margin.
- covers every reference app there is.
- keeps booking clauses out of the default rules.
- stages the frozen gate beside the broker so the worker broker loads.
- refuses create without a real first flight packet.
- gives nothing once the file bytes changed.
- blocks on a shape finding with exit 1 and names its rule, line, and fix.
- passes a clean folder with exit 0.
- tells the writer how to clear a blocking Jev hit with the judge's fix line.
- frozen Jev still loads after deleting the source checkout and its package link.
- frozen Jev loads after deleting an owned source copy of its packages.
- create refuses an unavailable frozen Jev before publishing a trial.
- check refuses unavailable Jev before running own or teacher containers.
