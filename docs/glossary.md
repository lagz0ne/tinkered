# Glossary

| term                 | meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| public seam          | The one surface tests may touch: the package entry `src/index.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| behavior test        | A test that names one public cause and checks one decisive public outcome through the seam.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| fixture              | Setup at the top of a test file, built with the public API, shared by that file's tests.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| error registry       | `src/errors.ts` in a package: every error name and its payload type, the only place code throws from.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `isError(e, "Name")` | Guard that narrows an unknown error to one registry entry; on mismatch the caller rethrows.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `isX`                | A type discriminator. Checks the smallest stable shape needed to narrow; not a runtime safety wall.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `readX`              | The reader that does any real admission once and captures the facts later code needs.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| process edge         | Where data enters from outside: network, fs, env, argv, user input. Validated once there.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| layer word           | A name part that says where code sits, not what it is: `Runtime`, `Manager`, `Handler`, `Wrapper`, `Base`. Banned.                                                                                                                                                                                                                                                                                                                                                                                                                |
| handle               | An object a caller holds to use a thing. Its config sits on it as plain fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| owner                | Who may mutate and release a value at a handoff: borrow, transfer, or retain.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| census               | `style-census.sh`: grep counts of forbidden (S*, T*) and watched (W*) patterns.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| strict               | Census mode where any S* or T* hit fails. Ends with `Style census: OK` or `FAIL`.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| TSDoc                | A `/** */` comment on an exported interface or function. The only allowed comment.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| YAGNI                | Build only what current behavior needs; no options or hooks for a future caller.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| concept namespace    | `export declare namespace X { ... }` holding every type of one concept; `X.Handle` is what `createX()` returns.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| unit / span          | One tracked piece of work; opened when an operation or resource resolves. Units nest by explicit parent into a tree.                                                                                                                                                                                                                                                                                                                                                                                                              |
| exporter             | An extension (`onStart`/`onEnd`) that consumes spans; its failures are isolated and never fail application work.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| behavior-neutral     | Observation never changes results or value identity; the core wraps no user value. Deep client tracing lives in adapters.                                                                                                                                                                                                                                                                                                                                                                                                         |
| data                 | The only reactive value: a cell. Read/watch/set. No separate derive/compute unit.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| dependency mode      | How a dep is taken: **read** (bare `data` → the value) or **write** (`data.controller` → get/set/watch handle). A bare resource slot delivers its **built value** — never a promise (ADR 0044); a bare operation delivers a subflow.                                                                                                                                                                                                                                                                                              |
| derivation           | A pattern, not a unit: an operation/resource writes a `data` cell (write-mode dep) that others watch; or a consumer watches sources and combines them.                                                                                                                                                                                                                                                                                                                                                                            |
| operation (command)  | A function with typed `input`; runs on each `run(call)` (`scope.run(op, call)` or a controller's `run`); may have effects; not reactive, not memoized. Never `resolve`d — it has no snapshot (ADR 0036).                                                                                                                                                                                                                                                                                                                          |
| resource             | A reusable unit built once per owner: `scope.resolve(r)` / `controller(r).resolve()` builds-and-caches (sync path allocates no promise), `controller(r).get()` returns the built instance or fails `NotResolved`. Deps resolve at the owner. Declared deps are built BEFORE the body runs; an async build is a build detail — core awaits a still-building dep, then runs the body with the value — and async-ness is typed through the graph: a body over an async resource must return a promise (`Scope.AsyncBody`, ADR 0044). |
| defer                | `ctx.defer((end) => ...)` on an operation or resource ctx: the one lifetime hook (replaced `cleanup`+`onOutcome`, ADR 0024). Runs in reverse-registration LIFO when the owning layer closes/releases; `end.status` (`success`/`failed`/`cancelled`/`released`) drives commit vs rollback.                                                                                                                                                                                                                                         |
| subflow              | Depending on an operation delivers a subflow: always a callable (never a value), invoked as `deps.op.run({ input?, rawInput?, tags? })`; `tags` open a child session for that call (ADR 0038); tracked as a nested span (ADR 0020, 0022, 0036).                                                                                                                                                                                                                                                                                   |
| stream               | Streaming = a producer writing a `data` cell over time; consumers `watch`. Self-managed by scope/session; `ctx.signal` cancels (a clean end, not a failure). Pull/every-chunk is an adapter (ADR 0021).                                                                                                                                                                                                                                                                                                                           |
| session              | A child scope layer; an owned lifetime boundary closed structurally (children first, then teardown).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| namespace            | A branded key from `namespace(opts?)`; its `tags` bind settings to that key. One layer can store separate values under separate keys (ADR 0059). |
| namespace chain      | `ns: [a, b]`: reads walk each key then the default, nearer layers first. Whatever the resolve stores is kept under the first key, not where an input was read from. |
| resolve namespace    | The namespace a resolve stores into: the first key of its chain (a call's `ns`, else the ambient one). Every node the resolve builds or writes is kept there unless its own declaration says otherwise (ADR 0064). |
| ambient namespace    | The `ns` set on `createSession({ ns })`, inherited by children and calls unless one call supplies its own `ns`. |
| resource target      | `scope`: one root build shared by all; `namespace`: one root build per namespace; `session`: one build per session per namespace (ADR 0064). Dependencies bind at the owner. `scope` is today's one declared way to keep a node outside the resolve namespace. |
| target               | A resource's `target`; see resource target. |
| release              | Reset a node and cascade to its downstream dependents so they rebuild; mainly a frontend feature (server uses `close`).                                                                                                                                                                                                                                                                                                                                                                                                        |
| preset               | A test-only replacement of a node's realization; only downstream consumers see it. Never a production seed.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| meta                 | Static metadata on any unit (data/operation/resource/tag, incl. a tag itself): a list of tag bindings fixed at definition, read via `handle.meta` or `tag.read(unit)`. Inert — never affects resolution (ADR 0023).                                                                                                                                                                                                                                                                                                               |
| bindings (authored)  | `Tag.Bindings`: the shape every `meta`/`tags` input takes — one binding, nothing (`null`/`undefined`/`false`), or a list of those to any depth (the `clsx` / ESLint flat-config precedent). Flattened once, in order, where it lands; a call whose tags flatten to nothing is untagged (ADR 0022, 0023 amended 2026-09-21). |
| onClose              | Userland teardown hook registered from outside on a scope/session handle; it is a `defer`, interleaved in the same reverse-registration LIFO as resource-internal defers.                                                                                                                                                                                                                                                                                                                                                         |
| close / shutdown     | `close(opts?: { graceful?: boolean })` shuts a scope down and resolves a `Result` (never throws, ADR 0027). A MODE, not a wished outcome (ADR 0028): FORCED (default) aborts `ctx.signal` and rolls resources back (`cancelled`); GRACEFUL lets in-flight work finish and commits (`success`).                                                                                                                                                                                                                                    |
| outcome              | A layer's settled state, decided by REALITY, not a wish (ADR 0028): `failed` (its body threw, an owned-work op rejected, or a descendant really failed — bubbled up) > `cancelled` (its work was interrupted / a forced shutdown) > `success`. Reported in the close `Result`; a `defer` sees it as `end.status`.                                                                                                                                                                                                                 |
| owner-context        | A node resolves deps and registers cleanup at its owning layer and bubbles up from there; a scope resource needing a session-only required tag is a normal `MissingTag`.                                                                                                                                                                                                                                                                                                                                                          |
| brand                | A module-private `unique symbol` a factory stamps on a unit; never exported, so it can't be named/imported outside. A provenance signal (not tamper-proof); guards assert only its presence (ADR 0019).                                                                                                                                                                                                                                                                                                                           |
| ambient capability   | A cross-cutting runtime service carried on `ctx` — `signal`, `defer`, `obs`, `log`, `clock`, `random` — configured once at the scope and inherited by sessions; never wired via `depends`. Contrast a dedicated capability (a resource you depend on) and a driver (owns a scope) (ADR 0034, 0062).                                                                                                                                                                                                                               |
| log level            | Where a log line sits on pino's numeric scale, carried on `ctx.log` (an `Observe.Logger`): the bare `ctx.log(msg)` and `ctx.log.info` are `info`, plus `debug` / `warn` / `error`; the named rungs are the exported `LEVELS` constant (`debug` 20, `info` 30, `warn` 40, `error` 50). A sink reads `Observe.Log.level` to color or drop; `Observe.Config.level` drops every line below a threshold before it allocates (ADR 0061). |
| clock                | The ambient time source on every ctx (`ctx.clock`): `currentTimeMillis()` / `currentTimeNanos()` / `sleep(ms, signal?)`. Default `systemClock`; set once via `createScope({ clock })`; inherited by sessions. Effect's default-service model; cancellation is explicit via `ctx.signal` (ADR 0034).                                                                                                                                                                                                                               |
| TestClock            | `makeTestClock({ now })`: a `Clock` plus `advance(ms)` / `setTime(ms)` that resolves due virtual sleeps. The mock-free seam for time-dependent code — no `Date.now` mock, no fake timers, no `preset` (ADR 0034).                                                                                                                                                                                                                                                                                                                 |
| random               | The ambient randomness source on every ctx (`ctx.random`): `next()` (a float in `[0, 1)`) / `uuid()` (a v4-shaped id). Default `systemRandom` (`Math.random` / `crypto.randomUUID`); set once via `createScope({ random })`; inherited by sessions. Both reads are synchronous — Effect's default-service Random, simpler than the clock (no wait, no signal) (ADR 0062).                                                                                                                                                          |
| TestRandom           | `makeTestRandom({ seed })`: a `Random` backed by a seeded mulberry32 generator — the same seed replays the same `next()` and `uuid()` stream. The mock-free seam for random-dependent code, no `Math.random` mock and no `crypto` stub (ADR 0062).                                                                                                                                                                                                                                                                                |

## React adapter (`@tinker/react`)

| term                                       | meaning                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adapter                                    | The React binding is an adapter, not a store: it adds no state/cache/reducer, only subscribes to core and provides its `Handle` on Context (ADR 0030). React-aware observation lives here (core stays behavior-neutral).                                                           |
| `ScopeProvider`                            | Puts a scope `Handle` on React Context. `scope={handle}` uses an app-owned scope; `create={() => createScope(opts)}` creates/owns/closes it on unmount (the easy path, used in tests). Presets/tags/observe flow through here.                                                          |
| `SessionProvider`                          | Creates a child session on mount, closes it on unmount — a React subtree's mount lifetime IS a core session lifetime; unmount forces the close (ADR 0031). Effect-created, ref-guarded, StrictMode-safe.                                                                           |
| nearest Handle                             | Hooks resolve `getController` against the nearest provider's `Handle`; core routes by `target` (`scope` shared app-wide, `session` one-per-`SessionProvider`). Hooks never reach past the nearest session (ADR 0031).                                                              |
| `useData`                                  | Reactive read of a `data` cell via `useSyncExternalStore` over `watch`/`get`. `useData(cell)` returns the value; `useData(cell, selector, isEqual?)` subscribes to a slice via the with-selector shim.                                                                             |
| `useData(cell, { writable: true })`        | The same subscription plus the cell's `set`: `[value, set]` (or `[slice, set]` with a selector). An option, not a second hook.                                                                                                                                                     |
| `useController`                            | Returns a cell's full `DataController` (`get`/`set`/`update`/`watch`) for writes. A write-only component subscribes to nothing.                                                                                                                                                    |
| `useResource`                              | Suspends: returns a resource's built value, handing an async build to `use()` (a `<Suspense>` fallback shows; a rejected build throws to the error boundary). Query-like (ADR 0032).                                                                                               |
| `useResource(handle, { suspense: false })` | Query shape for a resource: `{ status, data, error, isPending, isSuccess, isError, refetch }`, never suspends or throws; `refetch` = release + rebuild (ADR 0032).                                                                                                                 |
| `useResolve`                               | Imperative, never suspends: react-query mutation shape for an operation — `resolve(input)` fires and forgets into `status/data/error/variables`, `resolveAsync(input)` returns the value or rejects, `reset()`, status booleans, `onSuccess/onError/onSettled` options (ADR 0032). |
| `useRelease`                               | Returns a thin `release(cellOrResource)` over `scope.release`, for retry/reset UIs (pairs with an error-boundary reset to rebuild a failed resource).                                                                                                                              |
| `useSpans`                                 | Returns the scope's bounded span history (a snapshot read each render; empty when observation is off) for an inspector/devtools view — not push-reactive (core exposes no span subscription).                                                                                      |

## HTTP client (`@tinker/http`)

| term                       | meaning                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frame                      | A pre-wired graph of core primitives (tags, a resource, operations to depend on) with slots the user fills; nothing runs until an operation resolves (ADR 0035). `tinkerer({ label })` and `harness({ label, adapter })` return one; http has none — `httpClient` is retired by ADR 0060 and its units (`send`, `attempt`, `config`, `backend`) are declared.                                                                                                                                                                                                                           |
| slot                       | A placeholder in a frame that the user fills at the scope (a tag binding: `backend`, `x.config`) or at definition (an endpoint's `request`/`response`, the frame's `retry`).                                                                                                                                                                                                                                                 |
| backend                    | The one function that sends a request: `(request, signal) => Promise<HttpResponse>`. A shared tag with default `fetchBackend`; swap it at the scope or session. Pooling/caching live inside a backend (Go's `Transport`; Effect's `Fetch` tag).                                                                                                                                                                              |
| config tag                 | A frame's own tag (`github.config`) carrying `baseUrl`/`headers`; one per client. Read per call by the endpoint (`.all`, merged nearest-wins), so a scope, a session, or a subflow call's `tags` may each contribute (Effect's `RequestInit` tag, per client).                                                                                                                                                               |
| client resource            | The frame's scope-target resource, `{ execute(request, ctx) }`: merges config, sends via the backend, retries transient failures, opens a span, logs. `ctx` is the CALLER's ctx, so cancel/obs/log/clock need nothing new.                                                                                                                                                                                                   |
| endpoint operation         | The author declares it: `operation({ label, input?, depends: { send }, run })` — `send` merges config, validates the URL, and retries under the merged `retry` config (default: never) (ADR 0035, 0058). `x.operation` is retired by ADR 0060.                                                                                                                                                     |
| source                     | The adapter-specific object a backend attaches to a response (the web `Response` for `fetchBackend`) beside the common base (`status`, `headers`, body readers).                                                                                                                                                                                                                                                             |
| transient failure          | What `retry` retries: a `RequestFailed` with reason `Transport`, or status 408, 429, 5xx. Never after the signal aborted. Backoff sleeps on the caller's clock.                                                                                                                                                                                                                                                              |
| resolve / controller / run | The three scope verbs (ADR 0036): `resolve(x)` reads the snapshot in dependency form (data value, built resource, tag value); `controller(x)` gives back control (data get/set/update/watch, resource resolve/get, operation run); `run(op, call?)` runs an operation now. `run({ depends?, run }, { input?, tags? }?)` runs an **inline operation**: same path, span, ctx, and cancel; no identity so no preset (ADR 0037). |
| tagged call                | `run(x, { tags })` on a declared or inline operation, or on a subflow: sugar for `session({ tags }, (s) => s.run(x, …))` — a child session for that run. Its subflows and its session-target resources see the tags; scope-target resources never do; a session-target resource is per flow (ADR 0038).                                                                                                                      |

## Hono driver (`@tinker/hono`) — an extension the scope owns (ADR 0051, 0060): `hono(routes, wiring?)` returns `{ extension }` — install it with `createScope({ extensions })`, and `scope.resolve(ext)` after `ready` is the Hono app; `wiring` holds `onError?`, `tags?`, `ns?`, `mount?`, `serve?`; `route.<verb>(path, op | loader, { input?, respond? })` returns a plain row; `tinker`/`handle`/`honoApp`/`routes` are gone from the surface

| term            | meaning                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| driver          | An integration that maps outside work onto sessions of a scope it does NOT own: the entrypoint (`main`, or a test) creates and closes the scope; the driver receives the handle once, in its extension `start`, and never exposes it to userland (ADR 0039, tiers in ADR 0034).                                                                                                                                                                |
| request session | The session the extension's middleware opens per request, bound with `request(raw)` plus the request-derived `tags(c)`; force-closed on client abort, closed after the handler returns — or, for a streaming route, when the body finishes (ADR 0039, 0040).                                                                                                                                                                            |
| `handle`        | RETIRED by ADR 0051: a route is a `route.<verb>` row. |
| `request` tag   | The web `Request` of the current request, bound on the request session for the rare operation that needs headers; keeps operations framework-free.                                                                                                                                                                                                                                                                                      |
| `stream`        | `stream(c, op, call?)`: answers a streaming Response whose body is the declared operation `op`; the run binds the `emit` tag, read with `depends: { emit: emit.required }`, and the session stays open until the body finishes or the client cancels (ADR 0021, 0040). Every other response closes the session after `next()`.                                                                                                                                                                                                                             |
| `onError` slot  | `hono(routes, { onError })`: runs before the default map (parse failure 400, cancelled 499, MissingTag/NoSession 500, else rethrow to Hono) and may answer a failure with its own Response (ADR 0040).                                                                                                                                                                                                                                 |

## Drizzle store (`@tinker/drizzle`)

| term          | meaning                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| store         | `drizzleStore({ label, open, close? })`: the frame — a required `config` tag, a scope-target `db` resource (`open` once, `close` in `defer`), a session-target `tx` resource (ADR 0041).                                                                      |
| `tx` resource | The session's transaction: `db.transaction(cb)` held open for the session; its `defer` commits on `end.status === "success"` and rolls back on `failed`/`cancelled`/`released`, awaiting the commit before the close resolves. One per request session in v1. |
| `db query`    | The one log line per statement: Drizzle's logger bound to the `db` resource's `ctx.log`, `{ sql }` only — params are data and never logged.                                                                                                                   |
| core feedback | The section every integration report ends with; candidates live in `docs/roadmap/core-feedback.md` and become core tickets when a second integration asks or the workaround is dishonest.                                                                     |

## CLI driver (`@tinker/cli`) — RETIRED by ADR 0056, replaced by `@tinker/process`. Until ADR 0051 it was a driver extension: `cli({ name, version, commands })`, value = `run(argv, io)`; `command(name, op | loader, { input?, respond?, description? })` and `command.entry(name, (argv) => …)` return rows; `runMain(wiring, scope?)` is root glue; the `commands` tag, `command` meta, and `run({ scope })` are gone

| term              | meaning                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| entrypoint driver | RETIRED by ADR 0056: no driver creates a scope. The app owns the root; a driver receives one. The entrypoint is `@tinker/process` — the process is tags, a command is an operation, routing runs outside any scope. A test's `run` is the same without process wiring (ADR 0042).                                                                                                                |
| command binding   | RETIRED by ADR 0056: a command is a `Process.Route` (`{ name, description?, entry }`), not a tag binding.                                                                                                         |
| command meta      | RETIRED by ADR 0056: a command is a plain operation that answers an exit code; the meta tag and `commands(op)` are gone. |
| loading policy    | Follows the process: a CLI loads only the selected command (usage loads nothing); a server imports every route at mount and warms pools at boot via `scope.resolve`. Frames are cheap to import: driver imports live inside `open`/loaders.                                                                                                          |
| exit codes        | 0 success · 1 failure · 2 usage or the operation's `parse` failure · 130 interrupted (SIGINT/SIGTERM).                                                                                                                                                                                                                                               |
| lazy module       | A resource whose factory imports: `resource({ factory: () => import("./x.ts").then((m) => m.op) })`. Built once per owner on first `resolve`, cached, presettable, spanned. The lazy unit — no separate primitive (ADR 0042, core-feedback register).                                                                                                |

## Harness (`@tinker/harness`)

| term          | meaning                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| harness       | An agent loop with its own tools, sessions, permissions, and events (Claude Code via the Claude Agent SDK; Codex via the Codex SDK). Not an LLM API. `harness({ label, adapter })` is the frame (ADR 0043).                                                                                                                                                   |
| adapter       | A scope resource whose factory imports the harness SDK (the module is itself a resource — `claudeCode.sdk` — and the test seam) and returns `Harness.Backend`: `start(options, hooks) → Thread` with `run`/`close`; the thread stops its SDK call on `hooks.signal`. Its `options` tag is the SDK's own thread-level options type, never a normalized config. |
| thread        | The session resource: one harness thread per session, started with the session's merged options (or resumed by `x.resume(id)`); a forced close aborts its signal (the turn settles `cancelled`) and then `close()`s it; a graceful close waits for the turn.                                                                                                  |
| ambient state | What the thread knows, as data cells any operation in the session may read or watch: `status`, `text`, `items`, `usage`, `id`, and `events` (the raw SDK events, the `source`). Static facts live in the options tag.                                                                                                                                         |
| send          | `x.send`: the frame's one operation to depend on — one harness turn, whose input is the adapter's own turn and whose result is the SDK's own result. The thread, the cells, and the tool/approval slots are its `depends`, so each tool and approval runs as a subflow (ADR 0043, 0058).                                                                                                                                           |

## MCP driver (`@tinker/mcp`) — since ADR 0051 a driver extension: `mcp({ name, version, tools })`, value = the `McpServer`; `expose(op, { description, schema })` returns a row; `mcpServer` and the `tools` tag are gone; the `tool` meta tag stays for the harness until its own ticket

| term      | meaning                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tool      | An ordinary operation carrying `tool({ description, schema, respond? })` on its `meta` (ADR 0046): `schema` is a zod raw shape (also the op's `input` parse), `tool.read(op)` gives any driver or adapter the facts. The op's label is the tool name.  |
| tools     | The binding tag: `tools(op)` on a scope or session; a driver reads the table with `scope.resolve(tools.all)`.                                                                                                                                          |
| mcp | The driver extension (ADR 0051, 0060): `mcp({ name, version, tools })` returns a `Scope.Extension`; install it, and `scope.resolve(ext)` after `ready` is the MCP SDK's own `McpServer` with one tool per row; each call is a session running an inline op `mcp <name>` with the tool as its subflow; the harness gets `mcpServers` config. `mcpServer` is retired by ADR 0051. |

## Jev advisory layer (`tools/jev/`)

| term           | meaning                                                                                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| impact block   | A fenced ` ```impact <tag> ` block in a track's `PROGRESS.md`, written by the lead before the code: one line per symbol — package, exact SCIP display name, the files expected to define or reference it (`(none)` = must be gone). The plan's declared blast radius (ADR 0047). |
| discrepancy    | One mismatch between the impact block and SCIP's actual refs: an unexpected file, a missing file, or an undeclared public export in the diff. Found by plain code, no model; each gets exactly one yes/no question to Jev.                                                            |
| impact verdict | Per discrepancy, the fixed mapping of Jev's answer: source wrong · plan wrong · both · neither (no discrepancy) · unclear → human (probability inside 0.4–0.6). Advisory; never a gate.                                                                                          |

