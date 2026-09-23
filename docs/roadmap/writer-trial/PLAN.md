# Same questions, new task

## Goal

Test whether the same rules and Jev questions work on another domain.
The new task is a learning plan with course prerequisites.
It adds graph links, cycle checks, and blocked completion or reopening.
A graph is a set of records joined by links.

## Fixed inputs

Use the same four models and high thinking as stock-01.
Use the same image and no trial caps.
Keep guidelines.md, bank.mjs, calibration.json, and enabled judge ids fixed.
The question bank and calibration match stock-01 byte for byte.
The new plain writable-view check is part of this trial's tools.
Record that tool change; do not call it a new Jev question.
Freeze all copies and hashes before any writer sees the task.
No examples, other apps, other writers, or private checks reach writers.

## Review

Prove the private checker with a good app and deliberate faults first.
Use the same cases for all four writers.
Score each first attempt before giving that writer any feedback.
Keep every failed try, repair, provider error, and checker fix separate.
Check real behavior and read the source against the fixed rules.
Record what Jev caught, missed, or wrongly flagged.
Do not tune questions to this task while the trial is running.
A plain source check may flag a shape; it is not a model question.

## Done when

All four writers have a recorded first score and a final review result.
Any repair gets only its own findings and the same fixed rules.
All evidence is kept before temporary projects are removed.
Report how many passed first try, repair count, and time to acceptance.
One trial cannot prove that every model will follow the rules on every task.

## Results

All four apps are accepted on the learning-plan task.
The same 13 Jev questions and full rules were used throughout.
Two models passed first try. Two needed one small repair.

- DeepSeek Flash: first try, 9.94 minutes, 37 own tests.
- GLM Flash: one repair, 17.06 minutes, 33 final own tests.
- MiMo Flash: one repair, 75.08 minutes, 46 final own tests.
- MiMo Pro: first try, 76.74 minutes, 51 own tests.

Times add writer work across attempts. Queue and review time are excluded.
These are single runs, not a stable speed ranking.
DeepSeek was fastest and passed first try on this task.
MiMo Pro passed first try on both stock and plan.

Every final app passes its supplied check, test, and build commands,
all 43 private cases, and the separate existing-link check.
Browser tests ran in real Chromium from saved copies in Docker.
Source review checked state ownership, views, errors, and public tests.

## What the loop found

GLM and MiMo Flash rejected a duplicate link on a completed course.
That call changes nothing, so the packet requires it to pass.
The original 43 cases missed this combination.
Source review found it; the same extra probe ran on all four apps.
Both first archives fail it. Both repaired archives pass it.
DeepSeek and MiMo Pro pass it on their first archives.
Keep this added probe apart from the original first-attempt score.

GLM also replaced unknown test errors with a bare new Error.
Its repair now preserves the original thrown value.

Jev helped point at test titles and a view helper in MiMo Flash.
Title and filter-operation hints were often false alarms.
The fixed questions did not catch the duplicate-link defect.
They cover code patterns; they do not replace task checks or source review.
No question, threshold, enabled id, or rule was tuned to the plan task.

The loop can produce accepted work across these two new domains.
It is ready for supervised use with tests and a source reviewer.
It is not proof that any tool-using model will get any task right unaided.

## Tool proof and limits

All eight checker proofs pass: three valid layouts pass 43/43;
the empty app and four deliberate faults are rejected.
The full build and 48 tool tests pass.
Repo checks have zero errors and the same 22 old warnings.
All four blank starters passed 32 readiness checks in total.
The fixture passes the style census. Jev review has no file flags.
SCIP was rebuilt; no public package symbol changed.

GLM's resumed agent kept writing to the old event log.
The lead recovered the repair entries into a separate file.
The first saved copy is intact. Both native sessions are kept.
MiMo Flash's fresh repair agent wrote its new log correctly.
Use fresh repair agents until the cached tool setup issue is fixed.

The lead saved all 13 full questions, thresholds, and hashes in
`plan-prep/fixed-questions.json` under the persistent trial data root.
The bank, library, extractor, calibration, enabled ids, and full rules
match stock-01 byte for byte. All frozen hashes were checked at the end.
The plain writable-view check is newer than stock's frozen tool copy.
That is a tool change, not a new Jev question.

## Evidence

Persistent root: `~/.local/share/tinker-writer-trial/plan-01/`.

- `final-results.json`: scores, repairs, work times, and hash proof.
- `results/round-1/`: every attempt, native session, report, and check log.
- Each attempt has `lead-review.json` with the source review decision.
- Separate duplicate-link probe logs preserve the missed-case proof.
- `results/round-1-completion/`: all four final archives.
- `fixed-question-proof.json`: the unchanged question and rule hashes.

All four worker workspaces were archived after the final exports.
Their projects, containers, volumes, trust entries, and folders are gone.
The saved evidence and shared toolchain image are kept.
No package release or push was made.
