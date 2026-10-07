# Owned source registry

Owner: lead Codex; Sol source-registry writer.
Read the fixed contributor brief and coding convention.
This is one mechanical change across the repo.
Do not change feature behavior while moving ownership.

## Target

The user chose the whole repo, not just the Start scaffold.
Keep only `packages/core` and `packages/react` as libraries.
Move the extra integrations to source consumers can copy and own.
Keep all useful source, tests, fixtures, corpus, and templates.
Remove the old package shells directly.
The user chose to remove the old issue-tracker app and
all examples that depend on extra packages.
Do not migrate those apps or preserve their compatibility.

## Precedent and graph

Use shadcn's source registry and fixed item dependency graphs.
Do not add a plugin loader or a replacement integration package.
Apps import their own files.
A private registry workspace validates and publishes file payloads.
No target app depends on that workspace.

```text
packages/
  core/
  react/
registry/
  package.json       private source-registry
  registry.json
  src/<item>/
  tests/<item>/
  configs/
  public/r/
tools/
  blueprint/         private CLI, not a library
apps/start-scaffold/
  src/scaffold/      copied Start setup
```

The 13 source items are auth, drizzle, harness, hono, http,
jobs, mail, mcp, nats, process, stack, sync, and tinkerer.
Keep blueprint as a private repo CLI under tools.
It owns a copied process source graph.
Remove the old create-app generator and its legacy template.
The Start shadcn starter replaces that generator.

Source files copy to `src/tinker/<item>/` in apps.
Cross-item imports use sibling paths, such as:

```ts
import { jobs } from "../jobs/index";
```

Keep one copy per item in each consumer.
This preserves shared Core node and tag identities.
Native runtime dependencies come from each current manifest.
Do not change their versions or add unneeded service choices.
Registry items declare their actual source and native dependencies.

## Impact

Public runtime symbols and signatures stay the same.
All extra library import locations change.
Preserve public subpaths:

- Drizzle migrations and pglite.
- Jobs, mail, and NATS testing.
- Stack dev and pages.
- Sync sse.

Remove these exact consumers:

- apps/issue-tracker.
- examples/drizzle, harness, hono, and http.
- examples/mcp, process, and process-cli.
- examples/sync and tinkerer.
- packages/create-app and its generated legacy template.

Keep examples/core and examples/react.
Keep apps/playground, apps/website, and apps/start-scaffold.
Keep their Core/React dependencies and behavior.
Blueprint owns its process copy; no old library name remains.

The active Start app already uses only Core and React.
Do not touch it, its registry, or its live preview.
Do not edit Core or React source.

Keep the existing source-item and blueprint behavior tests running.
The old create-app and deleted-consumer tests leave with those apps.
Move fixture/data paths with their owner and fix path reads.
Temporary dev fixtures must copy source rather than make old
integration package symlinks.
Only native dependencies and Core/React may stay linked.

Update gate scripts that assumed `packages/<integration>`.
Preserve import purity, graph checks, source-size checks,
example export, and behavior checks under the new owners.
Update SCIP paths and refresh affected indexes for review.
No live import, manifest, or alias may hide an old package.

Keep historical decisions and Jev cases unchanged.
Update only active docs/commands that need the new paths.
Jev path rules must recognize owned copied source.
No per-ticket lint rule is allowed.

## Work order

The user said: "Just remove and add back, no need to migrate."
Do one direct remove/add change in the isolated worktree.
Build the source catalog and remove old library/app shells.
Do not stage compatibility periods or old consumer copies.
Commit explicit paths after checks pass.
The lead reviews and combines changes by path.
Never overwrite unrelated concurrent main changes.

## Proof

- Build first; check; all workspace tests by their configs.
- Every kept source-item and blueprint test still runs.
- Deleted app/template tests do not masquerade as passing tests.
- A real shadcn install copies a selected item and graph.
- A source update leaves edited app feature files alone.
- Consumer copies match their selected source graph exactly.
- Remaining Core/React examples export and work outside the repo.
- No live consumer imports registry source or another app.
- No extra Tinker library dependencies/imports/aliases remain.
- Refresh SCIP and review the affected public references.
- Prose, TSDoc, census, and Jev advisory report.

This is direct removal and source ownership, not a performance change.
Do not invent new tests that mirror the move.
Use the existing behavior tests and real copied-consumer proof.
No speed claims and no benchmark runs are needed.
No push, merge, release, or full mutation lanes for this move.

Report any gate that cannot retain its promise after relocation.
Do not delete a check to make the result green.
