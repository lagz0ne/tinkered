# drivers v1 — every driver is an extension (ADR 0051)

Decided 2026-09-20 with the user (grill, 2 rounds). Decision: `docs/decisions/0051-*.md`. Terms: glossary
"Drivers as extensions". Consumers that prove each ticket: `apps/issue-tracker` and the tours in `examples/`.

Rule the whole track enforces, as a grep gate at the end:

```text
Scope.Handle may appear in:  a composition root (main.ts / main.tsx / a test)   and   Extension.start
                             nowhere else
```

## Tickets (expand → migrate → contract per package)

| Ticket      | Package | Slice                                                                                                                                                                                                                                                                                                                                                                                                                    | Blocked by                                                                                                                                                                                                                                                |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| drivers/t01 | core    | `Extension.session(handle, next)`: the onion around a session's life; `next()` resolves with the close `Result`. Chain built once at creation; `createSession` pays nothing when no extension declares it (probe `session` before/after, min of 3). Also: an extension may appear in `depends` and delivers its start value after `ready` (ADR 0050 §4 made it resolvable; this makes it declarable). Tests at the seam. | —                                                                                                                                                                                                                                                         |
| drivers/t02 | tracker | `publishAfterCommit` extension replaces the outer Hono middleware in `server/app.ts`; `source().connect` resolves with the session `Result` (sync change lands here or in t06, whichever is first).                                                                                                                                                                                                                      | t01                                                                                                                                                                                                                                                       |
| drivers/t03 | hono    | Expand: `hono({ routes, onError, tags?, mount? })` extension; `route.*(path, op                                                                                                                                                                                                                                                                                                                                          | loader, { input, respond })`returns a plain row; value = the Hono app. Migrate: tracker`createApp`, `examples/hono`, `examples/sync/hono.ts`. Contract: delete `honoApp`, the `routes`tag, public`tinker`and`handle`(internal now);`stream` stays public. | t01 (for `/sync` GET: `openWire` op depends on `source`) |
| drivers/t04 | cli     | Expand: `cli({ commands })` extension; rows `command(name, op                                                                                                                                                                                                                                                                                                                                                            | () => import(…), { argv, respond })`; value = `run(argv, io)`; `runMain`becomes root glue over it. Migrate: tracker`tools/main.ts`, `examples/cli`. Contract: delete `commands`tag,`command.entry`, `run({ scope })`.                                     | —                                                        |
| drivers/t05 | mcp     | Expand: `mcp({ name, version, tools })` extension; rows `tool(op, { description, schema })`; value = `McpServer`. Migrate: tracker `tools/issues.ts` (`serveIssues(scope)` → root), `examples/mcp`. Contract: delete `mcpServer(scope)`, the `tool`/`tools` tags.                                                                                                                                                        | —                                                                                                                                                                                                                                                         |
| drivers/t06 | sync    | Expand: `source({ cells })`, `subscribe(transport, { cells })` with rows `[cell, key]` / `[family, label]`; `connect` returns `Result`. Migrate: tracker server + client roots, `examples/sync`. Contract: delete `sync`, `synced` tags and `readSynced`.                                                                                                                                                                | t01                                                                                                                                                                                                                                                       |
| drivers/t07 | repo    | The two-hands gate: a `scripts/validate.mjs` lane that greps `Scope.Handle` outside roots, `Extension.start`, and tests and fails on any hit; `docs/best-practices.md` rules 2, 6 rewritten to ADR 0051; glossary "Hono driver", "CLI entrypoint", "MCP driver" sections updated.                                                                                                                                        | t03, t04, t05, t06                                                                                                                                                                                                                                        |
| drivers/t08 | core    | Remove `meta` from every unit (public field; SCIP table first). **Parked** until t03–t06 landed and no reader remains.                                                                                                                                                                                                                                                                                                   | t07                                                                                                                                                                                                                                                       |

## Small fixes from the reshape feedback (independent, run in parallel with t01)

| Ticket          | Package | One line                                                                                                                                                 |
| --------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fix/subflow-run | core    | A subflow controller's `run` returns a plain `Promise<Awaited<T>>` so `.then(ok, err)` types without three type arguments (`drafter.ts` `start`).        |
| fix/watch-prev  | core    | `controller.watch((next, prev) => …)` hands the previous value.                                                                                          |
| fix/stream-null | http    | `HttpResponse.Handle.stream()` raises a registry error on a bodiless response instead of returning `null` (or a documented `streamOrRaise`).             |
| fix/serial-tx   | drizzle | A documented recipe (or a `serial` option) for single-connection stores; today PGlite serializes itself — the recipe says when a queue is needed at all. |
| docs/form-cells | react   | A worked form example in `examples/react`: cells + one save operation + a headless test, the pattern the tracker client now uses.                        |

## Gates per ticket

`vp check` 0 errors · the package's `vp run <pkg>#test` · `pnpm validate` 37/37 · the package's mutation lane
alone · for core tickets the `scripts/ticket.sh` gate and the probe table (before/after, min of 3) · the
`impact` block in this file before code (ADR 0047) · consumers (tracker, tours) green after migration.

## drivers/t01 — impact block (2026-09-20, grep + SCIP symbol names; core `packages/core/src/index.ts`)

```impact drivers/t01
symbol / site                                   file:line (at 9557e85)             change
Scope.Extension (type)                          core index.ts ~330 (namespace Scope)   + `session?(handle, next): Promise<Result>`
extension() builder                             core index.ts:502                      + `session` in the config type
Scope.Dependency / Depends                      core index.ts:290-297                  + `Extension<unknown>`; SlotValues maps it to the start value
buildDeps / resolveDep                          core (grep `function resolveDep`)      deliver an extension's settled value; `NotResolved` before ready
makeLayer + createSession                       core index.ts:2857-2860                session chain around the child layer's life
runSession (scope.session(fn))                  core (grep `function runSession`)      same chain
runTagged (tagged calls open a session)         core index.ts:1423                     same chain
extendHandle                                    core index.ts:2691                     builds the `session` chain once; no chain → plain `createSession`
closeLayer                                      core index.ts:2508                     the Result the chain's `next()` resolves with
bench/core-probe.mjs `session` scenario         bench:51                               before/after, min of 3 — must not move when no extension declares `session`
packages/sync/src/index.ts source().connect     sync:~230                              (t02/t06) returns the session `Result`
consumers of Scope.Extension type               sync (source, subscribe), tracker publishAfterCommit (t02), tests
```