## Sync (`@tinker/sync`)

| term            | meaning |
| --------------- | ------- |
| synced cell     | A `data` cell carrying `synced({ key })` meta: the same module imported on both sides; its `parse` is the edge for a snapshot from the wire (ADR 0048). |
| family          | `family({ label, initial, parse?, eq? })`: `(id) => Data.Cell<T>`, memoized per id, each member a synced cell keyed `label/id`. A cell with an id; `onMember` fires once per new member. |
| identity        | The key a family member syncs under: `label/id`. Matching between a client and its source is by family and identity. |
| registration    | The client scope's `sync(cell \| family)` bindings, sent as `register { keys }`: every bound singleton and every member the client holds (new members register the moment they exist). Nothing is pushed unasked. |
| source          | `source()`: the source extension installed with `createScope({ extensions })` — `{ connect(transport) }` opens a session per subscriber, answers each `register` with the initial snapshots (an inline op `sync register`), then fans out every change on a registered key. The scope's cells are the truth. |
| subscribe       | `subscribe(transport)`: the client extension installed with `createScope({ extensions })` — registers by identity, writes each `snapshot` into the cell through its parse, `close()` detaches. One way in v1: a local write stays local until the next snapshot. |
| transport       | `Sync.Transport = { send, onMessage, onClose, close }` — userland's wire (SSE+POST, WebSocket, postMessage); the package ships only `memoryPair()`, the test seam. |
| version         | A per-key integer the source bumps on each change; rides on every snapshot. |

