# Writer learning loop

Status: MiMo repairs are still in progress.
GLM and DeepSeek pass the stronger behavior checks.
The final Jev tool checks are in progress.
Owner: Codex.
User asked to keep looping until all four follow our code pattern.

## What counts as done

Each writer must pass both stages on its own code:

- Repair all four earlier task rounds and the review failures.
- Add the fresh rename-series feature using the same rules.

For both stages, check:

- Earlier behavior and new behavior through core and the real browser.
- All app state in core cells; views use useData and useRun.
- Managed errors, no hidden casts or mocks, and behavior tests.
- Type check, writer tests, browser tests, and build.
- Jev advice reviewed; a low probability is not a pass condition.
- Lead reads the saved code before accepting it.

The second stage tests use of the rules on new work.
It does not prove these models will pass every future task.
No repairs or app implementation are written by the teacher.

## Fair access

Each writer starts from its own last saved trial-01 code.
The same pinned image and original four model routes are kept.
Trial budget stops remain off, as the user requested.
All examples, issue-tracker code, other submissions,
private checks, host files, and network stay out of the workers.
The fresh task is frozen before repair and kept hidden until needed.

The longer learning rules are explicit for this new phase.
They do not change the historic scores or original submissions.
Each worker gets only its own bug report.

## Teacher work

Two Paseo contributors prepare separate tool changes:

- Jev: recognize JSX components and report plain hook-rule failures.
- Writer trial: stronger isolated behavior and state checks.

The lead reviews both, checks that known bad submissions fail,
and uses the stronger rules for every writer.

## Evidence and cleanup

Keep every attempt with its app archive, events, report,
check output, time, and reasons for another attempt.
Save results outside temporary projects before cleanup.
Archive every worker workspace and delete its project too.
Remove containers, volumes, worker folders, and trust entries.
Keep the shared image, model routes, and saved evidence.

Runtime manifest and continuation notes:

```text
~/.local/share/tinker-writer-trial/learn-01/
```

## Repair 1 launch

All four restored apps passed 32 readiness checks.
Five tool and disabled-budget tests passed too.
Restored source and tests match their saved archives by hash.
All four writers started through Paseo with high thinking.
They have the new rules and their own failures only.
The original Jev copy stays fixed during this attempt.
The teacher upgrade must pass review before any app is accepted.

## First repairs checked

DeepSeek and GLM pass the original teacher core and browser checks.
Both pass all four added bug checks from the code review.
The lead also ran their own checks in fresh isolated containers:

- DeepSeek: type check, 78 tests including browser tests, and build pass.
- GLM: type check, 51 core tests, 11 browser tests, and build pass.

The lead read both saved apps.
Form text, edit text, filters, and notices now live in core cells.
Both views call useData and useRun, with no local React state hooks.
The managed error path rethrows unknown values.
Creation order now has its own record, kept across edits and undo.

This matches the tracker's main state and action pattern.
It does not yet count as full acceptance.
The stronger checks and fresh feature are still required.
Saved evidence lives under learn-01/results/repair-1.

## Fresh feature started

GLM and DeepSeek now have fresh agents for the rename-series task.
They keep their own saved code, with no repair chat or worked solution.
Their tool copy stays fixed, as it did during repair.
The shared rules now make clear that useRun.error can supply a message.

Both repair archives are saved before this work starts.
The stronger checks can run beside the new work.
Neither stage is accepted until those checks and source review pass.
This avoids making the writers wait for the teacher tool changes.

## Fresh feature review

GLM and DeepSeek both kept state in cells on the new feature.
Their own checks and earlier teacher checks pass again.
The lead found one new behavior bug in DeepSeek:

- Book a series called Alpha.
- Edit its second row to Beta.
- Click Rename series Beta.
- The editor starts with Alpha; it must start with Beta.

A separate browser check proves the failure.
GLM passes that same check.
DeepSeek now has the failing steps for a fix on its own code.
The first failed feature attempt stays saved.

DeepSeek's next attempt fixes the clicked-row case.
The lead read the change and reran the independent browser check.
All five added checks now pass, along with earlier teacher checks.
Its own type check, 97 tests, and build pass too.

## Stronger checks run by the lead

The lead ran the new checks in fresh containers:

- GLM repair: 29 of 29 pass.
- DeepSeek repair: 29 of 29 pass.
- GLM fresh feature: 43 of 43 pass.
- DeepSeek fixed fresh feature: 43 of 43 pass.
- DeepSeek first fresh feature: 42 of 43 pass.
  The clicked-row title check still fails on that old save.

All four original round-4 saves fail at least one new check.
The old saves remain unchanged, so the tests prove the fixes matter.
Evidence: learn-01/results/acceptance-lead-summary.json
and acceptance-original-canaries.json in that same folder.

The new plain Jev check finds all 13 React state hooks in each old app.
It finds none in the saved GLM and DeepSeek fresh features.
The tracker reference has no shape findings either.
The extractor now sees its 16 JSX components.
Evidence: learn-01/results/shape-comparison.json.

A broken shape helper now reports an unavailable check.
Only a missing optional helper keeps old tool copies working.
The lead checked absent, valid, throwing, wrong-result,
missing-export, and broken-import cases.
All six behave as required.
The writers still use their original frozen tools in this phase.

## MiMo Pro gateway stop

Repair 1 stopped at the gateway stream time limit.
This was not a trial budget stop; those limits remain off.
The partial code, events, and session are saved as repair-1.
A fresh repair-2 agent resumes the same files and task.
No new bug report or worked solution was added.

The repo copy of task 05 has a format-only change.
The frozen trial copy stays unchanged for all four writers.

## Two writers meet the learning check

GLM and DeepSeek now pass both required stages.
The lead read their final code and checked it against the tracker pattern.
The fixed Jev extractor reviewed the reference and both saved views:
25 units, no notes; the plain shape checks also pass.
This supports the claim that both can use our pattern on this task.
It does not prove every future task will pass.

DeepSeek used about 15 minutes of writer time across these stages.
GLM used about 18 minutes.
GLM passed the fresh task without a teacher repair.
DeepSeek needed one fix for the clicked-row title.
MiMo results are not final yet, so this is not a four-model ranking.

The lead labeled one earlier Jev render warning false.
Its action calls were inside event handlers.
The full judge check ran again and saved calibration.json.
These labels help judge quality; they do not change writer scores.
