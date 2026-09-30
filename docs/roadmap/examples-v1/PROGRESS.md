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
Pending: every exported package installs, checks, tests, and runs outside the repo.
Pending: full build, check, tests, prose, strict census, and release validation.

## Tool findings

Vite+ does not order builds for plain library version dependencies.
A cold React build failed even with explicit dependency tasks.
The checkout needs workspace links; the exporter replaces them in the copy.
Vite+ allows `run.cache` only at the workspace root.
Use its default script cache rule so run commands execute each time.