## Extensions (core, ADR 0050)

| term            | meaning |
| --------------- | ------- |
| extension       | `Scope.Extension`: middleware over the scope's verbs — any of `start`, `resolve`, `run`, `write`, `close`, each an onion layer `(…, next)`; installed by the composition root via `createScope({ extensions })`, root handle only in v1; session calls and writes through operation dependencies bypass the hooks. `start` receives the scope handle — with the composition root, one of the two hands (ADR 0050, 0051). |
| hook chain      | The per-verb onion built once at creation from the extensions that declare that hook; registration order, first is outermost; a verb with no middleware keeps its direct call (pays nothing). |
| ready           | `scope.ready`: a promise settled when every `start` chain settled; a rejected start rejects it and force-closes the scope (`failed`). No extensions → already resolved. |
| extension value | What a `start` chain returned, read with `scope.resolve(ext)` once ready (`NotResolved` before). `source()` → `{ connect }`, `subscribe(transport)` → `{ close }`. |

## Drivers as extensions (core + drivers, ADR 0051)

| term         | meaning                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| two hands    | The only two places a `Scope.Handle` may appear: the composition root that called `createScope`, and an extension's `start`. Everything else declares `depends`.       |
| driver       | Still the role (ADR 0034): an integration that maps outside work onto sessions. Under ADR 0051 every driver is an extension; its `start` is its one use of the scope. |
| wiring       | The flat table a driver extension receives: rows of plain data naming a unit and the driver's edges (`route.post(path, op, { input, respond })`). Not tags, not meta. |
| session hook | `Extension.session(handle, next)`: the onion around a session's life; `next()` resolves with the close `Result`, so code after it runs after the commit.              |

