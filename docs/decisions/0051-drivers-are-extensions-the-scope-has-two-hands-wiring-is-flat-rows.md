# 0051 Drivers are extensions; the scope has two hands; exposure is flat wiring rows; a `session` hook closes the commit gap

Date: 2026-09-20. Status: accepted. Refines: 0034 (tiers: a driver owns sessions), 0039 (hono opens a
session per request), 0042 (the entrypoint owns the scope), 0050 (extensions are middleware on the scope's
verbs; `start` receives the scope). Supersedes: 0039's `tinker(scope)`/`honoApp(scope)` as the public entry,
0042's `command.entry` handle hand-out and `command.all` tag routing, 0046's "a tool is an operation with
description meta" (the description moves to the wiring row), 0048 §3's `sync(cell)` binding tag.

## Context

The issue-tracker audit (2026-09-20) found the scope travelling through five functions in three files, six
wrapper operations, and a hand queue — all because every driver takes the scope as an argument
(`honoApp(scope)`, `tinker(scope)`, `mcpServer(scope, …)`, `run({ scope })`, `command.entry(scope, argv)`),
so userland learns to pass it too. The reshape removed the app's copies but left the drivers' shape.

Exposure was declared three different ways: hono binds route+op as scope tags with no meta on the op; cli
and mcp put `command`/`tool` meta on the op AND bind `commands(op)`/`tools(op)` tags; sync puts `synced`
meta on the cell AND binds `sync(cell)`. Meta as self-description needs a reader that "discovers" units —
magic the user rejected: "meta is useless as meta; a glue will actually do the job".

Two open feedback rows (two askers) came from the same hole: a session's writes never reach the root and
nothing runs "after this session committed", so publish-after-commit is a Hono middleware and
`source().connect` rejects on a forced close.

**The analogy is NestJS, not Spring's classpath scan.** A NestJS module lists its controllers
explicitly; the HTTP driver mounts what the module lists; nobody hands the driver an instance. Ours is
simpler: no decorators — the list itself carries the route, verb, and edges; the driver is an extension
whose `start` is the only hand that holds the scope (ADR 0050 already sanctioned that hand).

## Decision

1. **The scope has two hands.** `createScope` is called at a composition root (`main`, or a test);
   `Extension.start(scope, …)` receives it. No other public function takes `Scope.Handle`. A grep for
   `Scope.Handle` outside roots, `Extension.start`, and tests must print nothing.

2. **Every driver is an extension.** `hono(wiring)`, `cli(wiring)`, `mcp(wiring)`, `source(wiring)`,
   `subscribe(transport, wiring)` return `Scope.Extension<Handle>`; `scope.resolve(ext)` after `ready` is
   the driver handle (the Hono app, the `run(argv)` function, the `McpServer`, `{ connect }`). The
   process edge (listen, stdio, argv, exit codes, `serve`) stays at the root (ADR 0042). A driver
   extension is thin: it uses the scope once to open sessions (hono: `new Hono().use(tinker(scope))`) and
   mounts its rows.

3. **Exposure is wiring: flat rows handed to the extension.** A row is plain data naming the unit and
   the driver's edges: `route.post("/api/issues", createIssue, { input, respond })`,
   `command("get", getRemote, { argv })` (a CLI row may hold `() => import(…)` — the one lazy case,
   ADR 0042), `tool(getRemote, { description, schema })`, `[issueList, "issues"]` for a synced cell.
   Rows go in the extension's constructor, not in scope tags. Drivers read no `meta`. Core's `meta` field
   stays until its own removal ticket (public field on every unit; separate blast radius).

4. **A `session` hook on `Extension`**, the sixth onion, around a session's whole life:

   ```ts
   session?(handle: Handle, next: () => Promise<Result>): Promise<Result>;
   ```

   `next()` resolves when the session closed (commit or rollback) with its `Result`. Code after
   `await next()` runs after the commit — publish-after-commit is an eight-line extension in the app, and
   `source().connect(transport)` resolves with the session's `Result` instead of rejecting on a forced close.

```text
main.ts                                   the first hand
  scope = createScope({ tags, extensions: [hono({ routes, onError }), mcp({ name, tools }), source({ cells }), publishAfterCommit] })
  await scope.ready
  serve(scope.resolve(hono).fetch)

hono.start(scope)                         the second hand
  app.use(tinker(scope))  → per request: createSession
    session chain: publishAfterCommit.session(handle, next)
      end = await next()                  ← request ran, tx committed
      if success: root.run(publishIssues)
```

## Consequences

- Testable at the seam by construction: a test builds one extension with one row on a scope with presets.
- `honoApp`, `tinker` (public), `handle` (public), `route.*` tags, `routes`, `commands`, `command.entry`,
  `tools`, `mcpServer`, `run({ scope })`, `sync`, `synced` leave the public surface — expand–contract per
  package: add the extension beside the old entry, migrate the tracker and the tours, then delete.
- Terms: **driver** stays the role (owns sessions, maps outside work), **extension** the mechanism,
  **wiring** the flat table a driver extension receives.
- Budgets: the `session` chain must be built once at creation and cost nothing when no extension declares
  it (ADR 0050 §5); `createSession` is a hot path (per request) — measured before adoption.

## Alternatives rejected

- **A core `expose(unit)` tag read by every driver** — puts driver rows in core's vocabulary; selection per
  driver needs a second mechanism.
- **Meta on units as the exposure** — needs discovery; the author cannot see from the root what is served.
- **A `sessionClosed` callback** — not middleware; cannot wrap or refuse.
- **Making `run`/`write` hooks fire inside sessions** — measured cost in core/t34, and still no "after close".
