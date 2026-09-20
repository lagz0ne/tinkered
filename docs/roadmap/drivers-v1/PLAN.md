# drivers v1 — every driver is an extension (ADR 0051)

Decided 2026-09-20 with the user (grill, 2 rounds). Decision: `docs/decisions/0051-*.md`. Terms: glossary
"Drivers as extensions". Consumers that prove each ticket: `apps/issue-tracker` and the tours in `examples/`.

Blast-radius tables in this file use prose columns and are for the lead; `node scripts/jev/impact.mjs` needs the `scripts/scip.sh refs` line format (see the jev-loop plan, 2026-09-20 trial).

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

| Ticket          | Package | One line                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fix/subflow-run | core    | A subflow controller's `run` returns a plain `Promise<Awaited<T>>` so `.then(ok, err)` types without three type arguments (`drafter.ts` `start`). **Done** `6ab3bd9`: no core type change needed — an async body's `T` already is its promise; `start` 14→8 lines. Probe (`op`/`run`/`warm`, min of 3): `op` 101.9→101.1, `run` 112.8→112.0, `warm` 28.7→28.9 — no move. |
| fix/watch-prev  | core    | `controller.watch((next, prev) => …)` hands the previous value. **Done** `961b793`: prev travels positionally (no per-notification allocation; one-arg listeners free). Test: two writes → `[0,1]`, `[1,2]`. Tracker untouched (both sites still need their own read). Probe: same table — no move.                                                                      |
| fix/stream-null | http    | `HttpResponse.Handle.stream()` raises a registry error on a bodiless response instead of returning `null` (or a documented `streamOrRaise`). **Done** `6c96adc`: `NoBody { status }`; http mutation alone 70.51 (baseline ~70).                                                                                                                                          |
| fix/serial-tx   | drizzle | A documented recipe (or a `serial` option) for single-connection stores; today PGlite serializes itself — the recipe says when a queue is needed at all. **Done** `ac99002`: README section, recipe only (PGlite serializes itself).                                                                                                                                     |
| docs/form-cells | react   | A worked form example in `examples/react`: cells + one save operation + a headless test, the pattern the tracker client now uses. **Done** `239f158`: `examples/react/form.tsx` + headless `form.test.ts`.                                                                                                                                                               |

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

### drivers/t03 — landed 2026-09-20 (worktree `../tinkered-t03-hono`, branch `drivers/t03-hono`)