## Blueprint (`@tinker/blueprint`, ADR 0052)

New sections are lists, one term per item (vertical layout,
`docs/writing-style.md`).

- **blueprint** — A YAML list of nodes describing a tinker app
  before its code exists: the `.d.ts` of the app.
  Parsed by zod at the door.
- **node** — One entry of a blueprint: a kind (`data`,
  `resource`, `operation`, `tag`), a `name` (no dots),
  its `depends` (exact node names), one `promise`
  sentence, one `why` sentence (required), and its
  `work` in one line.
- **template** — One shipped question: `id`, `applies` (kinds),
  `needs` (node fields), `ask`, `true`, `false`.
  Jev answers it about one node and its one-hop neighbours.
  Never holds string holes.
- **corpus** — The folder of templates inside the package
  (`packages/blueprint/corpus/`). The only source of
  questions; grows by commit.
- **eval** — A small blueprint with `target` and `expect` under
  `evals/<id>/{bad,clean}/`. A template whose evals pass the
  bar (bad ≥ 50%, clean < 50%, gap ≥ 30) may set the exit
  code; the rest print `~`.

## Authoring: the graph and its trace (ADR 0058)

- **the rule** — A step worth seeing in a trace is
  an operation; a helper inside one step is a plain
  function. The test: would I want this step in a
  trace, or to preset it?
