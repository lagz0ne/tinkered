# Example app entries

Status: Review.
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

Pending.
