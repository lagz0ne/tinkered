# Stand-alone examples

The user asked for separate, runnable examples on 2026-09-30.
Each of the ten folders becomes its own private package.
Each package declares only the libraries it uses.
Each owns its TypeScript and Vite+ settings, tests, and run steps.

## Target

Use plain package versions so a copied folder has no workspace or catalog dependency.
The repo links those versions to its local library builds.
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

Pending: a copied example must fail before the fix and pass after it.
Pending: every exported package installs, checks, tests, and runs outside the repo.
Pending: full build, check, tests, prose, strict census, and release validation.