- **a frame supplies units** — `harness({ label,
  adapter })` exposes `send`; `tinkerer({ label })`
  exposes `turn`; http declares `send` and
  `attempt` outright. A frame never builds the
  author's operation, so `depends` and `run` stay
  on the page.
- **the graph produces the trace** — core opens a
  span per operation and nests by subflow, gated on
  `observing`. Work in a plain function gets none of
  it, which is why three packages hand-rolled spans.
- **span-tree test** — One test per package that
  runs a real flow and asserts the shape of
  `scope.spans()`. It fails when a step slips back
  into a plain function; the advisory judges only
  point.
- **step line** — The log line core writes when an
  operation's span closes: its label, `ms`, and
  outcome; `debug` when ok, `error` when failed. It
  needs observing and a `log` sink. A package's own
  line keeps its domain fields and no `ms`.
- **one mechanism per idea** — Per-call config is
  `tags` on the run (ADR 0038). A merge helper lives
  inside the unit that needs it, never at the call
  site.

## Authoring: factories and units (ADR 0057)

- **unit** — An `operation`, `resource`, data cell,
  or `tag`. Its identity is its cache key: core
  keys builds, cell state, controllers, and presets
  on the handle itself.
- **declared once** — A unit is built where its
  module is evaluated. A unit minted per call, per
  request, or in a loop defeats every cache and
  silently loses cell writes — a component defined
  inside render.
