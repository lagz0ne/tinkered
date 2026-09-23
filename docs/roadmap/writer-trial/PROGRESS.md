# Writer trial

Run log for the writer trials: models build apps with only core and React.
Status: trial-01, learn-01, stock-01, and plan-01 are done.
Owner: Codex. Scope settled: core and React only.
This file keeps the setup design and dated evidence; results live below.

## Where each result lives

- **trial-01** — four rounds on one growing booking app.
  [Comparison and saved proof](REPORT.md).
- **trial-01 code review** — bugs and state-rule gaps.
  [Code review and proof](CODE-REVIEW.md).
- **learn-01** — repair plus a fresh feature.
  [Learning stages and acceptance](LEARNING.md).
- **stock-01** — a fresh stock-transfer task.
  [Results and limits](REPEAT.md).
- **plan-01** — a learning plan with course prerequisites.
  [Same questions, new task](PLAN.md).
- **Tools and commands** —
  [tools/writer-trial](../../../tools/writer-trial/README.md).

## What we checked

- Base commit: `50ae1294a484fc796834467fdd9309c31e8b9479`.
- `vp install`: exit 0; dependencies already present.
- Read Jev tools, the live question bank, and tracker code.
- Jev findings are advice, not proof that work passes.
- `lint` and `tests` accept explicit file paths.
- `promises` and `survivors` expect `packages/<name>`.
- `preflight` calls `tools/jev/lint.mjs` from the current folder.
- Some comments describe retired questions.
  Use the live bank and `explain.mjs` for the active set.
- The tracker covers saved edits, stale writes, live state,
  HTTP, CLI, MCP, and an optional draft helper.
- Paseo reports Pi available; no saved launch profiles exist.
- All four requested routes appear in the live Vercel model list
  (`https://ai-gateway.vercel.sh/v1/models`).
  Preparation added them to Pi's model settings.
- All four routes pass real calls through Paseo and Pi,
  and use the worker shell and real Jev tool.
- The requested token file exists and is nonempty.
  Its contents were not printed or copied.

## Design (set before trial 01)

### Task

