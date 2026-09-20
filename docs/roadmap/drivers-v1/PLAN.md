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

| Ticket          | Package | One line                                                                                                                                                                                                                             |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fix/subflow-run | core    | A subflow controller's `run` returns a plain `Promise<Awaited<T>>` so `.then(ok, err)` types without three type arguments (`drafter.ts` `start`).                                                                                    |
| fix/watch-prev  | core    | `controller.watch((next, prev) => …)` hands the previous value.                                                                                                                                                                      |
| fix/stream-null | http    | `HttpResponse.Handle.stream()` raises a registry error on a bodiless response instead of returning `null` (or a documented `streamOrRaise`). **Done** `6c96adc`: `NoBody { status }`; http mutation alone 70.51 (baseline ~70).      |
| fix/serial-tx   | drizzle | A documented recipe (or a `serial` option) for single-connection stores; today PGlite serializes itself — the recipe says when a queue is needed at all. **Done** `ac99002`: README section, recipe only (PGlite serializes itself). |
| docs/form-cells | react   | A worked form example in `examples/react`: cells + one save operation + a headless test, the pattern the tracker client now uses. **Done** `239f158`: `examples/react/form.tsx` + headless `form.test.ts`.                           |

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

## drivers/t03 — impact block (2026-09-20, import sites of `@tinker/hono`)

```impact drivers/t03
symbol                  today                                        after (ADR 0051)                                   consumers to migrate
honoApp(scope, opts)    mounts routes.all + mount slot                deleted; `hono(wiring)` extension, value = Hono app   apps/issue-tracker/src/server/app.ts, examples/hono/basic.ts, packages/hono/tests/routes.test.ts, README
tinker(scope, opts)     public middleware                             internal to the extension                          examples/sync/hono.ts (uses tinker+stream directly → row with `respond: stream`), tracker app.ts
handle(op, route)       public endpoint builder                       internal                                           packages/hono/tests/{errors,stream,hono,routes}.test.ts, README
route.<verb>(path, load, opts) → Tag.Binding<BoundRoute>   scope tag  route.<verb>(path, op | loader, opts) → plain Row   tracker routes.ts (issueRoutes), examples/hono, hono tests
routes (tag), HonoScope.BoundRoute/Load           scope-config vocabulary   deleted                                     tracker routes.ts (type import), hono tests
HonoScope.Options.mount                            hand-mounted extras       stays: `hono({ mount })` for streaming routes that need `stream` (best-practices rule 6 exception)   tracker app.ts (/sync GET)
stream(c, write)        public                                        public, unchanged                                  tracker routes.ts, draft.ts, sync.ts; examples/sync/hono.ts
request (tag)           public                                        public, unchanged                                  —
tracker /sync GET       closes over `origin = scope.resolve(src)`     `openWire` operation with `depends: { origin: src }` (t01 B) and `respond: (wire, c) => stream(c, …)`; no mount needed if that lands cleanly   tracker app.ts, sync.ts
```

Expected after: `honoApp|tinker\(|handle\(` outside `packages/hono/src` → `(none)`; `Scope.Handle` in `packages/hono/src` → the extension's `start` parameter only; tracker `createApp` builds no `Hono` itself.

## drivers/t01 — probe table (min ns/iter, `taskset -c 2 node --expose-gc bench/core-probe.mjs <scenario>`, min of 3)

BEFORE (2026-09-20, worktree base `2f5e4da` = main, no code change yet):

| scenario  | run 1  | run 2  | run 3  | min    |
| --------- | ------ | ------ | ------ | ------ |
| `session` | 1613.0 | 1701.0 | 1625.0 | 1613.0 |
| `tagged`  | 2125.0 | 2090.0 | 1963.0 | 1963.0 |
| `create`  | 176.5  | 169.6  | 170.8  | 169.6  |
| `run`     | 113.0  | 112.6  | 112.6  | 112.6  |
| `op`      | 101.0  | 101.5  | 102.0  | 101.0  |

AFTER: (filled in when the change lands)

AFTER (2026-09-20, `1e45688` + session-path inline refactor, same method):

| scenario  | run 1  | run 2  | run 3  | min    | vs BEFORE min  |
| --------- | ------ | ------ | ------ | ------ | -------------- |
| `session` | 1604.0 | 1544.0 | 1626.0 | 1544.0 | −69 (no move)  |
| `tagged`  | 1948.0 | 2115.0 | 2014.0 | 1948.0 | −15 (no move)  |
| `create`  | 169.2  | 168.4  | 169.0  | 168.4  | −1.2 (no move) |
| `run`     | 113.3  | 103.1  | 110.5  | 103.1  | −9.5 (no move) |
| `op`      | 101.3  | 101.3  | 101.2  | 101.2  | +0.2 (noise)   |

Scare during the ticket: the first AFTER run showed `session` min 1748 vs BEFORE 1613 (+135).
Same-process interleaved A/B (`mitata`, alternating `main_session`/`new_session`: 1606/1641,
1648/1661, 1640/1694 — new at or below main every run) proved it was process/box noise, not the
change; the official AFTER table above (same separate-process method as BEFORE) confirms no move.
A refactor still landed from the scare: the unwrapped path is main's body inline in
`runSessionWith` again (one root lookup first), the wrapped path lives in `runSessionWrapped`.
