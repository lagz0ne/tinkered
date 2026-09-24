# Building an app on `@tinker/*` — best practices

Date: 2026-09-20. Source: the issue-tracker audit
([contributor audit](roadmap/issue-tracker-v1/audit-2026-09-20.md),
[lead server review](roadmap/issue-tracker-v1/server-review-2026-09-20.md)) read against ADRs
0036–0050 and the tours in `examples/`. Hand this file to the next agent that writes or reviews
an app on the library. The golden example is `apps/playground` (ADR 0049).

## Why an example app exists

An example shows the library's value. Every line must pay into one of three goals:

| Goal                                            | What it means in code                                                                                                                                                                                                                          | How to check it                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fewer lines where the library owns lifetime** | Sessions, commits, cancellation, spans, and errors come from the library; app code does not redo them. On the view side expect more names, not fewer lines (11 cells and 12 operations replaced 36 `useState`); the win there is the next row. | Server: no `new Promise`, no `tail.then`, no manual `close()` of a thing a scope owns. View: no `useState`/`useEffect`; every state has one writer. |
| **Readable**                                    | A reader sees WHAT a thing is from its shape: cell, resource, operation, tag.                                                                                                                                                                  | Every exported unit is one of the four builders. Helpers take values only.                                                                          |
| **Seam-testable with `preset`**                 | A test creates a scope, binds tags, presets the edges, runs operations, reads cells. No server, no DOM.                                                                                                                                        | Each operation has at least one test that is `createScope` + `scope.run(op)`.                                                                       |

## The one law

**Everything is a `data`, a `resource`, or an `operation`.** Config is a `tag`. The composition
root (`main.ts`, or a test) is the only place that calls `createScope`, `scope.resolve`,
`scope.run`, `scope.controller`, `scope.session`, or hands the handle to a driver.

```text
what is it?                        → unit         → who owns it
a value the UI or server reads      → data         → the scope; written only by operations (or a driver)
anything that subscribes, listens,
  polls, connects, opens, streams   → resource     → its scope or session; cleanup is `defer`
anything a user, request, CLI,
  or tool asks for                  → operation    → runs once per call; deps declared; input parsed at the door
an environment choice               → tag          → bound at the root; rebound in a test
none of the above                   → glue         → must justify itself in one TSDoc line, or be deleted
```

A helper is allowed only over **values**: `applyEdit(saved, input, now)`. It never takes a scope,
a session, a controller, or a transaction handle. `tx` and `db` are delivered by `depends`, and
they stay inside the operation body.

## Rules