Precedent: [SlopCodeBench](https://github.com/SprocketLab/slop-code-bench),
where a writer extends its earlier code as requirements change.
The user asked for repo growth over at least three to four attempts.
Settled: four attempts per writer on its own growing app,
a saved result after each; not four fresh app builds.

We borrow its staged tasks and checks of earlier behavior.
Ours is smaller: core and React, with no server.
Our task details and scoring are local choices,
not claims about SlopCodeBench's exact rules.

A room-booking screen using only `@tinker/core`
and `@tinker/react` (scope set by the user on 2026-09-22):

- Book a room, list bookings, cancel, and reject clashes.
- Two requests for the same slot must not both succeed.
- Adjacent bookings are allowed; invalid time ranges fail.
- UTC times and fixed rooms keep the first task small.
- Bookings live in local state; reload starts fresh.
- No server, database, HTTP, CLI, MCP, or model helper.
- React reads cells and runs operations; core owns the rules.
- Final checks cover core behavior and real browser clicks.

### Teacher controls

- Freeze all four task packets, rules, package versions, and checks.
- Reveal only the current task and earlier requirements to the writer.
- Choose which Jev tools and questions each run can use.
- Freeze question wording and calibration for each comparison.
- Set time, spend, tool-call, and feedback limits before launch.
- Keep the final tests and other writers' answers private.
- Score behavior, rule following, time, cost, and follow-up count.
- Count Jev cost and calls separately from writer cost and calls.
- Keep provider failures separate from failed app behavior.

### Writer loop

- Read the task and restate its rules with a small example.
- Build with supplied public types and task rules.
- Run plain checks and the allowed Jev tools.
- Fix each finding or give a short reason to leave it.
- Submit when public checks pass and findings are addressed.
- Stop and report a blocker when the run limit is reached.
- Missing credentials or failed checks are not clean results.
- Do not use Jev's exit code alone to declare success.

### Four attempts on the same repo

```text
1. Book and cancel
        ↓
2. Edit with save/discard
        ↓
3. Book a repeating series
        ↓
4. Undo changes
```

Each model gets its own project, starter, and Git history.
Its next attempt starts from its own last submitted code, defects included;
never another writer's answer, never a reset after a poor score.
All four get the same task sequence: four models times four attempts
gives 16 scored results — four histories, not 16 independent trials.

1. **Book and cancel.** The base task below.
   Observe state ownership, booking rules, and React reads.
2. **Edit a booking.** Open a draft; save or discard it.
   Unsaved edits must not change the list.
   A failed save preserves both the saved booking and the draft.
   Clash checks exclude the booking being edited.
3. **Book a series.** Add dates and weekly repeats.
   Create all requested dates, or none if any date clashes.
   Allow canceling one occurrence or its whole series.
   Earlier single-booking behavior must remain valid.
4. **Undo.** Undo the last successful booking change.
   A series change is one undo step.
   Failed actions and filter changes add no undo step.
   Undo restores booking data, not the current form or filter.

Before launch, each packet defines its exact inputs,
button names, errors, and the behavior of each new action.
Later packets may extend prior rules explicitly.
For example, step 3 replaces the fixed day with a chosen date;
its old tests still run using the original date.
No later requirement is scored before it has been revealed.

### Fair comparison

- Keep code and history across attempts.
- Default: a fresh Pi session per attempt through Paseo, with its own repo,
  current task, earlier rules, and allowed docs.
  The saved repo carries the earlier design forward.
- Same session rule for all four writers; record any restart or missing context.
- Same self-check tools and per-attempt limits for each writer.
- Teacher checks score the submitted snapshot before the next step.
- No unseen test bodies or model-specific repair patch.
- Within an attempt, the writer can use Jev to fix issues early.
- A submission or the run limit ends the attempt; Jev alone cannot.

Teacher feedback is fixed for the first comparison:
public check results and Jev findings are visible;
unseen test results are saved for the teacher through step 4.
Later teaching trials may add feedback, with that change recorded.
This improves the working process; it does not change model weights.

The teacher may add or remove tools between trial versions.
For a fair comparison, freeze the tool set across the four steps
and all four writers in one version.
If a tool must change mid-trial, record the boundary and do not
attribute the later score change to the writer alone.
Keep the teacher's scoring checks fixed even if writer tools vary.

One four-step history per model is a pilot, not a reliable ranking.
Repeat full histories before claiming one writer is better.
A future no-Jev comparison must start from the same starter,
not a repo already improved with Jev.

### What to save after each attempt

- The exact task, rules, tool set, and model route.
- Paseo project, workspace, and agent IDs; session settings.
- Parent commit, submitted commit, and diff.
- New behavior passed out of new checks run.
- Earlier behavior passed out of earlier checks run.
- Earlier passing checks that now fail: regressions.
- Earlier failing checks that now pass: repairs.
- Build, type, and browser results, including checks not run.
- Source and test lines, files, and lines added or removed.
- Duplicated code and branching counts, using fixed tools.
- Jev findings by question ID and status, with units scanned.
- Teacher-confirmed findings separate from raw Jev output.
- Writer and Jev tokens, calls, cost, and elapsed time separately.
- Follow-ups, restarts, errors, and the reason the writer stopped.

Rules for reading them:

- Show a four-point history per model, not just its final score.
- Compare the same step across models.
- Code growth is evidence to inspect, not an automatic penalty.
- Keep source, tests, generated files, and dependencies separate.
- Never add unlike Jev probabilities into one quality score.
- Record missing cost or skipped checks as unknown, not zero.
- Save timed-out or broken submissions too; continue from them
  when another attempt can run.
- Record setup/provider failures apart from app failures;
  never silently substitute a model.

Requested models, all through Pi and Vercel Gateway:

- `xiaomi/mimo-v2.6-flash`
- `xiaomi/mimo-v2.6-pro`
- `zai/glm-5.3-flash`
- `deepseek/deepseek-v4.1-flash`

### Access and launch

Paseo creates, launches, stops, and archives each run.
Each writer starts with a fresh project holding the starter
and allowed docs, kept across its four attempts.
No tracker, repo history, or other submissions are copied.
A separate folder is not an access boundary on this host.
Before calling a run isolated, prove its tools cannot read
outside the allowed files or fetch the existing example.
Final tests stay outside the writer's allowed files.

Pi custom model entries and the worker extension are proven.
All four gateway routes, tool restrictions, stop limits, and
Jev outside this repo passed readiness checks.
Only the named gateway provider and scoped trust entries were added.
Trust entries were removed with the temporary projects.

### Results and cleanup

Save the task version, allowed tools, model route, session IDs,
submission, checks, feedback, usage, and stop reason first.
Never save credentials with results.
Record every temporary project ID, workspace ID, and folder.
Save a snapshot after every attempt; keep the project for the next.
After the four attempts, or when the whole run is stopped:

1. Stop the writer and its child processes.
2. Save results outside the temporary project.
3. Archive its workspace through Paseo.
4. Delete its project from Paseo's registry.
5. Remove only its recorded temporary folder.
6. Check that the workspace, project, and folder are gone.

Paseo project deletion leaves the project folder on disk.
Workspace removal alone leaves the project registered.

### Writer task: attempt 1

A room-booking screen for one day: 2026-10-01 UTC.
Rooms Cedar and Maple, each with its own bookings.
Start with no bookings.

- Enter a title, room, start time, and end time.
- Use minute precision, from 00:00 through 23:59.
- Trim the title; reject a blank title.
- Reject an unknown room, invalid time, or end before start.
- Reject equal start and end times.
- Reject any overlap in the same room.
- Allow overlap in different rooms.
- Allow one booking to start when another ends.
- List bookings by start time, then by creation order.
- Cancel by booking ID; a second cancel reports not found.
- A failed action leaves saved bookings unchanged.
- Two calls for one empty slot create exactly one booking.
- Keep the form values after a failed booking.
- After success, clear the title and show the saved booking.
- A cancel removes the row and frees its slot.
- Filter by room without deleting hidden bookings.
- Show errors beside the form with an accessible alert.
- Give inputs visible labels and buttons clear names.
- Separate mounted app roots must not share booking state.

Core owns saved state and the booking operations.
React reads state and runs actions through `@tinker/react`.
No other state library or Tinker package.
Use the supplied coding rules and public package exports.
Do not change supplied checks or their configuration.
Write tests that prove what a caller or person can observe.

The teacher supplies the starter entry names before launch.
That freezes how final tests call the app without prescribing
its private functions or component tree.

### First tool set

- Writer: Jev file checks, core unit checks, React checks,
  and test-title checks; plain build, type, and behavior checks.
- Teacher: the same checks, diff review, and unseen tests.
- Calibration and label writes stay teacher-owned.
- Mutation and README matching stay out of the first round.
- Save the enabled question IDs with every run.
- Missing Jev output is recorded as unavailable, never clean.

### Setup left at that point

- Run the prepared teacher checks against the first real submission.
- Record later checks as not run when an earlier check fails.
- Apply the proven equal limits to each scored attempt.
- Keep the proven file boundary when staging the task.
- Export every round before advancing, then use the tested cleanup.

No scored attempt had run yet.

## Log

### Preparation proof: 2026-09-22

Results stay outside worker projects in
`~/.local/share/tinker-writer-trial/readiness/`.

- `model-readiness.json`: all four model routes, shell, and Jev pass.
- `readiness-checks.json`: 32 checks pass across four containers.
- `node --test tools/writer-trial/limits-check.mjs`: 4 tests pass.
  Tool blocking, inherited context removal, tool limit,
  token limit, and wall-clock stop are covered.
- Real Chromium opened a page and clicked a button in every container.
- Core and React imports and public declarations are readable.
- Host files, credentials, source maps, and repo examples are absent.
- Network access fails; shell commands time out.
- Four successful agent IDs and usage are saved in the model report.
- Each worker has the same `high` thinking setting and tool set.
- Initial MiMo and GLM calls hit Vercel's model allowlist.
  The user enabled them; fresh calls passed.
- Pi initially skipped untrusted project extensions.
  Trust was scoped to the four teacher-owned folders; retries passed.
- `vp run core#test`: 385 tests pass.
- `vp run react#test`: 69 browser tests pass.
- `vp check`: exit 0, warnings remain elsewhere in the repo.
- Root `vp test`: exit 1; 767 passed, 37 failed, 1 skipped.
  Failures include missing playground aliases, React browser setup,
  and timeouts in tracker and database tests.
  These suites are outside the worker setup; no fixes made there.

All example-land is excluded, as the user required.
Workers get no package README tours or worked sample app,
only the public declarations, built libraries, and task rules.
The teacher's frozen Jev copy stays outside the worker container.
Jev receives source text, never host execution of worker code.

Writer budgets stop after a completed response crosses the token
or estimated-cost limit; one response may exceed that threshold.
Jev's current adapter reports calls but no usage or cost;
those fields stay unknown, not zero.

Cleanup proof: all four readiness projects, workspaces, containers,
volumes, and worker folders are gone.
`cleanup-proof.json` records each check; results and archives remain.

SCIP review: `scripts/scip.sh index` rebuilt all package indexes.
No existing public symbol changed in this preparation.
`scripts/scip.sh refs 'createScope\(\)\.$' core`
locates the scope entry at `packages/core/src/index.ts:3199`.
Its references remain in the existing core tests.

### Final preparation review

- Four task packets and core checks are saved.
- The teacher also has browser checks for all four rounds.
- Round 2 no longer exposes the date field from round 3.
- No scored app code was written during preparation.

`evaluate.mjs` restores a saved archive in a separate container
and loads teacher checks there, with no host mounts or network.
A blank readiness archive failed on the missing `src/index.ts`,
as expected; the container was removed after that failure.
Evidence: `teacher-empty-check.log` in the saved results folder.
This proves setup and rejection, not a passing app.
The checks stop at the first failure and sample the stated rules.

Contributor commit `a1448bb` is saved as a patch in the results.
Its files are copied here with the review fixes.
The helper workspace, worktree, and branch are removed;
its shared parent project remains.
The worker projects were separate and are all removed.
Preparation was done; the four-round trial stayed Ready.

### Trial 01 launch: 2026-09-22

On the user's go, all four writers start
with the prepared image and high thinking.
Four new projects keep separate repos across four rounds.
The task packets, tools, limits, and teacher checks are frozen
in `~/.local/share/tinker-writer-trial/trial-01/frozen/`.
The host project note points at the current task,
so its old readiness-only note cannot conflict with scored work.

Plan for the run:

- Paseo reports each completion.
- Save all four submissions before revealing the next packet.
- Run private checks in separate containers.
- Keep failed code for the next round; send no private test bodies.
- After round 4, save the growth report and remove all four
  projects, workspaces, containers, volumes, and worker folders.

Round 1 agent IDs:

- `xiaomi/mimo-v2.6-flash`: `6613fef8-60a5-4b42-8563-99f6821b7956`.
- `xiaomi/mimo-v2.6-pro`: `a1da6706-65b1-4b22-acdc-c404bd7fd5e3`.
- `zai/glm-5.3-flash`: `7ffdec47-e803-43e6-b5f7-6f0e288016d1`.
- `deepseek/deepseek-v4.1-flash`: `ec178b7d-74f7-4209-b08f-f56269a5853c`.

All 32 checks passed again on these fresh containers before launch.

### Round 1 results

- GLM hit the shared 300,000-token attempt limit.
  Its snapshot passes the sampled core and browser checks.
- DeepSeek reached the 16,384-token response cap while thinking.
  It wrote no app files. The core loader rejects the empty app.
- Both MiMo models reached the response cap before writing app files.
  MiMo Flash also crossed the attempt token limit.

The first GLM browser check hit Vite's stale dependency cache.
A separate cache for each teacher server and early loading of
supplied packages fixed the runner; the same GLM snapshot passed.
No app code or check rules changed. The original failure log is kept.
The saved `teacher-v2` runner is used for all writers and rounds.
The exact change and file hashes are in `teacher-v2-change.json`.

Round 1 is fully saved in `trial-01/results/round-1/`,
all four snapshots checked with the corrected teacher runner.
GLM passes both sampled groups; the other three have no app entry,
so their browser checks were not run. No writer reached a Jev call.
All four have zero test lines. These are limited pilot results,
not evidence of a reliable model ranking.
[Round 1 data](trial-01-round-1.json).

Round 2 adds draft editing with save and discard.
Each fresh session gets its own earlier code and both task packets.
Limits, model settings, and worker tools stay the same.

Round 2 agent IDs:

- `xiaomi/mimo-v2.6-flash`: `1f1a74a6-6468-4faf-9bb4-cbd00c8dae29`.
- `xiaomi/mimo-v2.6-pro`: `09062190-4ae5-493d-b0dd-5d5b770f8102`.
- `zai/glm-5.3-flash`: `db69948e-0c9f-41d9-9718-db3633b907fb`.
- `deepseek/deepseek-v4.1-flash`: `9233b769-9ec6-4d1b-bc74-90be7e15549e`.

### Round 2 capped results

DeepSeek and GLM both reached the attempt token limit.
Both snapshots and session records are saved.

- DeepSeek still has no app files; its core entry is missing.
- GLM passes the sampled core and browser checks for rounds 1 and 2.
  Source grew from 342 to 558 lines; tests from 0 to 330 lines.
  Line counts describe growth; they are not quality scores.

The two MiMo writers had not yet sent completion notices.

### User change: finish testing before budget comparison

The user asked us to stop worrying about our caps.

- Trial stops for time, tokens, estimated cost, turns,
  tool calls, and Jev calls are disabled.
- File access and shell timeouts stay.
- Each route's gateway response and context allowances apply.
- Capped phase results stay separate; no model ranking from them.

Round 2 capped snapshots were saved before this change.
The teacher stopped MiMo Pro to switch settings;
that stop is not a model failure.
All four resume on their own round-2 code in fresh sessions:
write small steps, run checks, use Jev, and fix failures.
If a response is cut short, continue the same task.
Teacher feedback may now help get the app tested.
Future packets stay hidden until this round is checked.

Five budget/tool checks pass, including work beyond disabled thresholds.

Round 2 resumed agent IDs:

- `xiaomi/mimo-v2.6-flash`: `b6854bb7-486f-4c24-b695-646279a6d714`.
- `xiaomi/mimo-v2.6-pro`: `64462225-78fd-4659-83cf-b13a13fa1a79`.
- `zai/glm-5.3-flash`: `97d7cd24-53ad-4f96-8fff-f76df8379db1`.
- `deepseek/deepseek-v4.1-flash`: `9c942f93-9636-4974-8f05-d8bd5d8729dd`.

### Round 2 uncapped results

Each passes the teacher's sampled core and browser checks
for rounds 1 and 2. No teacher repair was needed.

- **DeepSeek** — completed rounds 1 and 2 on its own saved repo.
  Its logs: type checks, 34 tests, and a build pass.
  Six Jev tool calls; it fixed a module-level ID counter.
  Source: 662 lines. Tests: 798 lines.
  [Saved result](trial-01-round-2-deepseek.json).
- **GLM** — completed round 2 with its earlier booking work intact.
  A separate container reran the public commands without pipes:
  type check, 22 core tests, build, and 4 browser tests all exit 0.
  Jev four times; it changed two test titles.
  Source: 558 lines. Tests and test setup: 500 lines.
  [Saved result](trial-01-round-2-glm.json).
- **MiMo Flash** — completed rounds 1 and 2; Jev twelve times.
  Its logs: type checks, build, and 37 tests pass
  (28 core tests and 9 real browser tests).
  Source: 637 lines. Tests: 665 lines.
  [Saved result](trial-01-round-2-mimo-flash.json).
- **MiMo Pro** — a separate container reran its type check,
  37 tests, and build: all exit 0. Fourteen Jev tool calls.
  Source: 653 lines. Tests and test setup: 853 lines.

All four checked snapshots are saved in
`trial-01/results/round-2-completion/`.
Their source and test hashes match the checked snapshots.
[All four results](trial-01-round-2-all.json).

Round 3 adds dates, weekly series, and series cancellation.
Each writer keeps its own code. Trial budget stops stay off.
The same teacher checks also check earlier rounds.

Round 3 agent IDs:

- `xiaomi/mimo-v2.6-flash`: `32207145-c7d8-434d-b177-a564e61a88b9`.
- `xiaomi/mimo-v2.6-pro`: `394002e9-b627-453e-a980-88ad4fdfa465`.
- `zai/glm-5.3-flash`: `f77d7642-6118-4667-a86f-66ba096e9608`.
- `deepseek/deepseek-v4.1-flash`: `a60e42a3-de4f-4d23-a057-941d080d3797`.

### Round 3 results

Each passes the teacher's sampled core and browser checks
for all three rounds. Its direct public checks also exit 0.

- **DeepSeek** — checks include all-or-none series booking
  and canceling one or every occurrence.
  Type check, 50 tests, and build, in a separate container.
  Jev five times; it explained a pure-helper finding.
  Source 662 → 885 lines; tests 798 → 1,234 lines.
  [Saved result](trial-01-round-3-deepseek.json).
- **GLM** — earlier checks stay green.
  Type check, 38 core tests, build, and 7 real browser tests.
  Jev four times; its JavaScript browser tests are outside
  Jev's current TypeScript-only file boundary.
  Source 558 → 769 lines; tests and test setup 500 → 811 lines.
  The worker saved commit `f3a2e7f`.
  [Saved result](trial-01-round-3-glm.json).
- **MiMo Flash** — type check, 70 tests, and build,
  rerun in a separate container. Jev twelve times.
  It reports repeated title renames
  until borderline provisional findings stopped firing.
  That is a cost to study: advisory findings need not all disappear.
  Source 637 → 885 lines; tests 665 → 1,266 lines.
  [Saved result](trial-01-round-3-mimo-flash.json).
- **MiMo Pro** — type check, 69 tests, and build. Jev ten times.
  Source 653 → 941 lines; tests 853 → 1,727 lines.

All four checked snapshots are saved in
`trial-01/results/round-3-completion/`.
Source and test hashes match the checked snapshots.
[All four results](trial-01-round-3-all.json).

Round 4 is the last packet: undo successful booking changes.
Each writer keeps its own code; trial budget stops stay off.

Round 4 agent IDs:

- `xiaomi/mimo-v2.6-flash`: `20f46f52-522f-4af8-8fc0-930188c90393`.
- `xiaomi/mimo-v2.6-pro`: `b0277200-a7b5-4eaf-901e-415169078098`.
- `zai/glm-5.3-flash`: `ccfb0b60-1690-4893-880f-54da07d4d213`.
- `deepseek/deepseek-v4.1-flash`: `3a826952-6532-44f7-8419-da54054b9a99`.

### Round 4 results

Each saved snapshot passes the teacher's sampled core and browser
checks for all four rounds, including undo and earlier behavior.
No teacher repairs were needed.
DeepSeek and GLM's own commands also pass in separate containers.

- **DeepSeek** — type check, 65 tests, build. Five Jev calls.
  Source: 951 lines. Tests: 1,647 lines.
  [Saved result](trial-01-round-4-deepseek.json).
- **GLM** — type check, 47 core tests, 8 browser tests, build.
  Four Jev calls. Source: 819 lines. Tests: 965 lines.
  [Saved result](trial-01-round-4-glm.json).
- **MiMo Pro** — direct type check, 83 tests, and build exit 0.
  Jev seven times.
  Source 941 → 1,011 lines; tests 1,727 → 2,054 lines.
  [Saved result](trial-01-round-4-mimo-pro.json).
- **MiMo Flash** — see the final result below.

Cleanup waited until all final snapshots and results were saved.

### Trial 01 final result

- All four saved round-4 apps pass teacher version 2 for rounds 1–4.
- Their direct type checks, tests, and builds also pass.
- MiMo Flash final check: 89 tests passed, type check and build exit 0.
- The final exports match the checked source and test files by hash.
- Five saved stages per writer include the early capped attempts.
- All four workspaces and projects are removed, with their
  containers, volumes, folders, and trust entries.
- The main project and saved evidence remain.

See [results](REPORT.md) and [cleanup proof](trial-01-cleanup.json).

### Code review after the trial

- All four saved apps were compared with the current issue tracker using Jev.
- Four added checks per writer; seven cases fail across the four apps.
- All four keep app state in React, contrary to the worker rules.
- The Jev parser misses React component kinds; direct React questions
  still miss the local-state pattern that plain code should check.
- No app code changed and no repair workers were launched.
- All temporary probe containers were removed.

See [code review and proof](CODE-REVIEW.md).

### Learning loop authorized

The user asked to keep looping until the writers follow our pattern.
Each own app was restored in a fresh isolated project.
All four repair writers launched with the same new rules.
See [learning stages and acceptance](LEARNING.md).

### First two learning results accepted

The lead checked GLM and DeepSeek in fresh containers;
the final runner repeats these results:

- 29/29 repair checks and 43/43 fresh-feature checks pass.
- Source review finds the tracker's core-cell and view-action pattern.
- The new Jev component scan sees the views; it reports no notes on them.
- The old DeepSeek feature save fails only the clicked-row check,
  which its next attempt passes.
- All original round-4 saves fail at least one stronger check.

Both accepted workers are cleaned up, including their projects.
Saved app archives include git history; their hashes were checked first.
Their workspaces, containers, volumes, folders, and trust entries are gone.
The two MiMo workers stayed active;
MiMo Pro resumed after a gateway timeout, with trial caps still off.
The Jev teacher workspace was removed after its commits were reviewed.
The main project is untouched.

Proof stays in learn-01/results under the runtime path in LEARNING.md.
Teacher repo checks pass: vp check exits 0; 19 shape tests pass.
Both teacher workspaces and branches are removed.

The live card stayed Doing until all four were reviewed and cleaned up.

### Learning loop complete

All four models pass repair and the fresh rename-series task.
The lead checked saved apps in fresh containers and read the changed code.

- Each passes 29 repair checks and 43 fresh-feature checks.
- Their own type checks, tests, builds, and earlier teacher checks pass.
- GLM and MiMo Pro passed the fresh task first try.
- DeepSeek and MiMo Flash each needed one clicked-row fix.
- All four keep app state in cells and use the tracker view/action pattern.

All worker projects and workspaces are removed, with runtime files and trust.
The teacher workspaces were removed after review too.
Failed and passing archives, logs, and source review copies remain.
The main project is kept.
See [the final call](LEARNING.md#final-call),
[results](learning-results.json), and [cleanup](learning-cleanup.json).
