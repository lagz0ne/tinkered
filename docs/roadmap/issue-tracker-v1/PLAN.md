# Issue tracker — a small, testable application

The user chose an issue tracker on 2026-09-19. The point is to show how the libraries make
an ordinary app easy to compose, understand, and test. The earlier incident-room proposal is
replaced. Build a working app, not a page of disconnected API demos.

The precedent is a small GitHub-style issue list with a three-state board. Start with one
project and local demo identities. These are example identities, not production authentication.

```text
React screen → HTTP command → transaction → saved issue
React screen ← sync snapshot ← committed state
```

## The app

- Create an issue with a title and description.
- Browse and filter issues; open a detail view.
- Edit, assign, and move an issue through Open, In progress, and Done.
- Add comments and read the saved activity history.
- Open two tabs: a saved change appears in both. Reloading keeps the data.
- Use CLI commands or MCP tools for the same server-owned issue actions.
- Optionally ask the existing harness to draft a summary or next steps. The person decides
  whether to post the draft; normal issue work and tests require no model credentials.

Suggested home: `apps/issue-tracker`, a private workspace app. It imports the public built
`@tinker/*` entries, following ADR 0045's external-consumer rule. The short tours stay in
`examples/`; link this larger combined example from their index. Do not edit the playground.
One documented command starts the app; one documented command checks its behavior.

## Where the value should be visible

| Library | Real job in the app                                                             | What the example should make easy to see                               |
| ------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| core    | Issue actions, cells, resources, lifetimes, context tags, clock, cleanup, spans | Business behavior is declared once and tested without a web server     |
| drizzle | PGlite database and short transaction sessions                                  | The same operations use a real isolated database in tests              |
| hono    | HTTP actions and the live transport                                             | `app.request` tests the actual routes without opening a port           |
| http    | Browser and CLI command client                                                  | Typed request parsing, errors, cancellation, and configurable backend  |
| sync    | Committed issue snapshots and selected issue details                            | React consumes ordinary cells; transport is a small app-owned piece    |
| react   | Board, issue detail, drafts, pending/error states                               | UI hooks use the same core handles, without another state store        |
| cli     | Start/seed the app and send remote commands                                     | CLI mutations reach the running server, preserving one source of truth |
| mcp     | Expose the server's issue actions as tools                                      | HTTP and tool calls share domain behavior, not copied handlers         |
| harness | Optional issue summary/triage draft                                             | SDK activity becomes data that can be watched, tested, and cancelled   |

`packages/utils` is still a starter, not a domain primitive to force into the app.
Use extensions for the real boot/sync/close work. Other hook APIs need an actual use before
the example adopts them. No new core primitive is part of the initial plan.

## Boundaries to preserve

1. The server owns saved state. Browser drafts stay local; saving sends a command through HTTP.
   Sync v1 only sends snapshots down. It is not a bidirectional write protocol.
2. Publish saved issue state only after the database transaction finishes successfully. Live
   agent progress is transient and must be labelled separately from saved comments or activity.
3. A request is short; a sync connection or harness run can be long. Never keep a transaction
   open for a live stream or an agent turn. PGlite is single-connection: serialize short mutation
   transactions if needed, and explain the reason instead of claiming concurrent DB isolation.
4. Session cell writes do not update the source scope's cells. Any bridge from a request/run
   into shared issue state must name its owner and have behavior tests. Do not disguise the gap.
5. Root run/resolve/write hooks do not cover request sessions or dependency-edge writes in v1.
   Do not treat root hooks as a universal permission check.
6. Reconnection is app-owned. Recreate the connection/subscription and wait for its initial data;
   do not assume the sync package retries, persists missed events, or unregisters individual cells.
7. Failures are managed at the boundary. Cancellation stops owned work through its signal;
   cleanup follows. Do not write a final state into a session that is already closing.
8. No secrets, model calls, or external account are needed for the default app/test path. The live
   harness is opt-in. Jev calibration and `@tinker/ai` remain deferred.

## Tests are part of each slice

- Test domain operations through public entries with a real isolated PGlite database and the
  core test clock where time matters. Check outcomes, not call counts or private fields.
- Test the real Hono routes with `app.request` and sync with `memoryPair` for small, fast proofs.
- Add a real browser check for two tabs sharing a saved change and reload persistence. Use
  Playwright assertions and observable events, not sleeps, mocks, or fake timers.
- Test the real MCP SDK client against its in-memory transport. CLI uses its public `run` seam.
- Harness tests preset its public lazy SDK resource, as existing tests do; never use presets
  in app source. Report separately whether a live credentialed harness run was exercised.
- Keep one behavioral promise per test. A single test may check the values that prove that promise.

## Feedback, not speculative APIs

Each writer report ends with Core feedback. Record the concrete task, awkward code or limitation,
the honest workaround, and the test that exposes it in `docs/roadmap/core-feedback.md`.
Classify it as a doc issue, app composition issue, library defect, or a new capability request.
Fix a proven defect with a regression test. Promote a new primitive only after another integration
needs it too, or the current workaround misrepresents behavior. Gather evidence as we build.

## Done means

The complete create/edit/comment flow works in two browser tabs and survives reload/restart;
HTTP, CLI, and MCP share issue behavior; the optional harness path is documented and seam-tested;
test commands, public-import checks, `vp check`, the app build, and repo validation pass.
The lead has reviewed each slice, recorded feedback, and verified a mobile-friendly live preview.
Local benchmark observations are optional; no dedicated bench resource is required for this app.