Each rule: the imperative, the smell to grep, the shape, the goal it pays into.

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                     | Smell (grep)                                                                                                              | Shape                                                                                                                                                                                                                                          | Goal        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | One composition root per process creates the scope, installs extensions, awaits `ready`, closes graceful.                                                                                                                                                                                                                                                                | `createScope` outside `main.ts`/`main.tsx`/tests                                                                          | `const scope = createScope({ tags, extensions }); await scope.ready; … await scope.close({ graceful: true })`                                                                                                                                  | readable    |
| 2   | `Scope.Handle` has two hands: the composition root that called `createScope` (a file, or a test) and an extension's `start`. No other public function takes or returns it. Gate: `scripts/two-hands.sh` (a validate lane).                                                                                                                                               | `Scope.Handle` in any file that does not call `createScope`, outside a driver's `src` and tests                           | `createScope({ tags, extensions: [hono({ routes }), source({ cells })] })` at the root; `extension({ start: (scope, …) => … })` in a driver                                                                                                    | testable    |
| 3   | Declare every operation at module level; a builder function never creates one.                                                                                                                                                                                                                                                                                           | `operation({` inside a `function`                                                                                         | `export const createIssue = operation({ label, input, depends, run })`                                                                                                                                                                         | testable    |
| 4   | An operation owns its work: `depends` deliver values; `run` reads and writes them. No forwarding to a closure.                                                                                                                                                                                                                                                           | `run: (_deps, ctx) => something(ctx.input)` where `something` is not a dep                                                | `depends: { tx: store.tx }, run: async ({ tx }, ctx) => { await tx.insert(…) }`                                                                                                                                                                | fewer lines |
| 5   | Never call `scope.*` inside a `run`, a `factory`, a route body, or a helper.                                                                                                                                                                                                                                                                                             | `scope\.` outside the root and tests                                                                                      | values come from `depends`; drivers read at the edge                                                                                                                                                                                           | testable    |
| 6   | Drivers are extensions and exposure is wiring: flat rows handed to `hono(routes, wiring?)`, `mcp({ tools })`, `source({ cells })`. `@tinker/process`, not a driver, owns argv routing (ADR 0056). No route/tool tags, no meta read by a driver. `scope.resolve(ext)` after `ready` is the driver handle; the process edge (listen, stdio, argv, exit) stays at the root. | `new Hono()`, `honoApp(`, `mcpServer(`, `cli(`, `run({ scope`, `commands(`, `sync(cell)`, `meta: [tool(` read by a driver | `const { extension: web } = hono([route.post("/api/issues", createIssue, { input, respond })], { onError }); createScope({ extensions: [web] }); await scope.ready; serve({ fetch: scope.resolve(web).fetch })`                                | fewer lines |
| 7   | A request's session IS the transaction. Run the domain op with `handle(op)`; the graceful close commits.                                                                                                                                                                                                                                                                 | `scope.session(` inside a route or a saver                                                                                | `handle(createIssue, { input })`; `createIssue.depends = { tx: store.tx }`                                                                                                                                                                     | fewer lines |
| 8   | Every effect is a resource with `defer` cleanup. Nothing is stopped by hand.                                                                                                                                                                                                                                                                                             | `useEffect`, `addEventListener` + manual remove, `.close()` in app code, `let closed = false`                             | `resource({ factory: (deps, { defer, signal }) => { …; defer(() => stop()); return api } })`                                                                                                                                                   | fewer lines |
| 9   | Every form field, notice, filter, and selection is a `data` cell. Components read with `useData`, run with `useRun`.                                                                                                                                                                                                                                                     | `useState`, `useRef` in a component                                                                                       | `const title = data({ label: "draftTitle", initial: "" }); useData(title); useController(title)`                                                                                                                                               | testable    |
| 10  | Read only the slice a component renders.                                                                                                                                                                                                                                                                                                                                 | `useData(wholeList)` in a detail view                                                                                     | `useData(issueList, (l) => l.find(i => i.id === id), sameRevision)`                                                                                                                                                                            | readable    |
| 11  | Config is a tag, never a struct field or a closure.                                                                                                                                                                                                                                                                                                                      | `enabled:`, `baseUrl` on a struct; `process.env` outside the root                                                         | `const draftHelper = tag<{ enabled; baseUrl }>({ label: "draft" }); depends: { draft: draftHelper }`                                                                                                                                           | testable    |
| 12  | One parser per command shared by HTTP, CLI, and MCP. The zod shape is the parser.                                                                                                                                                                                                                                                                                        | `read*Args` beside `parse*Input` beside `*Shape`                                                                          | `input: z.object(createShape).parse`, `meta: [command(…), tool(…)]`                                                                                                                                                                            | fewer lines |
| 13  | No hand-rolled lifetime: no promise tails, waiters, queues, maps of senders, or manual close flags.                                                                                                                                                                                                                                                                      | `tail.then(`, `new Promise<void>`, `settled`, `new Map<string, (`                                                         | serialize in a resource; cancel via `ctx.signal`; wait via `scope.ready` / `close()`. A userland transport that reconnects is the exception: per-attempt promises live inside its factory, per-wire queues in closures, `defer` owns the close | fewer lines |
| 14  | A tagged call opens the session. Do not `createSession` by hand.                                                                                                                                                                                                                                                                                                         | `createSession(`, `session.close(`                                                                                        | `scope.run(draftTurn, { input, tags: [draftGuardrails] })`                                                                                                                                                                                     | fewer lines |
| 15  | Publish committed state from one root-owned place, once, by updating the cell with the returned value.                                                                                                                                                                                                                                                                   | `scope.run(listAll)` after every save                                                                                     | `controller(issueList).update((l) => replace(l, saved))`                                                                                                                                                                                       | readable    |
| 16  | Tests are entrypoints: `createScope({ tags, presets })`, `scope.run(op)`, read cells. Import only the seam.                                                                                                                                                                                                                                                              | a test that boots the whole app to check one op                                                                           | see the recipe below                                                                                                                                                                                                                           | testable    |
| 17  | Pass the frame its tools. `drizzleStore.open(config, { logger })` — keep the `db query` log lines.                                                                                                                                                                                                                                                                       | `open: (path) => openDatabase(path)`                                                                                      | `open: (path, { logger }) => drizzle(new PGlite(path), { logger })`                                                                                                                                                                            | readable    |

## The seam test recipe (rule 16)

```ts
import { createScope, preset } from "@tinker/core";
import { createIssue, editIssue, listIssues, store, issueList } from "../src/index.ts";

const scope = createScope({ tags: [store.config(undefined)] }); // in-memory PGlite
const saved = await scope.run(createIssue, {
  input: { title: "First", description: "x" },
  tags: [],
});
const all = await scope.run(listIssues);
expect(all.map((i) => i.title)).toEqual(["First"]);
await scope.close({ graceful: true });
```

`preset(node, replacement)` swaps an edge for one test: an endpoint operation (`postIssue`), a
fixed clock via `makeTestClock`, a fake harness `query`. The operation under test does not change.

