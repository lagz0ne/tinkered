# Package roles

Date: 2026-10-01.
Status: Done; package roles, removal, and current-main checks pass.
Owner: authoring lead.
Writer: Astra xhigh; unused starter removal only.
Reviewer: Opus high.

## Goal

Apply the [settled package rule](../../best-practices.md#give-the-package-a-job).
A graph module supplies reusable units and engines for an app goal.
A host adapter connects an app's graph to outside inputs and lifetime.
A helper-only library does not earn a `@tinker/*` package.
Graph builders count by the units they declare.

The precedent is Core's native graph and Unix's main entry.
Process binds the command line entry to an app graph.
React binds mounted views to that same graph model.

## Writer target

Use the [fixed writer rules](../contributor-brief.md).
Work in `/home/paseo/next/tinkered-package-roles`.
Touch only `packages/utils/` and `pnpm-lock.yaml`.
The lead owns this note, the board, and the package docs.

Remove the unused `utils` starter and its lockfile entry.
Its only export is `fn()`, which answers `Hello, tsdown!`.
There are no current source imports or workspace dependencies on it.
Keep history notes that describe the old starter.
No public Core or integration API changes.
No replacement helper library or graph is needed.

Run `vp install` to update the lockfile.
Check that only the starter's importer disappears.
Build the workspace before checking it.
The lead runs the final full tests and release checks.
Commit only the starter removal and lockfile.
No timing or fault lane applies to a removed unused starter.
All surviving runtime source and tests stay unchanged.

## Foundation

- **Core** — declares graph units and owns their lifetime.
  Public API: `tag`, `data`, `resource`, `operation`, `extension`,
  `namespace`, and `createScope`.
  [Source](../../../packages/core/src/index.ts).

## Graph modules

- **Auth** — `auth()` declares config, user data, and an auth extension.
  [Source](../../../packages/auth/src/index.ts).
- **Blueprint** — corpus and judge resources; `check`, `verify`, and other actions.
  Its CLI uses Process as app entry support.
  [Source](../../../packages/blueprint/src/index.ts).
- **Drizzle** — driver resources and database actions.
  PGlite supplies `config`, `database`, `transaction`, and `migrate`.
  The app imports those units from `@tinker/drizzle/pglite`.
  The root entry supplies helpers for app-authored resources.
  Driver paths keep database types and optional SDKs with their driver.
  [Graph](../../../packages/drizzle/src/pglite.ts).
  [Resource helpers](../../../packages/drizzle/src/index.ts).
- **Harness** — `harness()` declares a thread resource, state cells, and `send`.
  [Source](../../../packages/harness/src/index.ts).
- **Hono** — `hono()` supplies a request-serving extension.
  The `request` and `emit` tags and `stream()` helper bind app actions to HTTP requests.
  [Source](../../../packages/hono/src/index.ts).
- **HTTP** — `config` and `backend` tags; `attempt` and `send` actions.
  [Source](../../../packages/http/src/client.ts).
- **Jobs** — `jobs()` supplies the worker extension and `send` action.
  [Source](../../../packages/jobs/src/index.ts).
- **Mail** — `mail()` supplies its extension and `sendMail` action.
  [Source](../../../packages/mail/src/index.ts).
- **MCP** — `mcp()` supplies an extension that exposes app operations as tools.
  [Source](../../../packages/mcp/src/index.ts).
- **NATS** — `nats()` declares config, a connection resource, publishing, and its extension.
  [Source](../../../packages/nats/src/index.ts).
- **Stack** — composes package graphs through server, migration, and publishing extensions.
  `traceSink()` declares queue resources and export actions under its extension.
  Its dev entry supports app reloads; formatting and test helpers stay with Stack.
  [Public API](../../../packages/stack/src/index.ts).
  [Server](../../../packages/stack/src/server.ts).
  [Tool graph](../../../packages/stack/src/trace.ts).
- **Sync** — source and subscriber extensions connect declared data cells.
  Transport helpers support that graph.
  [Source](../../../packages/sync/src/index.ts).
- **Tinkerer** — `tinkerer()` declares turn and step actions, state cells, and config tags.
  [Source](../../../packages/tinkerer/src/index.ts).

## Host adapters

- **Process** — CLI routing, process tags, signals, and one app root's cleanup.
  The app supplies the command operation or service extensions.
  [Source](../../../packages/process/src/index.ts).
- **React** — providers, state subscriptions, resource reads, and operation calls.
  Core owns graph state; mounted views own their sessions and local view state.
  [Source](../../../packages/react/src/index.ts).

## Result

The review found one helper-only package: the unused `utils` starter.
The other 16 packages supply Core itself, graph modules, or host adapters.
Drizzle's graph is already public through its driver path.
Its README now names that path as the normal app entry.
React's README names its host adapter role.
The review changes no surviving runtime API.

## Proof

Opus high review is READY on all 16 roles and the unused starter removal.
The Hono wording now names its `stream()` helper.
No current source caller or workspace dependency uses the removed starter.
The lockfile diff removes only its 24-line importer.

The first full gate used base `5487051b`.
Install, full build, and check pass, exit 0.
Check reports 0 errors and 28 existing warnings.
All 29 package and example test suites pass, exit 0.
The one existing paid Blueprint case stays skipped.
All 54 release checks pass, exit 0.
All six touched docs pass prose and phone-width checks.
Prose reports 0 hits across 174 tracked docs.
The lead's 32-link check passes.
Focused strict census passes; Jev lead review has 0 flags.

All 728 surviving package, app, and example files match current-main base `7e75db1b`,
except the two README role notes.
No surviving runtime or test input changes, so its fault proof is retained.
The removed unused starter has no remaining fault lane.

After rebasing on `7e75db1b`, install, full build, and check pass again.
The affected suites pass: Hono 93, Stack 136, Jobs 26, and tracker 87.
Prose and phone-width checks pass on the final docs.
