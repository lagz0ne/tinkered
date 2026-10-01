# Stand-alone examples

The user asked for separate, runnable examples on 2026-09-30.
Each of the eleven folders becomes its own private package.
Each package declares only the libraries it uses.
Each owns its TypeScript and Vite+ settings, tests, and run steps.

## Target

Use explicit workspace links inside the repo so libraries build first.
Use plain external versions, without catalog settings.
Exported copies use local library archives, with no link to the repo.
The libraries are not on npm yet.
An export command puts the built library archives beside one copied example.
That copy must install and run without this repo or another example.

The public imports and existing file paths stay useful.
Each entry starts only under `if (import.meta.main)`.
Graphs are declared once; roots own live work and cleanup.
Settings use tags; state uses data; actions use operations.
Real service calls require the user's own settings and an explicit run command.
The default run and tests use public fakes or local services.

## Writers

The fixed brief is [contributor-brief.md](../contributor-brief.md).
Each writer owns one example package in an isolated checkout.
The lead owns the workspace, export tools, docs, and final checks.
Writers use `gpt-6-astra` with `xhigh` reasoning.
No library public symbols change, so no cross-package impact block is needed.
No library source changes, so no library fault lane is needed.

## Proof

Before the fix, the outside-repo check for Core fails with exit 1.
Its folder has no `package.json`.
Log: `/tmp/tinkered-examples-before.log`.
All eleven exported packages install, check, test, and run outside the repo.
Copies: `/tmp/tinkered-examples-xp2hqk`.
Log: `/tmp/tinkered-examples-final-standalone.log`.
Harness, Sync, and MCP also passed fresh copies after the final review fixes.
Log: `/tmp/tinkered-examples-final-updated-copies.log`.

Full build, code check, and package tests passed with exit 0.
Code check has the same 28 existing warnings and no errors.
Logs: `/tmp/tinkered-examples-final-build.log`,
`/tmp/tinkered-examples-final-check-complete.log`,
and `/tmp/tinkered-examples-final-tests-retry.log`.
The first concurrent check and test runs ended with signal 15.
The separate retries passed.
Prose and the strict style census passed.
The TSDoc parser checked 73 files and found no rejected docs.
Jev calibration completed with exit 0.
Its result is saved in `tools/jev/calibration.json`.
All 48 release checks passed with exit 0.
Log: `/tmp/tinkered-examples-final-validate-complete.log`.

Core's result test failed before the fix: 264 instead of 286.
The fixed tour reads the live result before cleanup.
HTTP tests failed before response parsing and validation were fixed.
The Harness argv test failed before one leading `--` was removed.
It uses missing account settings, so it never calls a paid service.

The React page passed real browser checks.
Count, reset, profile, document save, and Enter to submit all work.
The saved form clears both fields.
Widths 360, 390, and 1280 have no sideways scroll.
Every button is at least 44 pixels tall; no page errors were raised.
Log: `/tmp/tinkered-react-browser-check.log`.
Preview: <https://p-4df7a91e368b.preview.tini.works>.
The preview lasts up to eight hours.

## Review

Opus 5.5 read every task file and marked the change READY.
The final fixes strip the Harness task separator before prompt validation,
keep CLI pieces outside `main.ts`, and remove an unused lazy-load cache.
The export uses Git's file list, so ignored files stay out of the copy.
Each root checks its close result after a successful run.
Earlier run errors keep priority over cleanup errors.
Live Harness runs print only new text.
Tinkerer declares both namespaces once.
Sync lets its roots close the connection.
MCP reports command errors on stderr and keeps protocol output clean.

The proposed Process test fix failed with exit 130 and zero ticks.
The final test waits for clock events instead of one promise step.
Its abort guard still protects writes after a stop.

The Sync library already imports this example's Hono graph in one test.
That link is unchanged; moving the fixture is separate library work.

## Tool findings

Vite+ does not order builds for plain library version dependencies.
A cold React build failed even with explicit dependency tasks.
The checkout needs workspace links; the exporter replaces them in the copy.
Vite+ allows `run.cache` only at the workspace root.
Use its default script cache rule so run commands execute each time.
A fresh install selected a Codex SDK patch whose CLI was missing on npm.
The Harness package pins the checked SDK version, 0.155.0.

The old release check counted prose and export aliases as casts.
Its four false failures are in `/tmp/tinkered-examples-final-validate-retry.log`.
The new check reads TypeScript syntax, ignoring prose, aliases, and dependencies.
It found zero casts across all 73 example TypeScript files.
A separate probe let prose and an import alias pass.
The probe rejected a real cast and a non-null assertion with exit 1.

## Shared main

GitHub received the checked `stack/t17` work before the example push.
The merge keeps that work and these example changes.
No library source needed a conflict fix.
The board keeps both Done cards; the Jev bank keeps both sets of labels.

All eleven fresh exported copies passed again after the merge.
Copies: `/tmp/tinkered-examples-ltZWjO`.
Log: `/tmp/tinkered-examples-integration-standalone.log`.
The merged build, code check, package tests, and prose all passed with exit 0.
Logs use `/tmp/tinkered-examples-integration-` as their prefix.
All 48 merged release checks passed with exit 0.
Log: `/tmp/tinkered-examples-integration-validate.log`.
The six changed Jev judges were calibrated against the combined bank.
Each run passed with exit 0; the results are saved in `calibration.json`.