Preset the node the app owns, not the transport under it. An app test never binds a fake on the
`backend` tag: that is `@tinker/http`'s own seam, and a route table matched by method and URL is
a second server. The node itself must speak every outcome a test wants to preset — a 409 is
raised as `IssueConflict` by `patchIssue`, so a preset rejects with the same error the graph
handles (2026-09-21, `tracker/preset-seam`). Each test builds its own scope and counts calls in
its own closure; a shared boot helper hides which edges a test needs.

## The issue tracker, classified

What each thing in `apps/issue-tracker` is, after the 2026-09-20 reshape (`a098dc3`). The last column is what the audit found before it.

| Thing                                    | Unit                         | Owner                   | Today                                              |
| ---------------------------------------- | ---------------------------- | ----------------------- | -------------------------------------------------- |
| saved issue list                         | `data` (`issueList`, synced) | server scope            | ✔ `shared/issues.ts:306`                           |
| PGlite client / transaction              | `resource` (drizzle frame)   | scope / request session | ✔ `store.ts`; but `logger` dropped                 |
| create / edit / comment / read / list    | `operation`                  | module level            | ✔ `operations.ts`; wrapped again in `app.ts:58-84` |
| HTTP routes                              | `tag` (`route.*`)            | root                    | ✘ hand-mounted on `new Hono()`                     |
| serial save queue (PGlite is 1-conn)     | `resource` (scope)           | scope                   | ✘ closures over `scope` in `bridge.ts:44-63`       |
| publish-after-commit                     | root-owned write, one place  | root                    | ✘ `publishList(scope)` re-reads the table          |
| draft on/off, public base URL, data path | `tag`                        | root                    | ✘ `Booted.Draft` struct                            |
| sync source / subscribe                  | extension (driver)           | root                    | ✔                                                  |
| SSE wire per tab                         | `resource` (session)         | request session         | ✘ inline in the route + `owned` wrapper            |
| harness draft turn                       | `operation` + tagged call    | request session         | ✘ `runDraft(owner)` hand-manages a session         |
| live draft text / status                 | `data` (harness cells)       | draft session           | ✔ cells exist; watched by hand                     |
| browser tab connection                   | `resource` (scope)           | tab scope               | ✘ `connectTab` imperative                          |
| form fields, notices, filter, selection  | `data`                       | tab scope               | ✘ 36 `useState`, 6 `useEffect`, 3 `useRef`         |
| submit / save / comment / reconnect      | `operation`                  | module level            | ✘ `async function submit(event)` in components     |
| CLI / MCP tools                          | `operation` with meta        | module level            | ✔ `tools/issues.ts`                                |

## Target file tree

```text
apps/issue-tracker/src/
├── errors.ts                 # registry (keep)
├── shared/
│   ├── issues.ts             # parsers + issueList cell (keep)
│   └── draft.ts              # parsers (keep)
├── server/
│   ├── store.ts              # drizzle frame, logger wired
│   ├── operations.ts         # 5 domain ops (keep) + saveQueue resource
│   ├── routes.ts             # route.* tag bindings + onError
│   ├── sync.ts               # SSE transport as a session resource
│   ├── draft.ts              # triage harness + draftTurn (keep); no runDraft
│   └── main.ts               # THE root: createScope, hono, ready, graceful close
├── client/
│   ├── api.ts                # http ops (keep)
│   ├── state.ts              # form/selection/notice cells
│   ├── actions.ts            # submit/save/comment/reconnect operations
│   ├── connection.ts         # tab connection resource (EventSource + subscribe)
│   ├── App.tsx               # reads cells, runs ops; no hooks but useData/useRun/useResource
│   └── main.tsx              # THE root for the tab
└── tools/issues.ts           # CLI + MCP ops (keep)
```

Deleted: `server/bridge.ts`, the six wrappers in `app.ts`, the draft stream scaffold, the
`owned` transport wrapper, every `useState`. Measured after the reshape: server 992 → 802 lines, client 1169 → 1941,
source 2.9k → 3.6k, tests 2.2k → 2.8k. The server shrank; the view grew into named, headless-tested units.

## Known gaps in the library (do not paper over them silently)

Recorded in [core-feedback.md](roadmap/core-feedback.md), 2026-09-20 rows. When one of these
forces glue, write the glue in ONE named place with a TSDoc line that names the gap.

1. A session's cell write does not reach the root cell; there is no "after this session committed" hook.
2. ~~hono's `route.input` is not awaited, so JSON bodies are read outside `handle`.~~ Closed 2026-09-20: `input` may return a promise; a rejected read is `InputRejected` → 400.
3. ~~hono's `stream` `emit` is not safe from a sync `Transport.send`.~~ Closed 2026-09-20: `emit` is synchronous.
4. No built-in way to run one call at a time on a single-connection store.
5. No documented form-cell pattern for React.
