# Core feedback from authoring

## Live scope inspection — 2026-10-02

Asked by `start/poc`.
Status: first caller; native API design still open.
The proof panel labels its completed spans as a snapshot.
It does not claim to show every live node or graph edge.

An app extension cannot recover those facts from `resolve`.
The hook sees the root read, but not its dependency or session read.
The lead ran this case against built Core:

```ts
let reads = 0;
const child = resource({ factory: () => 1 });
const parent = resource({
  depends: { child },
  factory: ({ child }) => child + 1,
});
const watch = extension({
  hooks: {
    resolve(event) {
      reads += 1;
      return event.next();
    },
  },
});
const stop = new AbortController();
const root = createScope({
  signal: stop.signal,
  extensions: [watch],
});
await root.ready;
root.resolve(parent);
const session = root.createSession();
session.resolve(parent);
await session.close();
stop.abort();
await root.closed;
```

Observed: both values are 2; `reads` is 1.
The hook does not report the child's edge or the session's reuse.
React's `useSpans` also returns a snapshot without subscribing.
Live graph and active-work facts need a native Core surface.
The app adds no helper that guesses those missing facts.
Proof: `/tmp/tinkered-start-native-inspection-gap.log`.
[Design](start-scaffold/DESIGN.md#observation-and-devtool).

## React namespace reset — 2026-09-30

Found by `react/namespaces`.
A Core handle does not expose its ambient namespace.
The adapter knows keys set on its own session providers.
An externally made scope needs an explicit hook key.
This is a documented limit; no Core change is requested.
The explicit key is an honest use of the existing API.

```tsx
const project = namespace();
const root = createScope({ ns: project });

<ScopeProvider scope={root}>
  <Editor />
</ScopeProvider>;
```

Inside that editor:

```tsx
const reset = useRelease(project);
const profile = useResource(projectProfile, {
  ns: project,
  suspense: false,
});
```

The other side of the spectrum: every integration (http, hono, drizzle, cli, claude, codex) is built to
find what core lacks or gets wrong. Contributors end each report with a **Core feedback** section; the
lead records the candidates here with the integration that surfaced them. A candidate becomes a core
ticket only after a second integration asks for it, or when the workaround is dishonest.

[Parked review, 2026-09-30](parked-review/PROGRESS.md#core-ideas) checks the open requests.
The 2026-09-19 report is history.
The live lane is `core/ideas` in [TODO.md](../../TODO.md).

- An operation's `parse` failure should be `DataValidationFailed` like data/tag parses
  From: hono/t02
  State: **done** — core/t28

- A driver needs a per-request span its handler's span nests under
  From: hono (ADR 0040)
  State: **not needed** — the request is an inline op

- A session-target resource that inherits the parent session's built instance (savepoints, per-flow sharing under tagged calls)
  From: drizzle (ADR 0041 Q3)
  State: open — wait for a second asker (cli? claude?)

- `tags: []` on a call means untagged (no session) — is an empty binding list ever a session?
  From: core/t27
  State: accepted as untagged; revisit only if a driver needs "always a session"

- A lazy operation handle was requested for loading an operation on demand. A resource factory can import and return the operation; the driver resolves it and runs the result.
  From: cli (ADR 0042)
  State: **closed — not needed**, core/t30; existing resources supply lazy loading; cli/t03 accepts a resource-backed command

- An async resource factory may register `ctx.defer` after an `await`, until its returned promise settles, including while close waits for it.
  From: drizzle/t01
  State: **done** — [core: Resource cleanup](../../packages/core/README.md#resource-cleanup)

- An async resource dep is delivered as `Promise<T>` (`ResourceValue`), so a factory/op must `await` it; a lazy Proxy delivers it — new users trip on it
  From: drizzle/t01
  State: **done** — core/t31 (ADR 0044): a slot delivers the value; async is a build detail

- Tests can count resource builds through observation: each build emits a `resource` span. Use retained history when the scope handle is available, or configure `observe.export` before starting a driver that keeps its scope private.
  From: drizzle/t01
  State: **closed — existing observation is the seam**; [core: Observation](../../packages/core/README.md#observation)

- Read all bindings of a tag directly from a scope handle with `scope.resolve(tag.all)` (and `.optional`), without an inline operation to retrieve them.
  From: cli/t01
  State: **done — core/t29**, shipped alongside cli/t02; see TODO.md

- One-shot sessions cost a full open/close per command; fine for a CLI, but the cost model for short-lived drivers deserves one sentence in the docs
  From: cli/t01
  State: **done** — [Process command lifetime](../../packages/process/README.md); no performance claim added

- On a forced close, core aborts signals, waits for in-flight ops to settle, THEN runs resource `defer`s — so a resource holding a process must stop on `ctx.signal`, never in its `defer` (a "defer interrupts the turn" deadlocks); one sentence on `Resource.Ctx.defer`/`signal`
  From: harness/t01
  State: **done** — [core: Resource cleanup](../../packages/core/README.md#resource-cleanup), [harness: Stopping a turn](../../packages/harness/README.md#stopping-a-turn)

- A resource's `ctx.signal` may already be aborted when an async factory continues after a forced close; a listener added then never fires — the factory must check `signal.aborted` first (Claude: `AbortController` bound to it)
  From: harness/t01
  State: **done** — [core: Resource cleanup](../../packages/core/README.md#resource-cleanup) covers the already-aborted guard

- One resource writing six cells needs six `controller` deps; fine at six — "a resource publishes a record of cells" is the candidate if harnesses grow
  From: harness/t01 (ADR 0043)
  State: open — wait for a second asker

- Closing a layer seals its cell writes: an abort listener, an operation catch, or a resource `defer` cannot write its final status there. Read the close result instead; a real failure can take precedence over cancellation.
  From: harness/t01
  State: **done** — [core: Closing and cell writes](../../packages/core/README.md#closing-and-cell-writes), [harness: Stopping a turn](../../packages/harness/README.md#stopping-a-turn)

- A per-turn abort check belongs where the SDK call actually starts work, including before iterating a lazy stream. This is adapter guidance, not a new core feature.
  From: harness/t02
  State: **done** — [harness: Stopping a turn](../../packages/harness/README.md#stopping-a-turn)

- The complexity lint (8) shapes adapter code into many tiny `readX` helpers; fine, but a mapping over a 6-way discriminated union is naturally one function
  From: harness/t02
  State: tooling note — consider raising the ceiling for pure mapping functions

- An operation bound on the scope THROUGH A TAG (`coder.approvals(op)`) cannot be run as a subflow: a tag delivers the handle, not a controller, and a frame holds no scope. Today the harness attaches approval/tool ops at frame construction (static `depends`). The ask: a `depends` edge that runs the operation a tag delivers as a subflow (spans nest, session bindings seen)
  From: harness/t03 (ADR 0043)
  State: open — first asker; cli/hono tables run theirs from the driver (which holds the scope)

- A public discriminator for handles (`isResource(x)` / `isOperation(x)`) so a driver can accept "a loader function OR a resource handle" without its own `typeof` split per union
  From: cli/t03
  State: **closed — old CLI caller retired**; Process routes name command operations directly. The guards remain private; reopen for a current driver that needs them.

- A driver that keeps its scope private (such as CLI `run`) needs `observe.export` configured before it starts. Correction: close itself does not block `scope.spans()`; retained history remains readable when the caller holds the handle.
  From: cli/t03
  State: **done — corrected after source and runtime audit**; [core: Observation](../../packages/core/README.md#observation), [Process](../../packages/process/README.md)

- A session per tool call is still the ownership rule in MCP. A caller with many short tool calls would need a current queued comparison before changing that rule.
  From: mcp/t01
  State: open — measure current MCP calls through the queue before optimizing; keep one session per request.

- `tag.read(op)` off a live handle and `op.run({ rawInput })` through a subflow both read well — no friction (positive)
  From: mcp/t01
  State: none

- The MCP SDK's `registerTool` parameter types read as `never` through `Parameters<…>["inputSchema"]`; the driver types the zod shape by hand (`Record<string, ZodTypeAny>`) — SDK, not core
  From: mcp/t01
  State: tooling note

- A frame type that pins a shared op's RESULT to one adapter's mapped type breaks "one declaration serves every harness" at the type level; the op's result must stay `unknown` and the adapter maps at the edge (`answerTool`)
  From: harness/t06
  State: **done** in t06's fix round — a design rule for every adapter

- One idea, one registry: a check two packages need (`ToolUndeclared`) lives in the package that owns the idea (`@tinker/mcp`'s `readTool`), and the other imports it — never two `isError` namespaces for one failure
  From: harness/t06
  State: **done** in t06's fix round — convention note

- A tag named like a common noun (`tool`) collides with loop locals and muddies SCIP `refs 'tool'` — name locals `entry`/`op`
  From: harness/t06
  State: naming note

- The reported `Tag.Binding<Command>` widening problem does not hold for the current type: `tag: Handle<any>` removes callable variance from the binding, and a narrower `value` fits a wider union. A strict compiler probe accepts `Tag.Binding<Cli.Command>` as `Tag.Binding<Cli.Bound>`.
  From: cli/t04
  State: **closed — current types already allow widening**; [core: Tags](../../packages/core/README.md#tags)

- A public builder with an overload list (`command(meta)` vs `command(name, load, route?)`) needs the same overloads on the implementation function too: a `(...args: A \| B)` impl is not assignable to the overloaded annotation. TypeScript, not core
  From: cli/t04
  State: tooling note

- A README that pastes a whole example file drifts from it; keep the recipe to the lines the reader needs and point at `examples/<file>.ts` for the rest (or lint fences against files later)
  From: mcp/t02
  State: docs convention note — applied to the mcp README at landing

- `command.entry("mcp", () => serve)` beside `tools(search)` on one scope needs no glue: the entry receives the scope `runMain` built, so the MCP driver sees the bindings (positive)
  From: mcp/t02
  State: none

- `scripts/scip.sh refs` takes a regex over the FULL symbol string, so `^name$` never matches; a convention that names symbols exactly (the printed `symbol` column) and filters rows by equality is the honest reader — the impact block does that now
  From: jev/impact
  State: tooling note — applied (ADR 0047 says exact display name)

- A Jev boolean about a file needs the file's evidence in the state: with only goal + symbol + file it wobbled 57–61% (unclear); with the diff hunk it answered 82–87% stably. Rule for every future judge: put the artifact being judged in the state, not just its name
  From: jev/impact
  State: advisory-layer rule — record in PLAN.md when jev/calibrate lands

- The original Core-family idea minted a cell per id. Sync now declares one cell and keeps a namespace-key directory; Core owns each root's values and watchers.
  From: sync (ADR 0048)
  State: **closed — replaced by namespace-backed families**; Sync declares one cell and returns a namespace per id. The authoring review confirms stable graph nodes and values owned by each root.

- `scope.onMount(fn)` would run when a cell gains its first watcher and clean up on the last. Sync registers requested identities and late namespace-family members today; watcher-driven unregister is still absent.
  From: sync (ADR 0048)
  State: parked — one asker; requested identities and late members already register. First/last watcher registration and unregister remain open.

- `data({ label, initial, parse, eq, meta })` was enough to build a cell family outside core (a Map of members, each an ordinary cell); nothing missing (positive)
  From: sync/t01
  State: none — the family stays in `@tinker/sync` until a second asker

- The impact chain's first real run (sync/t01) answered PLAN wrong on three exports the brief named but the block omitted — the block must list the WHOLE public surface of a new package (types and the error registry too); a package template block is the fix
  From: sync/t01 (ADR 0047)
  State: process note — the lead copies the brief's surface list into the block

- A write to a cell from inside a session lands on the SESSION's own copy (copy-on-write per layer), so a scope-level watcher never fires — a driver whose truth lives on the scope must read and write it through the scope handle it holds, not through a session op's `depends`; one sentence on `Scope.DataController`/sessions would prevent the trap
  From: sync/t02
  State: **done** — [core: Sessions and cell writes](../../packages/core/README.md#sessions-and-cell-writes); existing `createSession` TSDoc also states the local shadow rule

- `scope.resolve(tag.all)` delivers bindings NEWEST first (nearest layer, last binding first), not declaration order; a driver that publishes in "registration order" must sort or document it
  From: sync/t02
  State: **done** — [core: Tags](../../packages/core/README.md#tags) makes both ordering rules explicit

- A driver that writes a cell and also watches it needs to tell its own write from userland's: an `applying` flag around the driver's `set` suffices because watchers fire synchronously inside `set`, and the `eq` no-op rule means a fill that changes nothing sends nothing — no write-origin signal from core needed (positive)
  From: sync/t03
  State: none — first asker for a write-origin signal withdrawn

- A route using hono `stream(c, write)` holds its request session open until the body ends, so a test that ends with the stream still open must `scope.close()` plain (forced), not `{ graceful: true }` — one sentence in the hono README's `stream` section
  From: sync/t04
  State: **done** — [Hono: Streaming](../../packages/hono/README.md#streaming) already covered body lifetime; now covers forced shutdown

- `@tinker/react`'s update path is ~9.0 µs vs bare `useState` ~5.1 µs in the browser bench (every competitor at its source-audited best: Preact 6.9, Jotai 8.5, Zustand 10.5, Legend 12–13). Layer probes decompose the 3.9 µs: React's `useSyncExternalStore` itself +1.3 (Preact sits on this floor); **core write→notify +0.25 — core is not the cost**; the `ScopeProvider` fibers +0.6; the Cell's `useContext` read +1.2 (React's context-consumer tax; structural — the scope must come from context); `useData`'s `useMemo(…, [scope, cell])` +0.3 (a deps array per render — the only recoverable part: core already memoizes `scope.controller(cell)` per node, so the data store can be cached outside React, such as a WeakMap keyed by controller). Realistic floor for this architecture ≈ 8.5 µs (Jotai parity); `useState` is unreachable without dropping uSES + the provider, and Jotai's non-uSES path is no faster
  From: playground bench (2026-09-19)
  State: **done** — 9c5c84f: `useData`'s no-selector store shared per controller (WeakMap), selector path on `useRef`, `useController` drops `useMemo`; 9.0 → 8.75 µs. Core untouched. Learnings: `research/learnings/2026-09-19-react-update-path.md`

- The client registers late family members through `family.onMember` — a second listener list beside the scope's published set. A first/last watcher hook could support unregister and let scope watches drive registration.
  From: sync/t05
  State: same `scope.onMount` candidate — still one asker, not a second request

- The impact chain reads package-relative files off SCIP's per-package index; examples that live outside the package (`examples/<pkg>/`) are invisible to it — blocks must not list them (a false "source wrong" on sync/t05)
  From: sync/t05 (ADR 0047)
  State: process note — recorded in the sync plan; a root `examples` index is the fix if it matters

- A package test that imports a root example needs that example available during mutation. Sync uses `inPlace: true` to preserve those imports.
  From: sync/t05 (examples restructure)
  State: **checked** — sync is the only current package test importing a root example and has `inPlace: true`; [2026-09-19 review](blocked-and-parked-review.md). Recheck when adding recipe imports

- The complexity lint (8) on `handleFor` pushes a contributor to extract the handle literal into helpers with a spread — that cost ~90 ns per `createScope` (measured, then reverted); rule for core tickets: never split the handle literal; wire cold features behind a branch in `createScope`, extract only a single dispatch closure if the lint complains
  From: core/t32
  State: convention note — Performance section of the coding convention

- One extra field on the `Layer` record (`exts`) and one on the handle (`ready`) read as +15–17 ns on `cold` and `session` (pinned A/B, min of 3) while `create` got faster; per-layer state for a root-only feature belongs in a side table keyed by the root layer, not on every record
  From: core/t32
  State: **done** — core/t33 moved `exts` into a WeakMap and re-measured the cold/session paths

- `emptyCtxFor(layer)`'s `defer` throws (it is the no-target ctx); an extension needs a real `Resource.Ctx` whose `defer` lands in `layer.defers` — `ExtensionCtx` in t32; if a third caller needs one, fold it into `emptyCtxFor`
  From: core/t32
  State: none — noted

- The old proposal to skip a failing extension's close hook used the pre-ADR 0085 cleanup path. A failed start now enters the root close chain once and waits for cleanup before rejecting `ready`.
  From: sync/t06 (ADR 0050)
  State: **closed — superseded by core/root-lifetime** (ADR 0085); the fresh public probe sees the close hook once before `ready` rejects, and a repeated close does not repeat it.

- A transport may call close listeners synchronously. To report startup failure, a driver must reject its pending startup promise with the error value through a saved reject function, and handle that promise from creation; throwing from the listener is not promise settlement.
  From: sync/t06
  State: **done** — [sync: Wire it](../../packages/sync/README.md#wire-it)

- An extension whose start has not settled throws `NotResolved` on `scope.resolve(ext)`; the composition root should await `scope.ready` before resolving extension values.
  From: sync/t06
  State: **done — already covered** in [core: Extensions](../../packages/core/README.md#extensions) and [sync: Subscribe](../../packages/sync/README.md#subscribe)

- Moving a root-only feature's per-layer state into a module `WeakMap` keyed by the layer reclaimed the t32 cost (cold −10 ns, session −36 ns, pinned A/B); extracting the resolve dispatch into a helper cost +6–12 ns on `create` and was reverted — the handle literal must stay one function even at the complexity ceiling (the 13th warning is the price; raise the ceiling for `handleFor` rather than split it)
  From: core/t33
  State: tooling note — consider a per-function complexity override for `handleFor`

- A session-aware `run`/`resolve` chain needs the wrap point inside `handleFor` (per layer, with the no-extensions fast path), not in `extendHandle`; today the chains close over the root layer and the root's plain handle, and sessions bypass them by never receiving the wrapped handle
  From: core/t34 (ADR 0050)
  State: **done** — core/ext-hooks-every-layer 2026-09-25

- `runInline` is a closure inside `handleFor`, so a chain cannot reach it directly — the innermost `next` must be the plain handle's `run` (which is also what keeps tagged calls and inline configs on today's path); fine, but it means the chain wraps the handle, not the layer
  From: core/t34
  State: none — noted for t35 (`write` wraps `controller(cell).set` the same way)

- The old root-only write hook left session and operation dependency writes outside its chain. Layer-level write hooks now cover those paths; the no-hook path remains plain.
  From: core/t35 (ADR 0050)
  State: **done** — core/ext-hooks-every-layer, 2026-09-25; run and write hooks follow session and dependency paths. Resolve hooks remain root-only.

- The public transport, `SyncNotReady.missing`, `SyncConflict.key`, and separate family identities were enough to test startup and cleanup after the extension conversion; no new core feature or workaround was needed.
  From: sync/t07
  State: none — positive; tests only, no new primitive

- The Drizzle README still described async dependencies as promises even though its example and ADR 0044 deliver built values. It also blurred managed rollback with commit failure.
  From: tracker/t01 lead review
  State: **done — docs corrected** in [Drizzle](../../packages/drizzle/README.md); source and built signatures checked. No API change.

- Hono `handle` calls `input` synchronously. Passing `c.req.json()` there sent a promise into the domain parser and made a valid tracker POST return 400. Awaiting JSON in an outer route keeps admission at the edge.
  From: tracker/t01
  State: **done — doc recipe added** to [Hono: Hand mounting](../../packages/hono/README.md#hand-mounting). Source behavior unchanged; the tracker HTTP test covers saved values.

- Tracker saves need one authority-owned queue and an explicit root write after session close; a per-caller saver would create independent transaction queues.
  From: tracker/t01
  State: app composition — [original T01 proof](issue-tracker-v1/PROGRESS.md#t01-complete--2026-09-19) verified by create/live and process-restart proofs. No new core API requested.

- Async sync sends need an owned queue and close notifications before awaiting readiness. Installing EventSource error handling after ready left Loading on a dropped first snapshot.
  From: tracker/t01
  State: app composition — reproduced and fixed; real startup-drop browser proof now shows the error. Public Transport contract unchanged.

- The sync README's SSE fragment still uses a floating emit promise; an app needs an owned queue, failure-to-close path, and an open-stream handshake.
  From: tracker/t01
  State: **done — [sync wiring guide](../../packages/sync/README.md#wire-it) now links the verified owned transports** and explains send queues, handshake, early failure, and forced close. No source API change.

- A helper needs the transaction type from an async database factory. `ReturnType` names the promise, so `DrizzleStore.Tx` needs the awaited database type.
  From: tracker/t02
  State: **done — doc/composition note** in [Drizzle](../../packages/drizzle/README.md). `Awaited` is the existing TypeScript tool; no new core alias is needed. Lead app build/check pass.

- A typed operation `input` intentionally skips parsing; tests of invalid outside input must enter through `rawInput` or the real route.
  From: tracker/t02
  State: **done — [core input guide](../../packages/core/README.md#operation-input)**. Verified public invocation contract; tracker rejected-comment HTTP test proves no saved comment/history.

- Saved snapshots must not advance the revision owned by a local edit draft. Detail refresh also needs the incoming snapshot identity, since comments can share timestamps without changing edit revision.
  From: tracker/t02
  State: app composition — local revision plus issue-id-owned view; real two-tab stale-edit regression failed before the fix and passed after. No new core primitive.

- A rejected save must publish nothing. `memoryPair` and the viewer cell identity directly prove that the saved snapshot stayed unchanged.
  From: tracker/t02
  State: positive feedback — no workaround; public test and independent HTTP/history proof passed.

- The MCP README returned only `connect()` from a CLI entry, so `runMain` exited before any tool call.
  From: tracker/t03 lead review
  State: **done — [MCP entry lifetime](../../packages/mcp/README.md)** now awaits EOF, transport close, or scope close. The real old example exited with stdin open; the fixed example initialized, stayed alive, and exited 0 on EOF / 130 on SIGTERM. No library change.

- CLI argument readers must pass raw missing/blank revision values into the operation parser. Throwing in argv instead returned code 1 rather than usage/code 2.
  From: tracker/t03
  State: app composition — corrected readers share the domain parser. The public CLI regression and independent process proof passed; no new core primitive.

- Binding `api.config` once on the owned CLI/MCP scope lets real listener tests choose a server without per-call environment overrides.
  From: tracker/t03
  State: positive — existing scope tags suffice; public CLI and SDK-client tests passed against the same HTTP authority.

- MCP metadata imports the SDK, so browser HTTP operations stay separate from Node tool declarations. Node operations delegate to HTTP and reuse the domain input readers.
  From: tracker/t03
  State: app composition — final browser asset scan and real live-tool browser proof passed; no duplicated database handlers.

- A harness turn status can become done before its session cleanup has been inspected. The tracker watches running/text in that child, then reports terminal success only after awaiting close and checking its result.
  From: tracker/t04
  State: app composition — existing `Scope.Result` is sufficient. A joined-turn convenience is a first-asker idea, not a core ticket.

- A typed Claude SDK fixture must supply `requestId` as well as `toolUseID` when invoking `canUseTool`.
  From: tracker/t04
  State: test fixture note. Lead checked the harness approval guide: its example consumes a request rather than constructing one, so the claimed missing-field docs bug does not apply.

- The style census classifies non-`*.test.ts` fixture helpers as source and rejects `preset()` there.
  From: tracker/t04, tracker/t05
  State: tooling note — keep preset construction in the test file and pass the typed SDK fixture. T05 keeps the real process proof separate from seven helper tests; final strict census passes. No source policy change needed for this app.

- Closing a Node test server can wait on the disconnected SSE socket. The fixture must close its owned connections and join the server after closing the root.
  From: tracker/t04
  State: test ownership correction — close owned sockets, then join. Lead also observed timeouts across real DB/HTTP tests, so app-scoped integration timeout headroom plus explicit request joins now pass 25/25 in the lead tree; this is not a core API gap.

- Replacing the app-owned scope on a stable React provider lets reconnect load fresh server state while the mounted forms keep their title, comment, and original edit revision. The lead's real restart probe then observes the stale browser Save rejected with 409.
  From: tracker/t05
  State: positive composition — existing core/sync/react APIs suffice; keep connection retry and local draft ownership in the app. No new core primitive requested.

- A session's cell writes never reach the root cell and there is no "after this session committed" hook; the tracker hand-rolls `publishList` after `scope.session` (bridge) AND holds the session handle to watch `triage.text` (draft). **Second asker** after tracker/t01.
  From: tracker audit 2026-09-20 (server review F2)
  State: **done** — answered 2026-09-20 without a core change: publish runs from the extension `session` hook after a successful close (`aa7f27e`, `apps/issue-tracker/src/server/publish.ts`), and the draft reads `triage.text` as a controller dep (`8e21497`). A session's writes staying in the session is by design (inherit, shadow on write).

- hono `Route.input` is `(c) => unknown` and not awaited, so every JSON-body route pre-reads `c.req.json()` outside `handle` (4 copies in the tracker). Ask: accept `PromiseLike<unknown>`.
  From: tracker audit 2026-09-20 (F1)
  State: **done** — reshape/server `c71b92a`, `5be7d9b`: `input` may return a promise; a rejected read is `InputRejected` → 400

- hono `stream`'s `emit` is not safe from a sync `Sync.Transport.send`; the README recipe uses `void emit(...)` (forbidden by convention) so the tracker wrote a 60-line `owned` wrapper. Ask: `emit` serializes, or `stream` exposes a transport-shaped writer.
  From: tracker audit 2026-09-20 (F3)
  State: **done** — reshape/streams `d5357f4`: `emit` is synchronous

- No built-in way to run one call at a time on a single-connection store (PGlite): every app re-invents a `tail.then` queue. Ask: a `drizzleStore` serial option or a mutex-resource recipe in the drizzle README.
  From: tracker audit 2026-09-20
  State: **done** — `fix/docs-recipes 7322676`: [Single-connection stores](../../packages/drizzle/README.md#single-connection-stores-pglite); PGlite serializes itself so no queue is needed, queue recipe for stores that reject

- No documented form-cell pattern for React; one `data` per field is verbose, so the tracker fell back to 36 `useState`. Ask: a worked form example (cells + one save operation) in `examples/react`.
  From: tracker audit 2026-09-20
  State: **done** — `fix/docs-recipes 8d13f6b`: `examples/react/form.tsx` + headless `form.test.ts`; one-cell draft, `typeDraft` + `saveDraft`, component uses only `useData`/`useRun`

- `source().connect(transport)` rejects when the root closes forced, so an SSE writer cannot tell "cancelled, swallow" from a real failure and must `.then(close, close)`. Ask: settle with a `Scope.Result`-style value instead of rejecting on a forced close.
  From: tracker reshape/streams 2026-09-20
  State: **done** — drivers/t06: `connect` returns the session's close `Result` (per-session `createSession` + `session.close`, never `scope.session(fn)`); the `/sync` row drops the `Result` and closes the inbox; `sync.test.ts` proves `success` on part and `cancelled` on forced close

- A subflow call `deps.op.run({ input })` types its promise so `.then(onOk, onErr)` needs three type arguments; callers wrap it in `async/await` (`src/client/drafter.ts` `start`). Ask: a plain `Promise<Awaited<T>>` on the controller's `run`.
  From: tracker reshape/client-b 2026-09-20
  State: **done** — `6ab3bd9`: no core type change — an async body's `T` already is its promise, so `.then(ok, err)` types; `start` shrinks 14→8 lines

- `controller.watch(fn)` hands the next value only; a resource that must act on "changed to a different id" recomputes from the previous value it kept (`drafter` discards on every select write). Ask: `watch((next, prev) => …)`.
  From: tracker reshape/client-b 2026-09-20
  State: **done** — `961b793`: prev travels positionally (no allocation, one-arg listeners free); tracker untouched (both sites still need their own read)

- `HttpResponse.Handle.stream()` returns `null` for a bodiless response, so every streaming consumer repeats the null check and its error (`src/client/api.ts` `openDraft`). Ask: a `stream()` that raises a registry error on a missing body, or a documented `streamOrRaise`.
  From: tracker reshape/client-b 2026-09-20
  State: **done** — fix/stream-null `6c96adc`: `stream()` raises `NoBody { status }`, never `null`

T05 final writer feedback also checked CLI argv testing: `@tinker/cli` already supplies
the public in-process seam. The browser proof intentionally starts the real tools child
to verify its entrypoint. No new helper or core ticket was requested.

- A `session`-hook extension cannot see the response status: a mapped 400 and a 201 both close `success`, so a publish-after-commit rule keyed on method + success still republishes after rejected requests. The tracker answers by making `publishIssues` content-aware (skip the write when the saved rows serialize equal). Ask: expose the session's terminal fact (or the request's status) to the hook, or bless content-aware publish as the recipe.
  From: drivers/t03 (publishAfterCommit)
  State: open — first asker

- An extension value used as an op dependency (`depends: { origin: src }`) needs the extension object at module level while `createApp` installs it — one identity per process by convention, with no core guard against installing a second `source()`. Worked first try; noting the sharp edge.
  From: drivers/t03 (openWire)
  State: none — worked; convention note

- ADR 0051 under-specifies `mount`'s future: `/sync` GET became a row (stream-in-`respond` composes), so `mount` currently has zero callers in the tracker. Keep it for hand-built extras or delete it in the contract pass.
  From: drivers/t03
  State: open — ticket note, not a core ask

- A child session cannot learn its parent's close mode, so a driver that owns a session per caller must thread a `forcedClosing` flag from its `close` hook to report `cancelled` rather than `success` on a forced shutdown. Failing shape: `const done = scope.session(async () => { await parted }); await root.close(); await done // throws, no Result`. Ask: `session.parentClosing` (mode) or `close()` joining the parent's mode.
  From: drivers/t06 sync 2026-09-20
  State: open — one asker

- Four harness promises a user can hit were never written in `packages/harness/README.md`: a `canUseTool` bound in options answers without an `approve` op; an `approve` op overrides it; the frame's MCP server wins over a user `mcpServers` entry under the frame label; unknown SDK message kinds emit to events and the turn continues. Mutation survivors found them; tests now pin them (floor-75). Ask: write the four lines into the README.
  From: mutation/floor-75 harness 2026-09-20
  State: **done** — docs/harness-promises 2026-09-21: all 20 gaps written, `promises.mjs harness` → 0

- `tools/jev`: each new judge bank means editing two lookups by hand — `judgePair(id, cases, bank)` in `evals/lint.mjs` and the `LINT[judge] ?? TESTS[judge] ?? TEST_PAIR[judge] ?? SURVIVORS[judge] ?? JUDGES[judge]` chain in `calibrate.mjs`; miss one and calibration throws on `undefined.q` for the new judge. Ask: one `BANKS` registry both read by judge id (`JUDGES` lives in `lib.mjs`, so it moves or is re-exported).
  From: jev/survivors 2026-09-21 (second asker after jev/tests)
  State: **done** — jev/banks-registry; `BANKS` and `judgeOf` in `tools/jev/bank.mjs` are used by labels, calibration, and evals.

- A cli `respond` cannot set the exit code, so a blocking result must `raise` — the value never reaches `respond`, and the only wire to stderr is the error message. Wanted: a row-level `fail: (value) => { code, text }`, or `respond` receiving `(value, ctx)`. Today `check` returns `{ nodes, findings }` and throws `BlueprintRejected` with the finding lines as its message.
  From: blueprint/t01 2026-09-21 (first asker)
  State: **closed — replaced by @tinker/process**; commands return their exit code and write through `process.io`. A public probe printed a value and returned 1 without raising.

- A fast close (no `onClose` hook, no other close work) never reads `layer.secondary`, so a throwing operation `defer` vanishes from the close result: `const op = operation({ run: (_d, ctx) => { ctx.defer(() => { throw boom; }); return 1; } }); const s = createScope(); s.run(op); (await s.close()).teardownErrors // undefined` — add `s.onClose(() => {})` and it is `[boom]`.
  From: mutation/core-85 2026-09-21 (lead-verified)
  State: **done** — fix/fast-close-secondary `87aebcb` (2026-09-21)

- Extension `run`/`write` hooks wrap the root handle only; a session's `run`, a subflow, and a dep-controller write skip them (core/t35). Ask: the onion on the primitive (`layer.runners`/`layer.writers` inherited at `makeLayer`, chained in `operationController.run` and `dataController.set`; the handle wrappers go, −80 lines). Hot path touched: bench + census before landing
  From: tinkerer (ADR 0053) — second asker; the first is core/t34's row above
  State: **done** — core/ext-hooks-every-layer 2026-09-25

- A sync resource `scope.resolve(r)` and a sync op `scope.run(op)` return plain values, so `return await scope.resolve(r)` inside `try/finally` (close the scope after) trips the `await-thenable` lint; writers drop the `await`, which breaks the day the factory turns async.
  From: blueprint/t02 2026-09-21 (first asker)
  State: candidate — the test recipe in `docs/best-practices.md` could show the `try { return await … } finally { close }` shape with the lint rule set to allow it, or core could type sync results as `T \| Promise<T>` at the seam

- For an async `run`, `Operation.Handle<T, I>` and `Operation.Handle<Promise<T>, I>` both compile against `operation({ run: async … })`; only the second types `scope.run(op)` as a promise at the call site. The factory signature (`R & Scope.AsyncBody<D>`) does not say which to write; the writer found it by grepping `packages/http`.
  From: blueprint/t03 2026-09-21 (first asker)
  State: candidate — a README line under Operations ("an async run is `Operation.Handle<Promise<T>, I>`") or a factory overload that infers it

- `tools/jev`: `preflight.mjs` prints the GUIDE unit-classifier note ("reads like a operation", 62–74%) as a `⚠` beside real judge hits, but `label.mjs` rejects `unit` as an unknown judge, so the writer can neither fix nor record the verdict.
  From: blueprint/t03 and t04 2026-09-21 (two askers)
  State: **done** — jev/unit-note 2026-09-23: the note prints `ℹ`, owes no label. Was: jev/label-unit: either `label.mjs` accepts `unit` (a choice case: declared kind vs pick) or `preflight.mjs` prints the note with a distinct mark and no `⚠`

- `@tinker/cli` has nothing for "the non-flag positionals, in order": a two-argument row (`verify <file> <dir>`) filters `argv` by hand (`argv.filter((a) => !a.startsWith("--"))`) and every future multi-argument command repeats it; `--key-file <path>` makes the filter wrong, since the path is a value not a flag.
  From: blueprint/t06 2026-09-21 (first asker)
  State: **done** — process/positionals 2026-09-25 (second asker nw/tinkerer-ask)

- A cli `respond` cannot write to stderr on a code-0 outcome: `answerSelected` calls `collected.stderr` only on usage (2) or a thrown error (1), so an advisory note beside a success (`verify`'s "body templates skipped: no key") has no channel but stdout.
  From: blueprint/t07 2026-09-21 (first asker; kin of the t01 row "respond cannot set the exit code")
  State: **closed — replaced by @tinker/process**; `io.error` writes at any exit code. A public probe returned 0 with a stderr note.

- A slot annotation types an operation's `ctx.input` with no parse and no cast (`const g: Tinkerer.Gate = operation({ label, run })` — the target type flows into the generic). Nothing documents it, so an author reaches for a cast or writes a builder that narrows the slot instead. Wanted: one line in core's README under Operations
  From: tinkerer (ADR 0057) — first asker; `gate()` was the builder it produced
  State: **done — docs only** ([core: Operation input](../../packages/core/README.md#operation-input)). Enforcing "no parse means no input" was considered and rejected by the user: it complicates the genuinely-unknown case for no gain, so `rawInput` stays permissive and the trap is documented instead

- A subflow that runs as a scope closes throws `Disposed` while `ctx.signal.aborted` can still be `false`, so a driver cannot tell "we were shut down" from "the work failed" by the signal alone. http now checks `isError(e, "Disposed")` explicitly to avoid blaming a transport that was never touched. Wanted: either the signal flips before the dispose, or a documented rule that `Disposed` is the cancellation on that path. A same-tick close also settles `failed` where the pre-subflow shape settled `cancelled`
  From: http (graph/t02, ADR 0058) — first asker
  State: open — http works around it in one line; the question is core's close ordering

- Two sessions (or namespaces) sharing one declared `send` both trace as `http.send` -- the span name is fixed at declaration, so a github call and a stripe call are indistinguishable in the trace. The old factory baked the backend into the label (`github.send`); the declared-unit model (ADR 0059) has one name for all bindings. Wanted: the namespace rides the span as an attribute, so one unit keeps one name and the trace still shows which binding ran.
  From: http/t07 (2026-09-22) and the ns stack probe -- two askers
  State: ticket -- folds into the ns work (ADR 0059): the `(layer, ns, unit)` run attaches `ns` to the operation span

- The old TSDoc said every tagged call was async while a plain run returned its body's type. ADR 0072 now states when an owned call returns a value or waits; the untagged type stays as the body's type.
  From: random-v1/t01 2026-09-22 (**second asker** after blueprint/t02)
  State: **closed — contract now states sync results** (ADR 0072); untagged runs keep the body's type, and owned calls may return a value or promise. The older `await-thenable` concern stays in the blueprint/t02 row.

- The step line's `ms` reads the observe clock (`observe.clock`, default `Date.now`), not the scope's `clock`. The hand-derived `ms` it replaced in hono, mcp, and sync read `ctx.clock`, so a scope built with `makeTestClock` no longer controls those numbers; a hono test dropped its test clock. Wanted: `observe.clock` defaults to the scope's `clock`.
  From: graph/t01 review 2026-09-24 (first asker)
  State: **done** — clock-v1/obs-clock, `57bb9df8`; `makeObs` defaults to the scope clock. The fresh probe freezes both span and log time at 1234.

- A write to one named bucket re-resolves EVERY namespace watcher on that cell (`flushNsWatchers`), so a cell shared by many namespaces pays O(watchers) per write. Measured with sync's `family` (one cell, one namespace per member): 0.12 ms per write at 100 watched members, 0.97 ms at 10000; correct every time. Wanted: index each watcher by the keys in its chain (plus a default-fallthrough set), so a named write to `X` wakes only watchers that can resolve through `X`.
  From: sync family onto ns (namespace-v1/t06, 2026-09-23) -- first asker
  State: **done** — core/ns-watch-index: 10,000 watchers 430 µs → 2.4 µs per write

- A `namespace`-target resource reached through a chain that mixes kinds of namespace builds in the chain's HEAD, even when every binding the build read came from a later namespace. Probe: a tenant pool (`url` bound in `tenant`), resolved first with `ns: [agent, tenant]` then with `ns: tenant`, opens the tenant database TWICE (once under `agent`); in the reverse order it opens once. Order-dependent duplication. Wanted: key the build by the namespace whose bindings it actually used, or give a namespace a way to say it owns tenant resources.
  From: drizzle onto ns (namespace-v1/t05, 2026-09-23) -- first asker
  State: decided (ADR 0064, 2026-09-23): a resolve keeps what it stores under the chain's first key unless the primitive declares otherwise; keying by input source rejected (a node with no namespace input would leak between tenants)

- Two named-watcher wake gaps, older than the watcher index: a named write on the root does not wake a named watcher on a child session; `release(cell)` does not wake named watchers.
  From: core/ns-watch-index review 2026-09-24
  State: done — the child-session half by core/ns-watch-child; the `release(cell)` half by core/release-cell-ns

- Two old namespace-watcher behaviors, the same on main, seen on one layer: a namespace watcher removed partway through a round still fires in that round (default watchers do not); a callback that writes the cell again makes a later watcher see the newer value, then the older one.
  From: core/ns-watch-child review 2026-09-24
  State: open — first asker

- blueprint `verify` links a node to the FIRST unit with its label (`packages/blueprint/src/blueprint.ts:329`); a second unit with that label is ignored with no finding. The CLI adapters share their library operation's name, so they use a named-constant label that `readUnits` skips — a parser gap. Wanted: a `duplicateLabel` finding, or a way to mark a unit as outside the pair.
  From: nw/blueprint-shell 2026-09-24 (first asker)
  State: candidate — blueprint ticket at the second asker

- The commit hook's `vp check --fix` reflows TypeScript inside `.md` code fences to the formatter's 100-character width, so the writing-style rule "code fences under 60 characters" cannot hold: a fence broken at 60 is joined back (probe: `ctx.signal.addEventListener("abort", () => resolve(0), { once: true }),`, 74 characters, now in `packages/mcp/README.md`). The prose lint does not check lines inside fences. Wanted: the formatter skips `.md` fences, or runs with a 60 width for them, or the prose lint reports long fence lines.
  From: nw/docs 2026-09-24 (first asker)
  State: partly done — prose lint reports long fenced lines through `--wide`. Formatter reflow is still open; run the width check after formatting.

- A `.then` promise whose async handler rejects after close stopped waiting, but before the layer is finished, may miss the close result; after the root finishes it reaches the host's unhandled-rejection hook, so it is not silent.
  From: core/caught-subflow review 2026-09-24
  State: candidate

- `tools/jev/promises.mjs` misses a README bullet whose key words fall on its second line, though wrapped bullets are the house style: `- A value flag at the end with no next word` / `  drops nothing.` scored 77% "no line", and 93% once unwrapped. Wanted: join a bullet's continuation lines before matching.
  From: process/positionals 2026-09-25 (first asker)
  State: candidate

- `settle` on an op typed `Handle<unknown, unknown>` is typed as a sync `RunResult` (`Settled<unknown>` collapses), so callers wrap it in `Promise.resolve` to satisfy `await-thenable`. Wanted: `Settled<unknown>` = `RunResult<unknown> \| Promise<RunResult<unknown>>`.
  From: errors/t02-mcp review 2026-09-25
  State: **done** — errors/settle-types

- An error's `origin.path` stops at the `settle` that received it (settle closes the flight): http's final error reads label `http.attempt`, path `[http.attempt]` (before: `http.send`, `[call, http.send]`). By design.
  From: errors/t02-http review 2026-09-25
  State: note

- `settle` adds one tick on a sync throw where `run` does not; a close in that tick lands before the caller reads the Result (http checks `Disposed` first).
  From: errors/t02-http review 2026-09-25
  State: note

- A generic caller cannot pass "a call or none" to an overloaded `settle`: `flow.settle(call)` with `call: Scope.Invocation<I> \| undefined` fails (TS2769), so hono's `settleFlow` casts the argument. `{ rawInput: undefined }` compiles but sends a call object where a void route sends none.
  From: errors/settle-types review 2026-09-26 (hono, first asker)
  State: open

- `NotResolved` raised inside a `start` names only the target label, not the reader: `{"label":"mcp"}` with two `mcp()` extensions said neither which server nor who read too early. Wanted: `{"label":"mcp:admin","reader":"admin.serve"}` (the reading extension's label from its `ExtensionCtx`). Workaround: unique labels per driver instance (`mcp:<name>`, `hono:<name>`), which every driver must remember.
  From: ext/start-order (mcp + hono) 2026-09-26
  State: open — first asker

- A forced close's cancel reason is a plain object marked by a hidden symbol, so `String(reason)` is `[object Object]`: an mcp tool call cut short answers the text `[object Object]`. Wanted: a reason with a readable message (such as an `Error` subclass or a `toString`).
  From: drivers/t08b fix round (mcp) 2026-09-26
  State: **done** — core/cancel-reason (`String(reason)` reads `AbortError: …`)

- `Scope.DataController` declares `watch` (and `get`/`set`/`update`) with method syntax, so handing `controller.watch` to a helper trips `unbound-method`; both implementations are arrow properties that never read `this`. Ask: property signatures (`watch: (listener) => () => void`) in the type in core `src/index.ts`.
  From: sync/source-stop 2026-09-26
  State: open — first asker; the test wraps the call in an arrow

- A graceful close seals writes: in-flight work that writes after `close()` is called throws `Disposed`, so `close({ withData: true })` carries only writes made before the close began. Wanted only if a caller needs the last write of work still finishing.
  From: core/with-data 2026-09-27 (writer + review)
  State: note

- No tool waits for a cell to hold a value, so the tracker's wire keeps one promise per stream (`gate`) so a POST waits for the stream's open — the one rule-13 smell left in ADR 0070's application case. Wanted: a way to await a cell reaching a value (with `ctx.signal`).
  From: tracker/reconnect review 2026-09-27
  State: open — first asker

- Jev tooling on an app: `promises.mjs` assumes `packages/<pkg>` and `tests.mjs` rejects a directory, so the writer steps cannot run on `apps/issue-tracker`.
  From: tracker/reconnect fix round 4 2026-09-27
  State: open — tooling note

- A graceful close does not abort an extension's `ctx.signal`, so an extension whose `start` awaits a resource cannot tell the scope began closing: sync's `subscribe` keeps a `closing` flag set by its close hook (a rule-13 smell forced by core). Wanted: a signal or state an extension `start` can read that says "the scope is closing" on a graceful close too. The close hook gets no scope, so per-scope close state must live on the piece.
  From: sync/transport-unit review 2026-09-27; stack/t07 review 2026-09-29 (second asker)
  State: **ticket** — core/close-hook-scope; ADR 0089 gives close events owner-bound access and NATS no longer patches `scope.close`. Sync still needs its `closing` flag, and graceful-close state remains open.

## Writer learning round, 2026-09-22

- DeepSeek thought useRun error state was forbidden by the learning rules.
  It added screen operations to put notices in cells.
  That works, but a derived message from useRun is also valid.
  The tracker uses both forms. This is teaching feedback, not a core bug.
- DeepSeek found that rawInput without an input parser leaves ctx.input unset.
  The existing core input guide covers this rule.
  No new core ticket; the worker can use typed input or add a real parser.
- GLM blamed stored sorting for needing a creation-order record.
  Creation order is a separate fact, even with a computed sorted view.
  Its new cell is valid app state. No core change is needed.

Reports and source checks are saved in
`~/.local/share/tinker-writer-trial/learn-01/results/repair-1/`.

MiMo Flash reported the same useRun error-state concern as DeepSeek.
Its repair used the earlier rules; the fresh task includes the shared fix:
a message read from useRun.error is allowed.
This is a second report of unclear teaching, not a missing core feature.
It also noted verbose controller types, without a failing public example.
Keep that as a first request for simpler types, not a core change yet.

MiMo Pro also found input shaping and raw error payloads awkward.
Its saved code already reads ctx.rawInput through its source helper.
The fresh action and raw-value checks pass; no failing core example was given.
Keep this with the input-guide feedback above, not as a new API change.

## Fresh stock writers, 2026-09-22

MiMo Flash and DeepSeek both named writable useData as a trap.
GLM also used it despite the operation-owned typing rule.
The public hook permits that code; it is not a runtime bug.
The teacher is adding a plain Jev finding for this forbidden view shape.
No React API removal is approved by this trial.

GLM and DeepSeek both missed notice clearing on successful filter changes.
Their fixes use the existing cell and operation APIs.
A shared success hook was suggested without a failing core example.
Keep that as design feedback, not an approved core change.

The rawInput reports repeat the known input-guide issue above.
The stock writers also saw missing package source-map warnings.
Those warnings did not fail tests or builds.
Proof stays under stock-01/results in the saved trial folder.

## Typed input with no parser, 2026-09-24

Four first attempts across three trials put a non-text id into a
`{ id: string }` error payload. Each passed `tsc`.
Three forms: a cast (GLM, ballot-01), an `unknown` payload parameter
(MiMo Pro, loans-01, ballot-01, kitchen-01), and, in kitchen-01, GLM
reading `ctx.input.ticketId` from an operation with no `input` parser.

Measured on core (`dist`), an operation with no `input` parser:

```text
scope.run(op, { input: { id: 7 } })
  → ctx.input.id is 7 (a number)
scope.run(op, { rawInput: { id: 7 } })
  → ctx.input is undefined
```

`input` is the typed path: core trusts it, and a typed caller cannot
send a number there. Only untyped callers can (plain JS, a transport,
the teacher checker). So core does not lie to typed code.
Not a core ticket. It is a teaching gap, now closed in the writer
rules (42a7e00): a `{ input }` call skips an `input` parser, and a
throwing parser surfaces as DataValidationFailed, so an operation that
untyped code can reach reads `ctx.rawInput` (set for both call styles)
and checks it. locker-01 and cinema-01: no payload miss.
Proof: kitchen-01 worker-3-attempt-1 check-1, teacher 52/53.

- A rejected `ready` settles before its forced close does: core starts the close and rejects `ready` at once, so a root that only awaits `ready` can exit while cleanup still runs. Every root must catch, `await scope.close()`, then rethrow (ADR 0078 §6). ADR 0050 does not say which settles first. Wanted: `ready` rejects only after the forced close ends, or a documented way to wait for it.
  From: tracker/entry-root 2026-09-29 (probe: `ready` rejected while `close` was still pending)
  State: **done** — core/root-lifetime (ADR 0085): `ready` waits for cleanup and close hooks

- An extension's `start` ctx logs nowhere: `ctx.log` there is `OFF_LOG`, so a boot line is dropped even with an observe sink. Stack pieces write to the sink directly. The hono workaround (a resource's logger) adds one `hono.errors` span per scope at boot; it goes when core/start-log lands.
  From: stack/t05, stack/t02 (hono.errors span), stack/t07
  State: **ticket** — core/start-log (after stack/t04)

- W3C `traceparent` parsing and formatting now lives in three packages (hono reads it, http writes it, nats does both). One shared helper, beside the trace types, would keep them in step.
  From: stack/t04 (hono, http), stack/t13 (nats)
  State: **ticket** — core/traceparent (second asker)

- Span times are whole milliseconds (the clock's `currentTimeMillis`), so a span under 1 ms exports with 0 duration; tracing wants sub-ms times.
  From: stack/t13 review
  State: candidate

## A call needs its own stop, 2026-09-30

Tinkerer steering cannot stop a pending HTTP header or retry wait.
Its controller accepts tags and namespace keys, with no call signal.
Stopping the whole conversation would discard the work that must continue.

```ts
const running = session.settle(coder.turn, {
  input: "start",
});
session.controller(coder.inbox).update((entries) => {
  return [...entries, steer("switch")];
});
await running;
```

The first backend waits for abort and never supplies headers.
The replacement request never starts.
A signal supplied on one Core call can stop its child work.
The user chose that boundary for tools such as observers and devtools too.
Status: accepted authoring t17; see ADR 0090.
Proof: `packages/tinkerer/tests/stalled-steer.test.ts`.

## Graceful close blocks active writes, 2026-10-01

Asked by Harness and Tinkerer live entries.
Status: Ready card `core/graceful-writes`.

A root stop should let its running calls finish.
Core marks the layer closed before those calls finish.
A pending call that writes its data then fails with `Disposed`.
The root's `closed` result can still report success.

The live examples record a stop request and skip later calls.
They keep the root open until the current reply ends, then stop it.
This entry rule keeps cleanup correct while Core's drain is fixed.
It does not catch or hide `Disposed`.

The lead ran this reduced case on the built Core entry:

```ts
import { setImmediate } from "node:timers/promises";
import { createScope, data, operation } from "@tinker/core";

const finish = Promise.withResolvers<void>();
const count = data({ initial: 0 });
const write = operation({
  depends: { count: count.controller },
  run: async ({ count }) => {
    await finish.promise;
    count.set(1);
  },
});
const stop = new AbortController();
const root = createScope({ signal: stop.signal });
await root.ready;
const pending = root.createSession().settle(write);
stop.abort();
await setImmediate();
finish.resolve();
const result = await pending;
const closed = await root.closed;
```

Observed: `result.status` is `failed`, its error is `Disposed`,
and `closed.status` is `success`.
Expected: the active write finishes before a successful close.
This does not permit new calls after closing begins.

Log: `/tmp/tinkerer-core-graceful-stop-repro.log`.
Both real entry probes failed before their entry fix.
They now finish the first reply, make one call, and exit 0.

## React ready waits during root stop, 2026-10-01

Asked by stack/t15 server pages.
The browser must wait for React to keep the server HTML.
An effect in the route reports that ready state.
A Core resource cannot report React's commit.

```tsx
useEffect(() => props.ready?.(), [props.ready]);
```

Moving this signal above the route let sync replace its HTML
before React kept it; the list identity test failed.
Putting it only in the list left the 404 page waiting forever.
Each route now owns its ready signal.

A root stop during that wait also let sync open after stop:

```ts
await hydrated.promise;
await event.next();
```

The public browser test saw one sync request instead of zero.
The page now listens to its caller's stop signal.
It releases the wait and checks stop before starting sync.
Its defer removes the listener.
Core's root signal closes gracefully once ready.
It does not abort the hook's signal at that point.

Proof: `stack-t15-stop-hydrate-red.log` in the briefs cache.
The fixed browser test and all 123 tracker tests pass.

## Bad input as a wire reply, 2026-10-03

Asked by `trial/flight-services`.
Status: first caller; may go away with `trial/services-routing`.

A wire service must answer bad input with its own 400 body.
An `input:` reader that throws fails the run instead.
So 12 readers return a `safeParse` result,
and each `run` checks `success` first:

```ts
input: (raw) => orderSchema.safeParse(raw),
run(deps, ctx) {
  if (!ctx.input.success) return reject("bad");
```

ADR 0101 moves parsing to the framework.
If Hono validates before `.run`, this need ends.

## Shared unit with a slot, 2026-10-03

Asked by `trial/flight-services`, then `trial/services-routing`.
Status: second caller; now card `core/extension-slot`.

The supplier and payment services share a call log,
route rules, and a listener, about 170 lines.
Only the service's own action differs.
A shared builder that takes an operation handle breaks ADR 0099.
So each service declares its own copy.
A declared unit with a slot for the action would remove the copies.

Second ask, from `trial/services-routing`:
the shared Hono stack is one extension, `httpRequests`.
Core's extension config has no nested extension list.
So each service's start hook calls the shared hook by hand:

```ts
await httpRequests.hooks!.start!({ ...event, scope });
```

This skips how Core composes extensions.
Installing `httpRequests` beside an app would register it twice.