- `packages/hono/src/index.ts` 370 → 376: `hono(wiring)` extension (`start`: `await next()`, load every row once, `new Hono().use(serveRequests(scope, wiring))`, one `app.on` per row, `mount`, return app); `tinker`→`serveRequests` and `handle`→`answerRoute` module-private; `route.*` returns a plain `Row`; `routes` tag, `BoundRoute`/`Load`/`Options` gone; `stream`, `request`, `isError`/`Errors` unchanged. Request path byte-for-byte: inline op, span attrs, one log line, error map, `stream` lifetime.
- Tracker: `routes.ts` 87 → 114 (`issueRoutes: readonly HonoScope.Row[]`, module-level `src = source()`, `openWire` op with `depends: { origin: src, wires: viewers }`, `/sync` GET is a row — no `mount`); `app.ts` 82 → 48 (`createScope({ tags, extensions: [src, web, publishAfterCommit()] })`, `await scope.ready`, `scope.run(publishIssues)`, `scope.resolve(web)`); new `server/publish.ts` (29); `operations.ts` +3 (`publishIssues` skips the write when the saved rows serialize equal — a rejected request keeps the cell identity and sends no snapshot).
- `publishAfterCommit` rule shipped: `session` hook captures `handle.resolve(request.optional)` before `next()`; after the close, publishes at the root only when `ended.status === "success"` AND the method is present and not GET. Manual `scope.session` saves (no `request` binding) stay silent; `/sync` connects (GET) stay silent. The 400 case: the session still closes `success` (mapped failure is handled), so `publishIssues` itself is content-aware (skip when equal) to keep the identity.
- Tours: `examples/hono/basic.ts` (extension + `scope.resolve(web)`), `examples/sync/hono.ts` (rows + module-level `src` + `openWire`; `boot()` is now async — resolves after `ready`; one call site in `packages/sync/tests/sync.test.ts` updated).
- Hono tests 32 → 34, all re-expressed through `hono(wiring)` + `scope.resolve(web)`; new: `NotResolved` before `ready`, two extensions = two apps. Tracker `issues.test.ts` +2 (one-row seam test, `publishAfterCommit` POST/400 identity test). Tracker suite 40 → 42, browser 7/7.
- `scripts/validate.mjs`: the `hono pure universal bundle` lane asserted the deleted surface (`m.tinker && m.handle`); now asserts `m.hono && m.route && m.stream`. 37/37 green.
- Deviations: (1) `HonoScope.Load` kept (the row's loader type; the block listed it deleted — the _tag vocabulary_ `BoundRoute` is gone, the loader shape stays as `Row.load`). (2) `publish.ts` keeps a publish thunk from `start`, not a held handle — the rule's letter (grep gate) with the root's intent. (3) `Scope.Handle` in `packages/hono/src` is the `start` param + `serveRequests`'s param (the session middleware the extension builds — the internal helper that takes the layer for it) + the `SessionEnv` record, per the gate's parenthetical.

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

AFTER (2026-09-20, `1e45688` + session-path inline refactor, same method; R3 re-probed
`session`/`create`/`tagged` at `e2248f8`, `run`/`op` unchanged by R3 — its lookup sits on close only):

| scenario  | run 1  | run 2  | run 3  | min    | vs BEFORE min  |
| --------- | ------ | ------ | ------ | ------ | -------------- |
| `session` | 1612.0 | 1630.0 | 1611.0 | 1611.0 | −2 (no move)   |
| `tagged`  | 2054.0 | 1942.0 | 2128.0 | 1942.0 | −21 (no move)  |
| `create`  | 170.5  | 169.2  | 168.9  | 168.9  | −0.7 (no move) |
| `run`     | 113.3  | 103.1  | 110.5  | 103.1  | −9.5 (no move) |
| `op`      | 101.3  | 101.3  | 101.2  | 101.2  | +0.2 (noise)   |

Scare during the ticket: the first AFTER run showed `session` min 1748 vs BEFORE 1613 (+135).
Same-process interleaved A/B (`mitata`, alternating `main_session`/`new_session`: 1606/1641,
1648/1661, 1640/1694 — new at or below main every run) proved it was process/box noise, not the
change; the official AFTER table above (same separate-process method as BEFORE) confirms no move.
A refactor still landed from the scare: the unwrapped path is main's body inline in
`runSessionWith` again (one root lookup first), the wrapped path lives in `runSessionWrapped`.

### drivers/t01 — landed 2026-09-20 (`d8bea8c`, tag `core/t36`)

Seven contributor commits, one fix round (rebase onto main; rebuild before gating; a cascaded close now
settles `next()` through a `SESSION_SETTLERS` side table tapped in `closeLayer`). Lead gates on `main`,
exit-code gated: `vp run -r build && vp check && vp run core#test && vp run core#size` → 0 errors, 273 core
tests (+13: onion order, close statuses, tagged call, nested session, no-hook path, extension as
dependency, skip-`next`, throwing hook, cascade forced/graceful); tracker 40 and sync 28 still green; core
mutation alone **77.96** (floor 75). Probe (min of 3, in-container): `session` 1613 → 1611, `create`
169.6 → 168.9, `tagged` 1963 → 1942, `run` 112.6 → 103.1, `op` 101.0 → 101.2 — no move.
`scripts/ticket.sh` was not run verbatim: its `vp run -r mutate` runs every lane concurrently, which the
isolation rule forbids; its gates were run one by one instead and the tag set by hand.

### drivers/t03 (+t02) — landed 2026-09-20 (`0d17653`)

Five contributor commits, one fix round (no `as` in hono src; a row takes the operation itself, the loader form
only for lazy cases; a stray warning; `src` lives in `server/sync.ts`; rebase). Lead gates on `main`, exit-code
gated: 0 errors / 13 warnings, hono 34, sync 28, tracker 42, browser 7/7 uncached; hono mutation alone **77.66**
(floor 75). `honoApp|routes.all|BoundRoute|tinker(` outside `packages/hono/src` → none. Tracker `createApp` is
48 lines and builds no Hono; `/sync` is a row whose operation depends on the sync source extension (t01 B).
`publishAfterCommit` (t02) reads the request method before `next()` and publishes after a successful non-GET
close; because a mapped 400 still closes `success`, `publishIssues` skips an equal write (core feedback: a
session hook cannot see the response status).

## drivers/t04 + t05 — impact block (import sites, 2026-09-20)

```impact drivers/t04-t05
symbol                         today                                   after (ADR 0051)                                          consumers
cli: run({ scope, argv, io })  creates the scope, routes argv         `cli({ commands })` extension; value = `run(argv, io) → { code, stdout, stderr }`   apps/issue-tracker/tests/tools.test.ts, examples/cli/basic.ts
cli: runMain(options)          creates scope + process wiring         root glue over the extension value (`createScope` + `ready` + `resolve` + exit)   apps/issue-tracker/src/tools/main.ts, examples/cli/main.ts, examples/mcp/cli.ts
cli: commands (tag), command(meta) meta+binding                       `command(name, op | () => import(…), { argv, respond })` row; `commands` tag deleted; `command` meta deleted   tracker tools/issues.ts (meta on 5 ops + `commands(op)` bindings), examples/cli/*, cli tests
cli: command.entry(name, load) entry receives (scope, argv)           entry receives `(argv)` only; the root's closure supplies values (`scope.resolve(mcpExt)`)   tracker tools/main.ts (mcp entry), examples/mcp/cli.ts
mcp: mcpServer(scope, opts)    takes the scope                        `mcp({ name, version, tools })` extension; value = `McpServer`   tracker tools/issues.ts (serveIssues), tests/tools.test.ts, examples/mcp/{basic,serve,cli}.ts, packages/harness/tests/tools.test.ts
mcp: tools (tag)               binding                                deleted                                                    same
mcp: tool (meta tag), readTool, answerTool   meta read by mcp AND harness   `tool(op, { description, schema })` becomes the ROW builder for mcp; the meta tag form stays exported until a harness ticket migrates `readTool` (expand–contract; harness is out of scope here)   packages/harness/src/{index,claude}.ts, examples/harness/tools.ts
tracker tools/issues.ts        5 ops with `meta: [command(…), tool(…)]` + `issueCommands`/`issueTools` binding arrays   5 plain ops; `issueCommands: Cli.Row[]`, `issueTools: Mcp.Row[]` in the same file   tools/main.ts, tests/tools.test.ts, server/draft.ts (`triage.tools: [listRemote, getRemote]` — harness reads `tool` meta: keep meta on those two ops until the harness ticket, TSDoc why)
```

## drivers/t06 — impact block (import sites, 2026-09-20)

```impact drivers/t06
symbol                                  today                                after                                                   consumers
source()                                extension, reads sync.all + synced meta   `source({ cells })` — rows `[cell, key]` or `[family, label]`; `connect` returns `Promise<Scope.Result>`   tracker server/sync.ts (module `src`), examples/sync/{basic,hono}.ts, sync tests
subscribe(transport)                    extension, reads sync.all            `subscribe(transport, { cells })`                        tracker client/main.tsx, tests/issues.test.ts, examples/sync/basic.ts
sync (binding tag), synced (meta tag), readSynced   scope config + meta      deleted                                                  tracker shared/issues.ts (`meta: [synced({ key: "issues" })]`), server/app.ts, client/main.tsx, tests/{issues,client}.test.ts, examples/sync/*
family(config)                          members carry synced meta            unchanged API; the row `[family, label]` names the key prefix   sync tests, README
tracker server/routes.ts openWire       `opened.origin.connect(wire).then(close, close)`   `.then((end) => { close(); return end })` — no swallow needed   —
core-feedback row "connect rejects on forced close"   open                  done                                                    docs/roadmap/core-feedback.md
```

### drivers/t06 — landed 2026-09-20 (worktree `../tinkered-t06-sync`, branch `drivers/t06-sync`)

- `packages/sync/src/index.ts` 478 → 480: `source({ cells })` / `subscribe(transport, { cells })` read
  flat `Sync.Row` rows (`[cell, key]` / `[family, label]`, the row names the key — family members carry no
  meta); `readPublished(wiring, …)` builds the registry from the rows; `connect` returns the session's close
  `Result` via a per-subscriber `scope.createSession()` handle + `session.close()` (graceful `success` on part,
  forced `cancelled` when the close hook fells the session first — a forced session close rejects as a promise,
  so the `session(fn)` hook shape cannot surface it; the handle is the honest shape). Deleted: `sync` / `synced`
  tags, `readSynced`, `Sync.Meta`, `SyncUndeclared`. `isFamily` stays public (the row discriminator).
- Tracker: `shared/issues.ts` loses `meta`; `server/sync.ts` is `source({ cells: [[issueList, "issues"]] })`;
  `server/app.ts` drops the `sync` tag; `server/routes.ts` `/sync` drops the `Result` (the stream writer
  resolves void, `close()` then runs); `client/main.tsx` is `subscribe(transport, { cells: … })`;
  `tests/issues.test.ts` + `tests/client.test.ts` re-expressed (served asserts `success`).
- Tours: `examples/sync/basic.ts` + `examples/sync/hono.ts` re-expressed; `hono.ts` drops the `Result` like the
  tracker row. Cast-free.
- Sync tests 28 → 30: every promise re-expressed through wiring; new: `connect resolves cancelled on a forced
  root close`, `connect resolves success when the transport closes`, `a row for an unpublished key posted by a
  viewer still closes the transport`, `a row names the key, not the cell label`.
- Deviation: the routes `respond` drops (not returns) the `Result` — `stream`'s `Write` must resolve `void`,
  so the brief's `.then((end) => { close(); return end; })` would not type; behavior is the brief's (close the
  inbox, body ends cleanly; forced cascade → `cancelled` inside `connect`, swallowed there).
- `scripts/validate.mjs`: no edit needed — the sync bundle-export assertion (`m.source && m.subscribe &&
  m.family && m.memoryPair`) names only kept symbols.
- Core feedback: the `source().connect` row is done (see above).