- **construction-time factory** — A factory that
  returns a unit (a frame: `tinkerer({ label })`,
  `harness({ label, adapter })`). A composition
  root or a frame calls it once. It may never be
  called in a userland loop.
- **row** — Plain data naming a unit
  (`{ op, meta }`, an inbox entry, a route). It
  carries no identity, so a factory that returns
  one (`expose`, `tool`, `steer`, `queue`) is free
  to call anywhere.
- **narrowing builder** — A builder whose parameter
  accepts less than the slot it fills, so the raw
  unit can do what the builder forbids. Deleted on
  sight; `tinkerer`'s `gate()` was one.

## Process entrypoint (`@tinker/process`, ADR 0056)

New sections are lists, one term per item.

- **process tags** — `argv`, `env`, `io`: what the
  process gives a run, bound once at the root and
  unchanged during it. No `signal` tag: every
  operation already has `ctx.signal`.
- **command** — An operation that answers an exit
  code. What it needs it declares. `command(name,
  op, { input?, respond? })` is the sugar for a
  plain operation (ADR 0042's rule survives).
- **route** — `{ name, description?, entry }`:
  `entry(rest)` answers the operation plus the
  root options for those args. Runs outside any
  scope, so `help` builds no root.
- **execute** — The one place a root exists for a
  command: build it from the entry's options plus
  the process tags, run the operation, close,
  answer the code.
- **run** — The seam: `run(shell, argv, io?,
  signal?)` answers `{ code, stdout, stderr }` and
  touches no process.
- **main** — The process edge and the only side
  effect: argv in, SIGINT and SIGTERM to one
  abort, exit with the code.

## Tinkerer (`@tinker/tinkerer`, ADR 0053)

- **tinkerer** — Our own agent loop on core: a frame
  `tinkerer({ label, tools })` whose turn calls a chat
  model, runs the tool calls it asks for as subflows,
  and repeats until a reply has no tool call. The
  `harness` row stays the SDK-owned loop; this one is ours.
- **step** — One model call: an `@tinker/http` endpoint
  (`POST /chat/completions`, read with `res.sse()`).
  One span per step.
- **transcript** — The `messages` cell: chat-completions
  message objects as sent and received (the wire shape).
  One conversation per session.
- **settings** — The session cell `{ mode, options }`: our
  `mode` plus the provider's own request fields (model,
  reasoning effort, token cap). Seeded from the `mode` and
  `config` tags at turn start; read at every step and
  every tool call; written only inside the session.
