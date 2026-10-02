# Keep the plain Start registry

Owner: lead Codex; Sol source-registry writer.

Read the [fixed brief](../contributor-brief.md).
This is removal work, with no migration.

## Target

Keep the Start app's three source items.
User code declares data, tags, resources, and operations.
Copy the portable authoring rules with the first install.
New code outside those four forms must give its reason in TSDoc.
The fixed Start bridge still owns middleware and scope lifetime.
Keep auth, Postgres, mail, SSE, and Victoria storage.

Remove the old 13-item source catalog under `registry/`.
Remove its copied payloads under the app's `public/r/source/`.
Remove its workspace entry and unused native dependencies.
Remove its build, size, test, and index lanes.
Keep checks for Core, React, the Start app, and private Blueprint.
Move Blueprint's corpus check to its own tool folder.
Remove the retired stack trace-sink benchmark.
Update current docs that link to the removed catalog.
Leave old decisions and progress proof as history.

## Impact

Retired items: auth, drizzle, harness, hono, http, jobs, mail,
mcp, nats, process, stack, sync, and tinkerer.
No kept app imports those source items.
Blueprint owns its process source already.
Start owns concrete service resources and action operations already.
Core and React public exports do not change.

## Boundaries

Work in a fresh worktree from current main.
Do not edit Core, React, feature source, or other active cards.
Do not alter `.agents/` files or add shared Jev rules.
Only remove retired owner paths from tool discovery.
Do not remove a kept check to make a failure go away.

## Verify

- `vp install` removes the retired workspace from the lockfile.
- `vp run -r build` passes.
- `vp check` passes with no new warnings.
- `vp run -r test` passes.
- Start registry build and real copy/update proof pass.
- Kept graph, ambient, and scope ownership checks pass.
- `vp run prose` passes.
- No current task or script names the removed source catalog.

The lead reviews the diff and runs the kept checks in main.
Do not push or run mutation lanes for this deletion.
