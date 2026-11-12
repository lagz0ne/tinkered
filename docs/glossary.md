# Glossary

- **public seam** — The one surface tests may touch: the package entry `src/index.ts`.
- **behavior test** — A test that names one public cause and checks one decisive public outcome through the seam.
- **fixture** — Setup at the top of a test file, built with the public API, shared by that file's tests.
- **error registry** — `src/errors.ts` in a package: every error name and its payload type, the only place code throws from.
- **`isError(e, "Name")`** — Guard that narrows an unknown error to one registry entry; on mismatch the caller rethrows.
- **`isX`** — A type discriminator. Checks the smallest stable shape needed to narrow; not a runtime safety wall.
- **`readX`** — The reader that does any real admission once and captures the facts later code needs.
- **process edge** — Where data enters from outside: network, fs, env, argv, user input. Validated once there.
- **layer word** — A name part that says where code sits, not what it is: `Runtime`, `Manager`, `Handler`, `Wrapper`, `Base`. Banned.
- **handle** — An object a caller holds to use a thing. Its config sits on it as plain fields.
- **owner** — Who may mutate and release a value at a handoff: borrow, transfer, or retain.
- **census** — `style-census.sh`: grep counts of forbidden (S*, T*) and watched (W*) patterns.
- **step** — A few lines in a body that do one job. A blank line separates steps (ADR 0111).
- **strict** — Census mode where any S* or T* hit fails. Ends with `Style census: OK` or `FAIL`.
- **TSDoc** — A `/** */` comment on an exported interface or function. The only allowed comment.
- **YAGNI** — Build only what current behavior needs; no options or hooks for a future caller.
- **concept namespace** — `export declare namespace X { ... }` holding every type of one concept; `X.Handle` is what `createX()` returns.
- **unit / span** — One tracked piece of work; opened when an operation or resource resolves. Units nest by explicit parent into a tree.
- **exporter** — An extension (`onStart`/`onEnd`) that consumes spans; its failures are isolated and never fail application work.
- **behavior-neutral** — Observation never changes results or value identity; the core wraps no user value. Deep client tracing lives in adapters.
- **tag** — A typed key for static configuration, with a fixed value per binding.
- **config key** — One tag a capsule declares as its `config`: the library reads it, the command fills it in one call (ADR 0120, 0121). Required when the tag has no default.
- **read view** — What a capsule exports for a cell (`talk.point`): no `controller`, no path to the cell (ADR 0123).
- **`atScope` / `atNamespace`** — `cell.atScope.controller` writes the root outside any namespace; `cell.atNamespace.controller` writes the root in the caller's namespace; `cell.controller` writes its own layer. The use picks; the cell declares no place; a read view has neither (ADR 0126).
- **reader** — What a read view hands a unit: `get()` and `watch()`, never a write (ADR 0123).
- **foreign export** — A value in a capsule's `exports` that is not a unit, such as a React component; copied as is (ADR 0125).
- **list key** — A config key declared as `tag.all`: the call takes a list, and every item is one binding. Reads last first.
- **slot key** — A config key whose tag holds a unit (a resource or operation handle), so the app picks the unit the library uses.
- **data** — A mutable value cell that callers can read, watch, and write.
- **mode (of data)** — What a cell holds: `"single"` is one value, the default; `"keyed"` is members under keys (ADR 0135).
- **keyed cell** — A cell with `mode: "keyed"`. A write changes one member: `set(member)`, `update(key, fn)`, `delete(key)`. Its `key` function reads the key from a member (ADR 0135, 0138).
- **member** — One entry of a keyed cell. It carries its key: the cell's `key` function reads it (ADR 0138). It is not a cell of its own.
- **part (of a key)** — Some fields of an object key, such as `{ project }`. `where(part)` reads each member whose key holds them.
- **invalidate** — Mark a part of a keyed cell dirty, so that each reader of the part asks the server again (ADR 0137). On the server it sends a signal with no data; the signal names a key or a part (ADR 0138).
- **ask (for a part)** — One request from a client for the members of a part. A later ask that shares members wins for them (ADR 0137).
- **load (of a keyed cell)** — An op on the server that gives the members of a part from a store. Its input says which fields a part must have. With a load, the server keeps no member (ADR 0138).
- **projector** — A reader of a store's notices that calls `invalidate` for each one (`docs/keyed-projector.md`).
- **dependency mode** — How a dep is taken: **read** (bare `data` → the value) or **write** (`data.controller` → get/set/watch handle). A bare resource slot delivers its **built value** — never a promise (ADR 0044); a bare operation delivers a subflow.
- **derivation** — A pattern, not a unit: an operation/resource writes a `data` cell (write-mode dep) that others watch; or a consumer watches sources and combines them.
- **operation (command)** — An action run on demand, with typed input, dependencies, and a result.
- **resource** — A reusable value built once per owner, with cleanup tied to its lifetime.
- **defer** — `ctx.defer((end) => ...)` on an operation or resource ctx: the one lifetime hook (replaced `cleanup`+`onOutcome`, ADR 0024). Runs in reverse-registration LIFO when the owning layer closes/releases; `end.status` (`success`/`failed`/`cancelled`/`released`) drives commit vs rollback.
- **subflow** — Depending on an operation delivers a subflow: always a callable (never a value), invoked as `deps.op.run({ input?, rawInput?, tags? })`; `tags` open a child session for that call (ADR 0038); tracked as a nested span (ADR 0020, 0022, 0036).
- **stream** — Streaming = a producer writing a `data` cell over time; consumers `watch`. Self-managed by scope/session; `ctx.signal` cancels (a clean end, not a failure). Pull/every-chunk is an adapter (ADR 0021).
- **session** — A child scope layer; an owned lifetime boundary closed structurally (children first, then teardown). Its handle closes when its body ends (ADR 0071).
- **namespace** — An immutable instance key with tags for settings and extension control.
- **namespace chain** — `ns: [a, b]`: reads walk each key then the default, nearer layers first. Whatever the resolve stores is kept under the first key, not where an input was read from.
- **resolve namespace** — The namespace a resolve stores into: the first key of its chain (a call's `ns`, else the ambient one). Every node the resolve builds or writes is kept there unless its own declaration says otherwise (ADR 0064).
- **ambient namespace** — The `ns` set on `createSession({ ns })`, inherited by children and calls unless one call supplies its own `ns`.
- **resource target** — `scope`: one root build shared by all; `namespace`: one root build per namespace; `session`: one build per session per namespace (ADR 0064). Dependencies bind at the owner. `scope` is today's one declared way to keep a node outside the resolve namespace.
- **target** — A resource's `target`; see resource target.
- **release** — Reset a node and cascade to its downstream dependents so they rebuild; mainly a frontend feature (server uses `close`).
- **preset** — A test-only replacement of a node's realization; only downstream consumers see it. It replaces the whole node: the node's own deps are not built (ADR 0109). Never a production seed.
- **meta** — RETIRED by drivers/t08 (2026-09-26; ADR 0023 superseded): units carry no static bindings; `tag.read(unit)` is gone. A driver takes rows (ADR 0051 §3).
- **bindings (authored)** — `Tag.Bindings`: the shape every `tags` input takes — one binding, nothing (`null`/`undefined`/`false`), or a list of those to any depth (the `clsx` / ESLint flat-config precedent). Flattened once, in order, where it lands; a call whose tags flatten to nothing is untagged (ADR 0022, 0023 amended 2026-09-21).
- **onClose** — Userland teardown hook registered from outside on a scope/session handle; it is a `defer`, interleaved in the same reverse-registration LIFO as resource-internal defers.
- **close / shutdown** — `close(opts?: { graceful?: boolean })` shuts a scope down and resolves a `Result` (never throws, ADR 0027). A MODE, not a wished outcome (ADR 0028): FORCED (default) aborts `ctx.signal` and rolls resources back (`cancelled`); GRACEFUL lets in-flight work finish and commits (`success`).
- **outcome** — A layer's settled state, decided by REALITY, not a wish (ADR 0028): `failed` (its body threw, an owned-work op rejected, or a descendant really failed — bubbled up) > `cancelled` (its work was interrupted / a forced shutdown) > `success`. Reported in the close `Result`; a `defer` sees it as `end.status`.
- **closing signal** — The owner's `ctx.closing` or `event.closing` signal.
  It fires when that layer or its parent begins graceful or forced close.
  It tells a resource to end waits before Core drains running work (ADR 0104).
- **cancel reason** — What a forced close aborts `ctx.signal` with, and what a `cancelled` Result carries. It reads like the web's `AbortError`: `String(reason)` is `"AbortError: The scope closed before this work finished."`. A hidden brand tells it from a foreign `AbortError`, which counts as a failure. One foreign reason is a cancellation too: the reason of a call's own `signal`, for that call's caller (ADR 0133).
- **owner-context** — A node resolves deps and registers cleanup at its owning layer and bubbles up from there; a scope resource needing a session-only required tag is a normal `MissingTag`.
- **brand** — A module-private `unique symbol` a factory stamps on a unit; never exported, so it can't be named/imported outside. A provenance signal (not tamper-proof); guards assert only its presence (ADR 0019).
- **ambient capability** — A cross-cutting runtime service carried on `ctx` — `signal`, `defer`, `obs`, `log`, `clock`, `random` — configured once at the scope and inherited by sessions; never wired via `depends`. Contrast a dedicated capability (a resource you depend on) and a driver (owns a scope) (ADR 0034, 0062).
- **log level** — Where a log line sits on pino's numeric scale, carried on `ctx.log` (an `Observe.Logger`): the bare `ctx.log(msg)` and `ctx.log.info` are `info`, plus `debug` / `warn` / `error`; the named rungs are the exported `LEVELS` constant (`debug` 20, `info` 30, `warn` 40, `error` 50). A sink reads `Observe.Log.level` to color or drop; `Observe.Config.level` drops every line below a threshold before it allocates (ADR 0061).
- **clock** — The ambient time source on every ctx (`ctx.clock`): `currentTimeMillis()` / `currentTimeNanos()` / `sleep(ms, signal?)`. Default `systemClock`; set once via `createScope({ clock })`; inherited by sessions. Effect's default-service model; cancellation is explicit via `ctx.signal` (ADR 0034).
- **TestClock** — `makeTestClock({ now })`: a `Clock` plus `advance(ms)` / `setTime(ms)` that resolves due virtual sleeps. The mock-free seam for time-dependent code — no `Date.now` mock, no fake timers, no `preset` (ADR 0034).
- **random** — The ambient randomness source on every ctx (`ctx.random`): `next()` (a float in `[0, 1)`) / `uuid()` (a v4-shaped id). Default `systemRandom` (`Math.random` / `crypto.randomUUID`, or `crypto.getRandomValues` where a plain-http page lacks `randomUUID`); set once via `createScope({ random })`; inherited by sessions. Both reads are synchronous — Effect's default-service Random, simpler than the clock (no wait, no signal) (ADR 0062).
- **TestRandom** — `makeTestRandom({ seed })`: a `Random` backed by a seeded mulberry32 generator — the same seed replays the same `next()` and `uuid()` stream. The mock-free seam for random-dependent code, no `Math.random` mock and no `crypto` stub (ADR 0062).

## React adapter (`@tinker/react`)

- **adapter** — The React binding is an adapter, not a store: it adds no state/cache/reducer, only subscribes to core and provides its `Handle` on Context (ADR 0030). React-aware observation lives here (core stays behavior-neutral).
- **`ScopeProvider`** — Puts a scope `Handle` on React Context. `scope={handle}` uses an app-owned scope; `create={() => createScope(opts)}` creates/owns/closes it on unmount (the easy path, used in tests). Presets/tags/observe flow through here.
- **`SessionProvider`** — Creates a child session on mount, closes it on unmount — a React subtree's mount lifetime IS a core session lifetime; unmount forces the close (ADR 0031). Effect-created, ref-guarded, StrictMode-safe.
- **nearest Handle** — Hooks resolve `getController` against the nearest provider's `Handle`; core routes by `target` (`scope` shared app-wide, `session` one-per-`SessionProvider`). Hooks never reach past the nearest session (ADR 0031).
- **`useData`** — Reactive read of a `data` cell via `useSyncExternalStore` over `watch`/`get`. `useData(cell)` returns the value; `useData(cell, selector, isEqual?)` subscribes to a slice via the with-selector shim.
- **`useData(cell, { writable: true })`** — The same subscription plus the cell's `set`: `[value, set]` (or `[slice, set]` with a selector). An option, not a second hook.
- **`useController`** — Returns a cell's full `DataController` (`get`/`set`/`update`/`watch`) for writes. A write-only component subscribes to nothing.
- **`useResource`** — Suspends: returns a resource's built value, handing an async build to `use()` (a `<Suspense>` fallback shows; a rejected build throws to the error boundary). Query-like (ADR 0032).
- **`useResource(handle, { suspense: false })`** — Query shape for a resource: `{ status, data, error, isPending, isSuccess, isError, refetch }`, never suspends or throws; `refetch` = release + rebuild (ADR 0032).
- **`useResolve`** — Imperative, never suspends: react-query mutation shape for an operation — `resolve(input)` fires and forgets into `status/data/error/variables`, `resolveAsync(input)` returns the value or rejects, `reset()`, status booleans, `onSuccess/onError/onSettled` options (ADR 0032).
- **`useRelease`** — Returns a thin `release(cellOrResource)` over `scope.release`, for retry/reset UIs (pairs with an error-boundary reset to rebuild a failed resource).
- **`useSpans`** — Returns the scope's bounded span history (a snapshot read each render; empty when observation is off) for an inspector/devtools view — not push-reactive (core exposes no span subscription).

## Frames and calls

- **frame** — An earlier pre-wired graph of tags, resources, and operations with slots the user fills (ADR 0035). The HTTP frame is retired; a service declares its three HTTP units (ADR 0102).
- **slot** — Retired HTTP frame placeholder for tag bindings, request and reply readers, or retry (ADR 0102).
- **resolve / controller / run** — The three scope verbs (ADR 0036): `resolve(x)` reads the snapshot in dependency form (data value, built resource, tag value); `controller(x)` gives back control (data get/set/update/watch, resource resolve/get, operation run); `run(op, call?)` runs an operation now. `run({ depends?, run }, { input?, tags? }?)` runs an **inline operation**: same path, span, ctx, and cancel; no identity so no preset (ADR 0037).
- **tagged call** — `run(x, { tags })` on a declared or inline operation, or on a subflow: sugar for `session({ tags }, (s) => s.run(x, …))` — a child session for that run. Its subflows and its session-target resources see the tags; scope-target resources never do; a session-target resource is per flow (ADR 0038). One that ended in place returns its value, not a promise (ADR 0072).

## Copied HTTP client (ADR 0102)

- **`httpBackend`** — The tag in `tools/flight-trial/services/http-client.ts` with label `http.backend`.
  Its value has the built-in fetch signature; its default calls fetch.
- **`http`** — The HTTP resource in the same file.
  It sends through the backend and joins the caller's and the closing signals.
- **`httpRequest` / request operation** — One outgoing HTTP call with checked, branded input.
  It returns status, headers, and body text.
  With observation on, its `http.request` span holds the `http <METHOD> <path>` child span.

The earlier `@tinker/http` backend, config tag, client resource,
endpoint operation, response source, and retry terms are retired here.
The copied client has no frame, config tag, or retry.

## Hono driver (`@tinker/hono`) — an extension the scope owns (ADR 0051, 0060): `hono(routes, wiring?)` returns `{ extension }` — install it with `createScope({ extensions })`, and `scope.resolve(ext)` after `ready` is the Hono app; `wiring` holds `onError?`, `tags?`, `ns?`, `mount?`, `serve?`; `route.<verb>(path, op | loader, { input?, respond? })` returns a plain row; `tinker`/`handle`/`honoApp`/`routes` are gone from the surface

- **driver** — An integration that maps outside work onto sessions of a scope it does NOT own: the entrypoint (`main`, or a test) creates and closes the scope; the driver receives the handle once, in its extension `start`, and never exposes it to userland (ADR 0039, tiers in ADR 0034).
- **request session** — The session the extension's middleware opens per request, bound with `request(raw)` plus the request-derived `tags(c)`; force-closed on client abort, closed after the handler returns — or, for a streaming route, when the body finishes (ADR 0039, 0040).
- **`handle`** — RETIRED by ADR 0051: a route is a `route.<verb>` row.
- **`request` tag** — Retired Hono binding of a whole web `Request`.
  Routes now read headers and pass plain params to feature operations (ADR 0103).
- **`stream`** — `stream(c, op, call?)`: answers a streaming Response whose body is the declared operation `op`; the run binds the `emit` tag, read with `depends: { emit: emit.required }`, and the session stays open until the body finishes or the client cancels (ADR 0021, 0040). Every other response closes the session after `next()`.
- **`onError` slot** — `hono(routes, { onError })`: runs before the default map (parse failure 400, cancelled 499, MissingTag/NoSession 500, else rethrow to Hono) and may answer a failure with its own Response (ADR 0040).

## Drizzle resources (`@tinker/drizzle`)

- **database resource** — a native database value owned by its root or namespace.
  Its declaration is static; namespace tags select its settings.
- **tx resource** — a native transaction owned by a session.
  Its session's outcome selects commit or rollback before close finishes.
- **db query** — the SQL-only log line emitted for a database statement.
  Query parameters are data and are never logged.
- **core feedback** — findings from package work that may need a Core change.
  They become a Core ticket at the second asker, or when the workaround is dishonest.

## CLI driver (`@tinker/cli`) — RETIRED by ADR 0056, replaced by `@tinker/process`. Until ADR 0051 it was a driver extension: `cli({ name, version, commands })`, value = `run(argv, io)`; `command(name, op | loader, { input?, respond?, description? })` and `command.entry(name, (argv) => …)` return rows; `runMain(wiring, scope?)` is root glue; the `commands` tag, `command` meta, and `run({ scope })` are gone

- **entrypoint driver** — RETIRED by ADR 0056: no driver creates a scope. The app owns the root; a driver receives one. The entrypoint is `@tinker/process` — the process is tags, a command is an operation, routing runs outside any scope. A test's `run` is the same without process wiring (ADR 0042).
- **command binding** — RETIRED by ADR 0056: a command is a `Process.Route` (`{ name, description?, entry }`), not a tag binding.
- **command meta** — RETIRED by ADR 0056: a command is a plain operation that answers an exit code; the meta tag and `commands(op)` are gone.
- **loading policy** — Follows the process: a CLI loads only the selected command (usage loads nothing); a server imports every route at mount and warms pools at boot via `scope.resolve`. Frames are cheap to import: driver imports live inside `open`/loaders.
- **exit codes** — 0 success · 1 failure · 2 usage or the operation's `parse` failure · 130 interrupted (SIGINT/SIGTERM).
- **lazy module** — A resource whose whole factory imports one module path: `resource({ label: "module:pg", target: "scope", factory: () => import("pg") })`. One per path in the workspace; graph code reaches an outside library only through one (ADR 0107). Built once, cached, presettable, spanned (ADR 0042).
- **graph code** — A unit body, plus every own function it calls, followed through each call. A React component or a server function handler is not graph code (ADR 0107).

## Harness (`@tinker/harness`)

- **harness** — An agent loop with its own tools, sessions, permissions, and events (Claude Code via the Claude Agent SDK; Codex via the Codex SDK). Not an LLM API. `harness({ label, adapter })` is the frame (ADR 0043).
- **adapter** — A scope resource whose factory imports the harness SDK (the module is itself a resource — `claudeCode.sdk` — and the test seam) and returns `Harness.Backend`: `start(options, hooks) → Thread` with `run`/`close`; the thread stops its SDK call on `hooks.signal`. Its `options` tag is the SDK's own thread-level options type, never a normalized config.
- **thread** — The session resource: one harness thread per session, started with the session's merged options (or resumed by `x.resume(id)`); a forced close aborts its signal (the turn settles `cancelled`) and then `close()`s it; a graceful close waits for the turn.
- **ambient state** — What the thread knows, as data cells any operation in the session may read or watch: `status`, `text`, `items`, `usage`, `id`, and `events` (the raw SDK events, the `source`). Static facts live in the options tag.
- **send** — `x.send`: the frame's one operation to depend on — one harness turn, whose input is the adapter's own turn and whose result is the SDK's own result. The thread, the cells, and the tool/approval slots are its `depends`, so each tool and approval runs as a subflow (ADR 0043, 0058).

## MCP driver (`@tinker/mcp`) — since ADR 0051 a driver extension: `mcp({ name, version, tools })`, value = the `McpServer`; `expose(op, { description, schema })` returns a row; `mcpServer` and the `tools` tag are gone; the harness takes the same rows (drivers/t08a); the `tool` meta tag and `readTool` are gone (drivers/t08b)

- **tool** — An ordinary operation plus a row with its facts: `expose(op, { description, schema, name?, respond? })` returns an `Mcp.Row`, and `mcp({ tools })` and `harness({ tools })` take the same rows (ADR 0051). `schema` is a zod raw shape (also the op's `input` parse). The name defaults to the op's label.
- **tools** — The binding tag: `tools(op)` on a scope or session; a driver reads the table with `scope.resolve(tools.all)`.
- **mcp** — History (ADR 0051, 0060; the extension is replaced by a capsule, ADR 0121): the driver extension `mcp({ name, version, tools })`; install it, and `scope.resolve(ext)` after `ready` was the MCP SDK's own `McpServer` with one tool per row; each call was a session running an inline op `mcp <name>` with the tool as its subflow; the harness got `mcpServers` config. `mcpServer` is retired by ADR 0051.

## Jev advisory layer (`tools/jev/`)

- **impact block** — A fenced ` ```impact <tag> ` block in a track's `PROGRESS.md`, written by the lead before the code: one line per symbol — package, exact SCIP display name, the files expected to define or reference it (`(none)` = must be gone). The plan's declared blast radius (ADR 0047).
- **discrepancy** — One mismatch between the impact block and SCIP's actual refs: an unexpected file, a missing file, or an undeclared public export in the diff. Found by plain code, no model; each gets exactly one yes/no question to Jev.
- **impact verdict** — Per discrepancy, the fixed mapping of Jev's answer: source wrong · plan wrong · both · neither (no discrepancy) · unclear → human (probability inside 0.4–0.6). Advisory; never a gate.

## Sync (`@tinker/sync`)

- **synced cell** — A `data` cell named in a `[cell, key]` row: the same module imported on both sides; its `parse` is the edge for a snapshot from the wire (ADR 0048).
- **family** — One cell with a shared ID-to-namespace key directory; values belong to each root.
- **identity** — The key a family member syncs under: `label/id`. Matching between a client and its source is by family and identity.
- **registration** — The client scope's `sync(cell | family)` bindings, sent as `register { keys }`: every bound singleton and every member the client holds (new members register the moment they exist). Nothing is pushed unasked.
- **source** — `source()`: the source extension installed with `createScope({ extensions })` — `{ connect(transport) }` opens a session per subscriber, answers each `register` with the initial snapshots (an inline op `sync register`), then fans out every change on a registered key. The scope's cells are the truth.
- **subscribe** — `subscribe(link)`: the client extension installed with `createScope({ extensions })` — resolves its transport from the `link` resource inside the scope, registers by identity, writes each `snapshot` into the cell through its parse, `close()` detaches. One way in v1: a local write stays local until the next snapshot.
- **transport** — `Sync.Transport = { send, onMessage, onClose, close }` — the wire that carries the protocol; pluggable. The package ships `memoryPair()` (the test seam) and the SSE transport in `@tinker/sync/sse` (ADR 0077).
- **protocol** — `Sync.Message`: `register` (client to source) and `snapshot` (source to client). Fixed; any transport carries it.
- **version** — A per-key integer the source bumps on each change; rides on every snapshot.

## Capsules (core, ADR 0121)

- **library** — One folder in `tinker/components/`: a graph of units behind one capsule.
- **capsule** — A library's door, made with `capsule({ label, config?, exports?, hooks? })`: its config keys, its six hooks, and the units it exports. Replaces the extension.
- **test capsule** — A plain capsule in a `*.testing.ts` file that holds a capsule's test tooling. Only tests import it; an app's build check refuses the file in prod (ADR 0131).
- **handle** (of a capsule) — What `capsule()` returns: a binding itself, and a function that fills the config. Each export sits on it: `mail.enqueue`.
- **binding** — What a call of the handle returns, `mail({ smtpUrl })`; what `createScope({ capsules })` installs. Its exports are the same objects as the handle's.
- **record** — `scope.capsules`: one line per installed binding, in install order, with its `config` (a secret shows `"[hidden]"`), its `exports`, and the units it `loaded`. Live at any moment.
- **meta** — `{ role, explain }` on a hook's `load`, `run`, or `settle`: what devtools show. `role` is `setup`, `worker`, `handler`, or `state`.
- **CapsuleMissing** — The error a scope raises when it first touches an exported unit whose capsule it does not install, before any work.

## Extensions (core, ADR 0050; replaced by capsules, ADR 0121)

- **extension** — Replaced by **capsule** (ADR 0121). Was: scope hooks that use namespace tags to choose and control instance state.
- **hook chain** — The per-verb onion built once at creation from the extensions that declare that hook; registration order, first is outermost; a verb with no middleware keeps its direct call (pays nothing).
- **ready** — `scope.ready`: a promise settled when every `start` chain settled. On a starting handle it resolves to the started handle (ADR 0128); a rejected start force-closes the scope through its `close` (every close hook runs) and rejects `ready` only after that close ended (ADR 0085). No extensions → already resolved.
- **start gate** — While a root starts, an outside `run`, `settle`, `session`, or op controller call waits for `ready`, then runs; after a failed start or a close it meets the closed scope (ADR 0127). On a starting handle each call stays a promise after start (ADR 0128).
- **starting handle** — `Scope.Starting`: what `createScope({ capsules })` returns. Every call is a promise; `await scope.ready` gives the started `Scope.Handle`, whose sync calls stay sync (ADR 0128).
- **closed** — `scope.closed` on a root made with a stop `signal`: core's one close `Result`, once that close ended; settles once, never rejects, pending while open (ADR 0085).
- **stop signal** — `createScope({ signal })`: an abort closes the root gracefully once `ready` resolved. Not `ctx.signal`: it asks the root to stop; `ctx.signal` cancels work (ADR 0085).
- **extension value** — What a `start` chain returned, read with `scope.resolve(ext)` once ready (`NotResolved` before). `source()` → `{ connect }`, `subscribe(link)` → `{ close }`.

## Drivers as extensions (core + drivers, ADR 0051)

- **two hands** — The only two places a `Scope.Handle` may appear: the composition root that called `createScope`, and an extension's `start`. Everything else declares `depends`.
- **driver** — Still the role (ADR 0034): an integration that maps outside work onto sessions. Under ADR 0051 every driver is an extension; its `start` is its one use of the scope.
- **wiring** — The flat table a driver extension receives: rows of plain data naming a unit and the driver's edges (`route.post(path, op, { input, respond })`). Not tags, not meta.
- **session hook** — `Extension.session(handle, next)`: the onion around a session's life; `next()` resolves with the close `Result`, so code after it runs after the commit.

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

- **graph module** — A reusable set of graph units for an app goal,
  with extensions where the module must drive work.
- **host adapter** — Code that connects an app's Core graph to a process or view,
  binding its outside inputs and lifetime.
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

## Process entrypoint (`@tinker/process`, ADR 0096)

- **Process** — A CLI host adapter: app entry support that routes commands,
  binds process tags, and waits for Core root cleanup before returning an exit code.
- **process tags** — `argv`, `env`, `io`, and `stop`:
  static bindings for one run's arguments, environment,
  writers, and borrowed root stop function.
- **command** — An operation that answers an exit code.
  Its dependencies name the graph units it needs.
- **service entry** — A selected graph that starts its
  extensions and lives until its root closes.
- **route** — `{ name, description?, entry }`:
  the loader receives `{ args, signal }` and supplies
  a command or service entry before a root exists.
- **run** — The Process call with explicit facts and
  writers; it answers an exit code after cleanup.
- **main** — The Process call that binds host inputs
  and signals; it returns a code for the guarded app
  to set as `process.exitCode`.

## Tinkerer (`@tinker/tinkerer`, ADR 0053)

- **tinkerer** — Our own agent loop on core: a frame
  `tinkerer({ label, tools })` whose turn calls a chat
  model, runs the tool calls it asks for as subflows,
  and repeats until a reply has no tool call. The
  `harness` row stays the SDK-owned loop; this one is ours.
- **step** — One model call in the earlier Tinkerer loop.
  Its `@tinker/http` endpoint transport is retired.
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
  Not a panic: the reason of the call's own
  `signal` (ADR 0133).
- **settle** — `op.settle(call)`: runs like `run`
  but never throws; returns a Result. The one way
  to recover a panic.
- **raise** — `ctx.raise(kind, payload)`: the
  official way to throw an error; an ambient
  tool like `ctx.clock`. Stamps the origin.
- **origin** — Where an error was first thrown:
  `{ label, span?, path }`, stamped by `.run`,
  read with `originOf(error)`.

## Session data at close (ADR 0069)

- **withData** — `close({ withData: true })`: the
  closing session's own data moves into the
  close `Result` as `data` instead of being freed.
  Off by default.

## Links (ADR 0070)

- **link** — A long-lived connection to something
  outside (a stream, a socket, a child process),
  owned by one resource that rewires it from its
  health and intent cells.

## Stack (`@tinker/stack`, ADR 0074)

- **stack** — `@tinker/stack`: the glue every web
  app repeats and never edits that spans packages
  (server start and shutdown, the log and trace
  sink, the browser boot). Glue that belongs to one
  package lives there (ADR 0077). An app depends
  on it; a fix reaches every app by version.
- **generator** — The `vp create` template that
  writes a new app's own code once: pages, schema,
  operations. After that the code is the app's.
- **job** — One unit of work pg-boss keeps in the
  database. The jobs driver runs its operation in a
  session of its own; success commits, failure
  rolls back and retries (ADR 0075).
- **mailer** — The resource that sends mail
  through an Upyo backend picked by `MAIL_URL`.
  Dev logs mail; tests use Upyo's mock (ADR 0083).
- **dev host** — The one `vp run dev` process. It
  keeps PGlite, `nats-server`, and Vite open; a
  server edit closes the old scope and starts a
  new one (ADR 0082).
- **piece** — One row in a root's list: an
  extension, a tag binding, or a function that
  returns one (ADR 0078).
- **stack piece** — A piece of the stack: mail,
  jobs, auth, NATS, the migrate step. An extension
  at its heart; the app touches only its
  operations, resources, data, and namespaces
  (ADR 0081).
- **migrate step** — The one step that brings the
  database up to date, at boot and in test setup:
  a Postgres lock, Drizzle's migrations, then
  pg-boss's own (ADR 0079).
- **nats** — `@tinker/nats`: the stack's NATS
  package. In v1 it carries pub/sub between server
  processes and app events (ADR 0080).
- **one-connection rule** — PGlite has one
  connection. During a request, every database
  touch goes through the request's transaction;
  the signed-in user is read before it opens.
- **trace id** — The id every span of one trace
  shares. A span gets it when it opens, from its
  parent or from the `traceparent` header
  (ADR 0076).

## Tool and call owners

- **call signal** — Stops one action and its child work; the caller stays alive.
- **tool scope** — Owns a logger, observer, or devtools graph.
- **hose** — The scope's one stream of spans and log lines. Every tap gets every record (ADR 0119).
- **tap** — One `Observe.Config` on the hose: the scope's `observe`, or one an extension adds in `start`.
- **start timeout** — How long `ready` waits for the extensions' `start` hooks. Default 10 s.

## UI state model

- **state resource** — A resource whose live instance marks one active UI state.
- **state-owned work** — Work tied to one live state resource instance.

## Execution results

- **execution ID** — The ID of one change request, shared by its change and result events.
- **completion goal** — The work an operation requires before it can report complete.
- **execution result** — The complete, partial, or failed result for one completion goal.
- **partial result** — A result where some required work succeeded and other required work failed.

## Flight trial (ADR 0097)

- **trial round** — One staged step of the trial app; it passes only when every check passes.
- **trial baseline** — The number of rounds a writer passes in order before the first failure.
- **trial service** — A Tinker app in its own scope that plays a third party over HTTP (ADR 0098).
- **control API** — A trial service's grader-only HTTP face; it writes the service's own data.
- **shared stack** — The trial services' common Hono middleware: call log, token check, body decode, route rules.
  A session resource, `requests`; each service binds its session first (ADR 0105).

## Strict forms (ADR 0099)

- **plain function** — A function that is not a tag, data, resource, operation, or extension.
- **plain-function list** — The checked list of allowed plain functions, with params and call sites; it only shrinks.
- **protocol layer** — The framework code at a service's edge: a Hono handler or a framework route.
  It owns route, params, headers, and wire body in; status, headers, and wire body out.
  Feature operations take plain params and return values or raise managed errors (ADR 0101, 0103).
- **entry point** — The one file that creates a root scope and owns its stop signal and exit (ADR 0100).
- **userland** — The app's own files: `src/`, `tests/`, and its config.

## Fast code

- **inline budget** — The bytecode V8 may spend on calls copied into one optimized function.
- **megamorphic** — One access sees too many object shapes to use a small fast path.
- **microtask turn** — One spin of a repeating `queueMicrotask` marker while waiting for promise work.
- **context slot** — V8's numbered place for a module name used by a nested function.

- **item module** — An app-owned folder in `src/items/` with its own dependencies and public API.

## Analyzer (ADR 0129)

- **call shape** — One ordered list of the deps an op calls on one path through its `run`: the branches, loops and early returns the source allows.
- **divergence** — A run or an edge seen in spans that no static call shape allows; the analyzer or a lint rule is wrong.
- **absence** — A static call shape that no test ran.
- **conformance** — The check of the static call shapes against observed spans (van der Aalst). It has two parts: fitness and coverage.
- **fitness** — Every observed run fits a static call shape: divergence is 0.
- **coverage** — Every static call shape ran in a test: absence is 0.
- **slice** — Only the paths of one route, op or cmd, at file and line (Weiser).
- **backtrace** — The call stack of a failed run, at file and line: span names and the error's origin, joined with the call shapes (as gdb `bt`).
- **unit tag** — A fixed fact on an `operation`, `resource` or `data` (`tags: [...]`): read by tools and hooks, put on the unit's span, never bound into a run.

## rpc and remote data (ADR 0130)

- **rpc** — `rpc(name, contract)`: a capsule with typed calls (`answer`, `stream`). Each call goes through a transport.
- **remoteData** — `remoteData({ cell })`: a capsule that sends a server cell's value to each client that watches it.
- **contract** — The `input` and `output` of one rpc call. Each takes any Standard Schema value (zod, valibot, arktype).
- **protocol** — The wire shapes, faults, codec and lifecycle hooks that rpc and remoteData share. `transport.protocol` in code.
- **rpc transport** — A capsule pair that carries the protocol: the client exports `call` and `watch`; the server exports `serve` and `serveStream`.
- **server fault / local fault** — Who spoke (ADR 0141). A server fault is the server's answer in the wire format: the same call gets it again. A local fault is this side's: `link`, or `encode`/`decode`/`invalid` with side client. `fault.from` says which.
- **missing** — The server fault for an address no one serves, as HTTP 404 or gRPC `UNIMPLEMENTED`: nothing ran (ADR 0141).
- **sent** — On a local fault: `false` when nothing left, so the server ran nothing; `true` when it may have run. The one case that is safe to send again is `false` (ADR 0141, as gRPC transparent retry).
- **handler** — A capsule whose start returns Bun's `{ fetch, websocket? }`; `serve` asks it for each request (ADR 0132).
- **serve** — The capsule that owns `Bun.serve` for the scope's life; `run` is the host that owns signals and exit codes (ADR 0132).
- **memory transport** — `memory` from `@tinker/core/testing`: an rpc transport in one process, for tests (as Connect's `createRouterTransport`).
- **skill** — A `SKILL.md` file in a package's `skills/` folder that teaches an agent one task with that package: whole examples and common mistakes. Ships in the release, so it has the code's version (ADR 0143).
- **rule id** — The name a check prints for one rule, `tinker/<name>` (`tinker/plain`). A mistake in a skill carries the same id, so a failed check leads to the skill (ADR 0143).
- **Intent** — `@tanstack/intent`, the CLI that validates skills here and lists and loads them in an app (ADR 0143).
