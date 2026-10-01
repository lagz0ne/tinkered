# Example app entries

Status: Done.
Owner: authoring lead.
Writers: Astra, xhigh; one example package per turn.

## Goal

Examples export static graph units.
Their entry runs only under `if (import.meta.main)`.
The entry owns its stop signal and waits for cleanup.
Tests build small roots from those same units.

The precedent is the app entry in ADR 0078 and root lifetime in ADR 0085.
Keep declarations at module scope and process access inside the main guard.
Command examples use the existing Process `main` entry.
Browser examples keep their browser entry and component cleanup.

## Impact before code

Remove callable example runners that hide the graph and its root.
Update each example's index, tests, entry files, and README together.
This affects Core, Drizzle, Harness, Hono, HTTP, MCP, Process,
Process CLI, Sync, and Tinkerer examples.
Their only callers are their own tests, entries, and docs.
No published package API or package runtime source changes.

Live Harness and Tinkerer entries must stay safe to import.
Checks use local adapters; they must not spend a live account's money.
Every root's cleanup must finish after success and failure.
Stream readers, clients, and transport work keep their current owners.

Live entries record a stop request before stopping the root.
The active reply finishes; later calls are skipped.
They then close the root and wait for cleanup.
A second Ctrl+C quits at once.
The signal probes found Core rejects active data writes during graceful close.
The two callers and reduced failure are recorded in
[Core feedback](../core-feedback.md#graceful-close-blocks-active-writes-2026-10-01).
The separate Ready card is `core/graceful-writes`.

## Verify

- Search all current examples for removed runners and their names.
- Build packages before checking their consumers.
- Run code checks and every example's own test settings.
- Run each local executable entry and check its exit.
- Check imports with no main entry execution.
- Run prose lint, strict style census, and release checks.
- Review the diff before landing.

Package fault checks keep their existing proof.
This ticket changes example consumers, not package source or tests.

## Proof

Checked source: `6de99118`.
Opus review: READY, with no bugs left.
The lead saw every exit code below pass.

- Package build passes before consumer checks.
- Code check passes: 0 errors and 28 existing warnings.
- All 30 test tasks pass with each project's own settings.
  The full run limits task concurrency to two.
  An earlier full run hit Drizzle's unchanged cleanup timeout.
  Its isolated retry passes all 43 tests; no timeout was raised.
- The final reply fix passes Harness's 8 and Tinkerer's 2 tests.
- All 52 deterministic release lanes pass.
- All ten changed examples pass outside the repo.
  Each fresh copy installs, checks, tests, and runs.
- Thirty module imports print nothing and add no signal listeners.
- Current examples and guides contain none of the removed runners.
- Strict style census passes for all ten changed examples.
- TSDoc checks pass on all 42 changed TypeScript files.
- Prose passes; the new proof and changed guides fit the phone rules.

The real entry stop probes use local recorded SDK responses.
Harness's five live entries finish one reply and print it after SIGINT.
Services preserve exit 1 for a failed reply after SIGINT or SIGTERM.
A second SIGINT quits at once.
Tinkerer's before case finishes a reply, then fails with `Disposed`.
Its fixed entry prints that reply, starts no next call, and exits 0.
Neither probe spends a live account's money.

Logs use the `/tmp/tinkered-entries-` prefix.
The full test log ends with `final-tests-second.log`.
The release log ends with `final-validate.log`.
The stop logs end with `harness-stop-final.log`
and `tinkerer-stop-probe.log`.

No package runtime, package tests, or package build settings changed.
Their existing fault and timing proofs still apply.
The Core drain bug remains on the separate Ready card.

Main fast-forwards to `82dff2f6` with all pending peer notes intact.
Its fresh install, build, code check, and prose pass, exit 0.
The example and package code still matches checked source `6de99118`.
A stale ignored Sync declaration with a removed export is discarded.
