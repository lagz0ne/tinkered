# 0050 Extensions are middleware on the scope's verbs; the composition root installs them; `ready` awaits every start

Date: 2026-09-19. Status: accepted. Refines: 0034 (tiers: an extension is the driver tier's home),
0042 (the entrypoint owns the scope — now it also installs the extensions; `command.entry` was the one
place a handle reached userland, an extension's `start` is the second), 0028 (a failed start settles
the scope `failed`), 0048 (sync's `source`/`subscribe` become extensions; readiness = the initial data
set). Refined by the sync amendment's ask: "engines are extensions and contribute to `scope.ready`".

## Context

Drivers hold the scope (hono, cli, mcp, sync) but nothing says who hands it to them, and nothing tells
the composition root when their async startup is done: a subscriber that has not received its initial
snapshots is not ready to render. Core has no `ready` and no extension unit; `Scope.Options` is tags,
observe, presets, clock.

**The analogy is Fastify plus the Koa onion.** Fastify: `app.register(plugin)` hands the instance to
the plugin, plugins start async, `await app.ready()` resolves when every registration finished, a
failed plugin rejects `ready` and the app never serves. Koa/Hono: `use(async (c, next) => { before;
await next(); after })` — each middleware wraps the rest, first registered is outermost, not calling
`next` short-circuits. Ours is smaller: one flat list on the root scope, one chain per verb.

## Decision

1. **An extension is middleware over the scope's verbs.** `Scope.Extension` declares any of five
   hooks, each an onion layer with `next`:

   ```ts
   export type Extension = {
     readonly label: string;
     start?(scope: Handle, ctx: Resource.Ctx, next: () => Promise<void>): Promise<void>;
     resolve?(
       target: Data.Cell<unknown> | Resource.Handle<unknown> | Tag.Handle<unknown>,
       next: () => unknown,
     ): unknown;
     run?(
       op: Operation.Handle<unknown, unknown>,
       call: Invocation<unknown>,
       next: () => unknown,
     ): unknown;
     write?(cell: Data.Cell<unknown>, value: unknown, next: () => void): void;
     close?(options: CloseOptions, next: () => Promise<Result>): Promise<Result>;
   };
   ```

   `start` receives the scope handle (the composition root installed it, so this is `main`'s hand,
   like `command.entry`) and a `Resource.Ctx` whose `defer` runs at scope close and whose `signal`
   aborts on a forced close. Full onion semantics: before-work, `await next()`, after-work; not
   calling `next` short-circuits (a `run` hook may refuse a call, a `write` hook a value).

2. **The composition root installs them:** `createScope({ tags, presets, observe, clock, extensions })`.
   Root scope only in v1; sessions inherit the resolved values. Order is registration order, first is
   outermost, for every chain including `close` (its `next` is the structural close of ADR 0028).
3. **`scope.ready: Promise<void>`** settles when every `start` chain settled. A rejected start rejects
   `ready` AND force-closes the scope (outcome `failed`, ADR 0028): nothing runs on a half-started
   scope. A scope with no extensions is ready at once (an already-resolved promise, shared).
4. **An extension's value is read like a unit's:** `scope.resolve(ext)` delivers what `start`'s chain
   returned once ready (`NotResolved` before). `source()` exposes `connect`; `subscribe(transport)`
   exposes `close`.
5. **A verb with no middleware pays nothing.** Each chain is built once at creation from the
   extensions that declare that hook; an unhooked verb keeps today's direct call. The `op`, `opres`,
   `session`, and `make+resolve` probes are the proof, per verb.
6. **Delivery order (user 2026-09-19):** `start` + `close` ship first (core/t32) with the generic chain
   plumbing and the full `Extension` type; `resolve`, `run`, `write` follow one ticket each with their
   own before/after probe table. Until wired, a declared hook throws `NotSupported` at creation.

```text
createScope({ tags: [sync(counter), sync(todo)], extensions: [subscribe(transport), audit()] })
  start chain:  subscribe.start → audit.start → (structural start)      ← first is outermost
  await scope.ready                                                      ← the viewer holds its initial data set
  scope.resolve(subscribe(transport)) → { close }                         ← the extension's value
  close chain:  subscribe.close → audit.close → closeLayer (ADR 0028)
```

## Consequences

- Sync: `source()` and `subscribe(transport)` become extensions (sync/t06); `subscribe`'s start
  resolves when every key of the initial registration has its snapshot; `source`'s start is sync.
- hono's `tinker(scope)`, the CLI's `run`, and observation exporters could later be expressed as
  extensions; not in scope.
- Core feedback candidates `scope.onMount` and "a resource publishes cells" stay separate asks.
- Budgets: `createScope` with no `extensions` must not move (one property read); the `start`/`close`
  chains are cold paths.

## Alternatives rejected

- **Resources as extensions** (an `eager` list + scope verbs on `Resource.Ctx`) — turns every resource
  into a driver silently; the handle hand-out must be explicit.
- **Before-only hooks** — not a middleware; the onion is what lets an extension refuse or wrap.
- **All five hooks in one ticket** — one blended perf number for five hot-path changes.
- **`ready` rejects but the scope stays open** — a half-started scope serving requests.

## Implementation amendment 2026-09-19 — all verbs wired (core/t35)

The root handle now wraps `resolve`, `run`, and `controller(cell).set/update`. Sessions retain
the plain calls, and a write through a cell controller in an operation dependency bypasses the
write hook in v1. An unhooked verb keeps its plain function. Wrapped cell controllers retain
their identity per cell. All five hooks are wired; the temporary `NotSupported` error is removed.

The shipped type extends the initial sketch: `Extension<T>.start` returns `T | PromiseLike<T>`,
which supplies `resolve(ext)` after readiness. A `run` hook also accepts an inline operation
config and an optional invocation, just as `scope.run` does. Store each extension once, then
install and resolve that same object (`const sub = subscribe(transport)`); calling the builder
again creates a different identity.
