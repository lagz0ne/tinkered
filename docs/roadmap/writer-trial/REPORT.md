# Writer trial results

Trial 01: four models each grew one booking app over four rounds.
All four pass the chosen checks; DeepSeek was fastest.
A later [code review](CODE-REVIEW.md) found bugs and state-rule gaps.

## Time to finish and test

Active writer time after we removed trial caps:

- DeepSeek Flash: 12.4 minutes.
- GLM Flash: 24.0 minutes.
- MiMo Flash: 56.6 minutes.
- MiMo Pro: 75.3 minutes.

Totals cover round 2 completion, round 3, and round 4.
They include writer self-checks and Jev calls.
They exclude earlier capped runs, idle waits, and teacher checks.
DeepSeek was fastest in each of these three stages; GLM was second.

## Repo growth

Lines at round 2 completion, then rounds 3 and 4.
More lines or tests do not prove better code.

- **DeepSeek** — source 662 → 885 → 951.
  Test lines: 798 → 1234 → 1647.
  Final writer tests: 65 passed.
- **GLM** — source 558 → 769 → 819.
  Test lines: 500 → 811 → 965.
  Final writer tests: 47 core and 8 browser passed.
- **MiMo Flash** — source 637 → 885 → 964.
  Test lines: 665 → 1266 → 1601.
  Final writer tests: 89 passed.
- **MiMo Pro** — source 653 → 941 → 1011.
  Test lines: 853 → 1727 → 2054.
  Final writer tests: 83 passed.

All four added dates, series, and undo to their earlier saved code.
All four still pass the shared checks for earlier behavior.
The teacher did not repair their app code.

## Limits of this result

- One run per model, not a firm model ranking.
- The shared checks cover chosen cases, not every case.
- Passing them does not prove equal code quality or no bugs.
- A deeper code review and more shared cases could split the tie.

Early caps stopped several writers before they saved code.
At the user's request, we removed the caps and resumed saved repos.
GLM already had code; the others had much less saved work.
So total time is an observation, not a clean speed test.
The original capped attempts stay saved beside the later runs.

A teacher Vite cache bug was fixed before the final comparisons.
All final results use teacher version 2 and the same pinned image.
Each final export matches the source and tests that were checked.
All of example-land stayed outside the worker files and history.

Jev was advice throughout; its judges are not yet proven.

- Some writers spent extra calls renaming tests to clear advice.
- Pure helpers over fixed constants drew false-positive reports.
- No group ran without Jev, so this run cannot show Jev's benefit.
- Writer cost estimates exclude Jev costs, which were not measured.
- Duplicate code and branch counts were not measured.

## Final call

- DeepSeek is the best speed and test-pass pick in this run.
- There is no clear quality-only winner from the shared checks.
- All four final apps pass the teacher core and browser checks
  for all four rounds, plus type checks, their own tests, and builds.
- These pass results cover the original chosen checks only.

## Saved proof

- [Final checks](trial-01-round-4-all.json).
- [Stage times, usage, growth, and file hashes](trial-01-growth.json).
- [Run notes and earlier results](PROGRESS.md).
- [Cleanup proof](trial-01-cleanup.json).

Full app archives, model replies, sessions, and check logs:

```text
~/.local/share/tinker-writer-trial/trial-01/results/
```

Temporary workspaces, projects, containers, volumes,
worker folders, and worker trust entries were removed.
The shared image and model routes remain ready for another trial.
