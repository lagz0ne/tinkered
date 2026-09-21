# @tinker/core

## Operation input

Pass outside data with `scope.run(op, { rawInput: value })`. Core runs the operation's
input reader before its body. Pass an already typed value with
`scope.run(op, { input: typedValue })`; that path trusts the value and skips parsing.
Tests of rejected outside input should use `rawInput` or the real HTTP/CLI/tool entry.

## Extensions

An extension is middleware over the scope's verbs (ADR 0050). Declare it with
`extension({ label, start, close })`, install it at the composition root with
`createScope({ extensions })`, wait with `await scope.ready`, and read its
value with `scope.resolve(ext)`.

```ts
import { createScope, extension } from "@tinker/core";

const events = extension({
  label: "events",
  start: (scope, ctx, next) => {
    ctx.defer((end) => console.log("closed:", end.status));
    return next().then(() => ({ connect: () => true }));
  },
  close: (opts, next) => next(),
});

const scope = createScope({ extensions: [events] });
await scope.ready;
scope.resolve(events).connect();
await scope.close({ graceful: true });
```

A `resolve` hook wraps snapshot reads on the root handle (first registered is outermost; skip
`next()` to short-circuit with a substitute):

```ts
const gate = extension({
  label: "gate",
  resolve: (target, next) => (allowed ? next() : "denied"),
});
```

A `run` hook wraps operation calls on the root handle (first registered is outermost; skip
`next()` to refuse a call with a substitute):

```ts
const audit = extension({
  label: "audit",
  run: async (_op, _call, next) => {
    console.log("before");
    const out = await next();
    console.log("after");
    return out;
  },
});
```

Await `ready` before the first `resolve(ext)`.

A `write` hook wraps cell writes on the root handle (first registered is outermost; skip
`next()` to refuse a write, leaving the value and watchers unchanged):

```ts
const even = extension({
  label: "even",
  write: (_cell, value, next) => {
    if (typeof value !== "number" || value % 2 === 0) next();
  },
});
```

A request's reads, calls, and writes are not wrapped yet: sessions created from an extended
scope read, run, and write with the plain dispatch (the v1 limit). A write that reaches the cell
through a `depends: { x: cell.controller }` edge inside an operation runs on the layer directly
and is not wrapped either (the v1 limit).

## Resource cleanup

Stop in-flight work through `ctx.signal`. A forced close aborts the signal, waits for
in-flight operations and resource builds to settle, then runs resource `ctx.defer` hooks.
Waiting until `defer` to stop work that close is waiting for can deadlock.

An async factory can register `ctx.defer` after an `await`, up until its returned promise
settles, including while close waits for that factory. Registration after the factory has
settled throws `Disposed`.

After an `await`, the signal may already be aborted. Use `ctx.signal.throwIfAborted()`
before starting more work. When forwarding cancellation to a separate `AbortController`,
check `ctx.signal.aborted` first: abort it immediately if true; otherwise add the abort
listener. A listener added after abort will not fire. For lazy work, check again at the
point that actually starts it.

## Closing and cell writes

Core seals a layer's cell writes when its close begins. Later writes throw `Disposed`,
including writes through held controllers from an abort
listener, an operation catch, or a resource `defer`. A forced close cannot record a final
status in that layer's cells. Read the returned `Scope.Result` instead: a clean forced close
is `cancelled`; a real failure can make it `failed`.

`close({ graceful: true })` waits for work to finish without first aborting it. Use plain
`close()` when the work needs a stop signal. The first close call chooses the mode; a later
forced close does not upgrade a graceful close already in progress.

## Sessions and cell writes

A child session inherits its parent's cells until it writes its own value. That write stays
in the child's copy: it does not change the parent or notify the parent's watchers. Closing
the child does not merge its cell values back into the parent.

A driver whose shared state belongs to the source scope must read and write through that
scope's handle, such as `scope.controller(cell).set(value)`. A cell controller supplied in
a session operation's `depends` writes to that session.

## Tags

