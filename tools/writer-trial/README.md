# Writer trial preparation

Four models, four rounds, one growing app per model.
Only core and React from Tinker.
No scored work starts during preparation.

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
Findings remain advice; missing output is not a pass.

## Prepare

From the repo root:

```bash
vp install
vp run core#build
vp run react#build
node tools/writer-trial/prepare.mjs --models --build
node tools/writer-trial/workers.mjs create trial-01
node tools/writer-trial/workers.mjs stage trial-01 1
```

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
Provider names begin with `pi/writer-gateway/`:

- `xiaomi/mimo-v2.6-flash`
- `xiaomi/mimo-v2.6-pro`
- `zai/glm-5.3-flash`
- `deepseek/deepseek-v4.1-flash`

Use thinking `high` for all four, as in readiness checks.
Send this prompt:

> Read TASK.md and GUIDELINES.md through work_shell.
> Restate the rules briefly, then finish this round.
> Use only the current task and allowed tools.
> Run check, test, and build; use Jev on changed source and tests.
> Fix or explain findings. Report actual results, then stop.

Record the returned agent ID in the manifest.
Let Paseo report completion; do not poll running agents.
Do not send future packets or teacher test bodies.

## Limits

Teacher controls live in `config.json`.
Defaults per scored attempt:

- 45 minutes.
- 160 tool calls and 80 model turns.
- 300,000 reported tokens, including cached tokens.
- $3 estimated writer cost.
- 60 Jev requests, counted separately.
- Each shell command has at most 120 seconds.

Token and cost stops apply after completed model responses.
One response may cross the limit; these are not billing caps.
Costs use gateway catalog rates and are estimates.
Jev usage and cost are recorded as unknown by the current adapter.
Its call limit still applies.
The wall-clock stop aborts the agent and stops its container.
A stopped container keeps its `/work` volume for the next round.

Teacher can change the enabled judge IDs in `config.json`.
Freeze that file for a comparison.
Calibration and labels remain teacher-owned.

## Save and clean up

Stop writers before exporting or deleting their projects.
Keep each round's source archive and events before moving on.
Exports use a separate folder per round and refuse to overwrite it.
Staging the next round requires an export of the previous round.

```bash
node tools/writer-trial/workers.mjs export trial-01
node tools/writer-trial/workers.mjs cleanup trial-01
```

Cleanup refuses to run before export.
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

The first checks all four containers, real browser clicks,
package imports, tool versions, timeout, network isolation,
missing host files, absent keys, and the Jev path boundary.
The second proves tool blocking and stops for time and usage.
Live model probes additionally check each route through Paseo,
its shell tool, and its real Jev tool.
Readiness uses a tiny disposable file, never the app task.

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
A passing full app has not yet been checked.