- **mode** — The policy string on `settings`, Codex's
  `approvalPolicy` shape: `read-only` (read),
  `workspace-write` (read, edit, write under `cwd`),
  `full-access` (all four, bash included). A blocked call
  returns an error result to the model.
- **inbox** — The cell of pending user entries
  `{ kind, content, mode?, options? }`. `queue` waits
  until the model would stop; `steer` aborts the step in
  flight, then patches `settings` before the next step.
- **persist** — An extension on the `session` hook that
  `watch`es the transcript on the session's own handle and
  appends JSONL per session; seeds the cell on resume.
- **verify** — `blueprint verify <file> <src>`: the
  file against the code (ADR 0055). Plain checks
  first (`missingUnit`, `undeclaredUnit`,
  `kindMismatch`, `dependsMismatch`,
  `targetMismatch`), then the templates that need
  `body`.
- **link by label** — a node named `x` is the unit
  whose `label` is `"x"`. The only link; no registry.
- **golden pair** — a blueprint and the code it
  describes, known to agree: `packages/blueprint/
  blueprint.yaml` and `packages/blueprint/src`.
  `verify` on it prints nothing; its nodes are the
  clean cases for every `body` template.

## Errors and panics (ADR 0067)

- **error** — A managed error: an `Error` with a
  string `kind` and a `payload`, built by a
  package's `makeError`. A value: a caller may
  catch it, and the layer is fine if it does.
- **panic** — Anything else thrown in a run (a
  `TypeError`, a bug). Sticky: it fails the layer
  it ran in, even if a caller catches it.
- **settle** — `op.settle(call)`: runs like `run`
  but never throws; returns a Result. The one way
  to recover a panic.
- **raise** — `ctx.raise(kind, payload)`: the
  official way to throw an error; an ambient
  tool like `ctx.clock`. Stamps the origin.
- **origin** — Where an error was first thrown:
  `{ label, span?, path }`, stamped by `.run`,
  read with `originOf(error)`.