`scope.resolve(tag.all)` returns bindings nearest layer first, and last binding first
within each layer. For example, bindings `[region("first"), region("last")]` are read as
`["last", "first"]`. A driver that needs declaration order must arrange that order itself.

A custom binding builder names the value types it can return in `Tag.Binding<T>`. A binding
with a narrower value type can be assigned to one with a wider union of value types.

Every list a config takes is a `Many<T>`: one item, nothing (`null`, `undefined`, or `false`),
or a list of those to any depth. That covers a unit's `meta`, a scope's or session's `tags`, a
call's `tags`, `presets`, `extensions`, and every driver's rows (`routes`, `tools`, `commands`,
`cells`). Core reads it once, flat, in authored order, so optional and grouped items need no
spread:

```ts
const shared = [group("net"), audit && trace(true)]; // only `false` is "nothing", never 0 or ""
const port = data({ initial: 8080, meta: [ui("slider"), shared] });
scope.run(op, { tags: zone("us") }); // a single binding is a tagged call
scope.createSession({ tags: [request(raw), wiring.tags?.(c)] }); // an absent group is skipped
createScope({ extensions: [scope?.extensions, ext] }); // same for extensions and presets
```

A call whose `tags` is nothing, or a list that flattens to nothing, is an untagged call: it runs
inline and opens no session. A driver reads its rows with `readMany(rows)` at its seam; when the
rows are themselves arrays (sync's `[cell, key]` pairs) it passes the row discriminator.

## Observation

Enable `observe.history` to retain a bounded list of completed spans for `scope.spans()`.
Each resource build emits a `resource` span, so tests can count builds without a test-only
hook. If you keep the scope handle, its retained history is still readable after close.

When a driver creates its own scope and returns only its result (as the CLI does), pass
`observe.export` in the scope options before starting it. The callback receives each span
as it ends, including spans that finish during close; save those spans outside the driver.
Export works without retained history.

## Promises

This appendix states each behaviour the seam tests pin, one line per promise, grouped by unit.
`node tools/jev/promises.mjs core` is its check: every seam-test title names a line below.
Titles that name no user-facing guarantee (type checks, budgets, past-bug regressions) carry no line.

### Data

- A cell reads its initial value through `parse`, so the first read is already the typed value.
- `set` and `update` show on the next read.
- A watcher sees each next value beside its previous one.
- A write that fails `parse` throws `DataValidationFailed` naming the cell, and the value stays.
- A watcher fires once per real change: an equal write fires nothing, and stopping ends it.
- A watcher measures against the value at subscribe time: one that joins while dirty fires when the value
  returns, one that joins clean fires on the next change.
- The same listener subscribed twice fires twice; each stop ends one subscription.
- An operation can write a cell over time; watchers see each write.
- Two scopes keep separate data: a write in one never shows in the other.
- A data preset replaces the cell for the whole scope; reads see it.

### Tags

- A tag reads the nearest binding, in an operation or through the scope seam, or its default; with neither
  it throws `MissingTag` naming the tag.
- Resolving a tag edge delivers its form: `all` lists nearest-first, `optional` reports presence,
  `required` reads or throws.
- `optional` tells absent apart from an undefined default: the default reads present, the missing reads
  absent.
- A tag binding runs through `parse`; a bad value throws `DataValidationFailed` naming the tag.
- A unit carries static tag meta, readable off its handle.
- Meta never affects resolution; no meta reads as empty.
- The shared empty meta is frozen: pushing to one unit's meta cannot leak into others.

### Resources

- A scope resource builds once; every resolve shares the one instance.
- A resource factory sees its owner's current deps.
- A depended-on resource builds before the body runs, whether or not the body reads it; reading it twice
  builds once.
- An async dependency arrives as its value: the body reads it without awaiting; an async factory's
  thenable resolves to its awaited value.
- Concurrent resolves share one in-flight build; later resolves keep the same settled instance and promise.
- A resource that resolves itself fails with `CircularResource` naming the resource.
- `get` before `resolve` fails with `NotResolved` naming the resource; through a closed owner it fails with
  `Disposed` instead of a stale value, and a resolve through a closed owner builds nothing.
- A scope-target resource is one instance shared across sessions, with one shared sticky rejection.
- A session-target resource builds once per session, distinct across sessions; a child session's own
  instance survives its parent's release.
- A scope resource that needs a session-only tag fails with `MissingTag`.
- A build in flight when released never publishes — even when the release starts inside its own factory;
  the next resolve rebuilds.
- An old build settling late never drops its replacement, and its late rejection never detaches the
  replacement's edges nor fails a session holding the replacement.
- A rejected build is sticky: re-resolve returns the same rejection with no new build, until a release —
  of it or of a dependency — lets it rebuild fresh.
- Releasing a resource runs its cleanup; a re-resolve builds a new instance. Releasing a data cell resets it
  to its initial and notifies watchers.
- Release drops only the resource's cleanup, never a shared `onClose` hook.
- A release whose owner is already closing fails with `Disposed`.
- A rejecting release cleanup surfaces as secondary: the outcome keeps its status and the error lands in the
  teardown errors.
- Release cascades down: the dependent rebuilds, exactly once across diamonds, while upstream stays built;
  dependents tear down before dependencies. A cascade re-runs no operation.
- A throwing cleanup mid-cascade still drops every dependent's cache; a throwing watcher during release still
  runs the cleanups.
- Releasing a scope resource cascades into each session's dependent instances; a session that never depended
  keeps its instance, a closed session is skipped, and a closing session is skipped while the others still
  release.
- A release waits for a borrower: a running cross-owner operation keeps the resource and its scope
  dependency alive through their cleanups; teardown runs borrower-first, even for a sync operation's async
  cleanup.
- A build superseded while in flight leaves the rebuilt instance alive: its late cleanup never drops the
  replacement.
- A release nested inside a release cleanup, and a release from a session cleanup that closes the root,
  neither hangs close; closing another scope from a cleanup still awaits its real teardown.
- A resource preset replaces the built instance for downstream consumers, builds once per owner and caches,
  sees the resolved deps, resolves an async factory to its awaited value, and runs its own cleanup at owner
  close while the real factory never runs.

### Operations

- An operation runs on every run; calls are never memoized and concurrent calls stay independent.
- A dependency snapshot is captured before the body suspends: a later write never leaks into a running call.
- A read-mode dep delivers the current value; a write-mode dep hands the caller a controller that writes.
- An operation composes through its controller, or through a bare dependency delivered as a callable subflow;
  a void-input operation is always a callable subflow, never a value.
- An async operation runs to its awaited value.
- A rejecting operation rejects with its cause, and `settled` still drains when it finishes.
- An operation preset replaces the run for a direct call, a downstream subflow, and an inline config.
- An inline run resolves deps, delivers the full context, and shares nothing between runs; a tagged inline
  run sees the call's tags, and an inline config still receives a preset resource through its deps.
- A tagged call binds the whole flow: the run, a subflow, and a nested subflow all read the call's tags, and
  a tagged call is always async even for a sync operation.
- A tagged run builds session resources in the flow and leaves scope resources at the root; an untagged
  run builds session resources at the root and opens no session; the tagged session closes with the run.
- An operation reads the scope's clock; a resource factory does too (see Clock).
- An operation's context exposes no borrow or drain internals.
- An operation defer sees the run's own end: `success` on return, `failed` on throw, `cancelled` under a
  forced close.
- A rejected promise with an `undefined` cause keeps that cause; a primitive body cause still settles the
  session.
- A preset is scoped to its scope: another scope still builds the real value.

### Scopes, sessions, and close

- A child session reads its parent's cells and tags until it writes its own; the write stays local.
- A nearer shadow wins for descendants below it, and the parent keeps its own value.
- A watcher on the parent still sees the parent's later writes after a child shadows.
- A closed scope's held controller reads the initial value back; late writes fail with `Disposed`.
- Close runs children first, then `onClose` hooks and resource cleanups latest-first; a dependent's cleanup
  runs before its dependency's.
- A throwing hook or cleanup never stops the rest: every cause lands in the teardown errors, in execution
  order.
- Close is idempotent: hooks run once, a re-entering close tears down once, and closing again re-reports the
  same result.
- A clean scope closes `success` when graceful, `cancelled` when forced, and never throws; a second close
  returns the same result.
- A failed start rejects `ready` with its cause and fails the scope.
- A scope with no extensions is ready at once on one shared promise; a session after ready is already ready.
- `scope.resolve` reads a cell's current value with no subscription, builds a resource once like its
  controller, and reads a tag's nearest binding, default, or throws `MissingTag`.
- `scope.run` shares the controller path: same lookup, same CallArgs rules, stable controller identity.
- A close hook wraps the structural close and sees its result.
- `session(fn)` commits on return and rolls back on throw, closes the child itself, and passes the error to
  the caller; a throwing outcome hook keeps the outcome and aggregates its error.
- Failed owned work fails the session with its cause; a body failure still wins over owned-work noise for the
  caller and the hooks.
- A failure in a nested session bubbles to the caller and rolls back the leaf; a parent collecting while a
  child runs keeps the child's real failure and its cleanup error.
- Closing a parent while a session runs joins the body: success commits, failure rolls back.
- A session that finished before any cancel keeps its success, a settled body result survives a later
  interrupt, and a cancelled session rejects rather than resolving undefined.
- A graceful close still rolls back children when the scope already failed; a child closing graceful after an
  ancestor abort still rolls its own resources back.
- A failure already known before the cascade rolls back the remaining children.
- `settled` inside `session(fn)` drains owned work without waiting on the body.
- A teardown hook may return its own `close` without hanging; concurrent closes join the one real teardown
  and share its error.
- A close whose owned work waits on a child's hook still completes; a cleanup closing another scope still
  awaits that scope's real teardown and reports its error.
- A forced close aborts in-flight work: a parked operation stops, a sleep rejects, the run's defer sees
  `cancelled`, and close settles `cancelled`.

### Clock

- An operation and a resource factory read the scope's clock.
- The default clock reads real wall time; a test clock starts where built, moves on advance, jumps on set,
  and keeps precise nanos under truncated millis.
- A test-clock sleep resolves only after virtual time passes it; a zero sleep resolves at once.
- An aborted sleep rejects with the signal's reason, on both clocks.

### Observation

- With observation off, the context carries no span and nothing is retained.
- With observation on, returned values and resource instances keep their identity: measuring changes nothing.
- A subflow nests its span under its caller; two interleaved async operations keep separate trees.
- A failed parse still closes and exports its operation span as failed; an async resource build opens and
  closes one balanced span.
- Each caller of a shared resource links its own `used` edge; the resource builds once.
- A throwing exporter, a rejecting async exporter, a throwing logger, and a hostile thenable never fail the
  operation and never leak a rejection.
- A child span never calls a non-promise thenable's `then`.
- An inline run yields one span named `inline`, or its label, with the subflow nested under it; running the
  same inline config twice yields two spans and two bodies.

### Extensions

- An operation depending on an extension receives the start value after ready; on a still-pending extension
  it raises `NotResolved` naming the extension.
- Resolving an extension that is not installed throws `NotResolved` naming it; `resolve(ext)` bypasses the
  resolve chain.
- A run hook sees every call, including an inline config, and passes the call through unchanged; a tagged
  call still opens its child session under the hook.
- `update(fn)` runs through the write chain with the computed value; the wrapped cell controller is cached
  per cell.
- Resource and operation controllers from the extended handle stay plain: reads and runs bypass the write
  chain untouched.
- A tagged call runs the session chain once; a session under a session is wrapped; with no session hook,
  sessions run as before.
- Session hooks nest in registration order and each sees the end status.
- A throwing session hook rejects the session with its error; a hook that skips `next` still lets the
  session run and close.
- A session felled by a forced parent close settles the hook chain as `cancelled`; under a graceful close it
  settles as `success`.
- `session(fn)` reports the close end through the chain: success, a failed run, a forced close.
