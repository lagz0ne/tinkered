# @tinker/core

## Operation input

Pass outside data with `scope.run(op, { rawInput: value })`. Core runs the operation's
input reader before its body. Pass an already typed value with
`scope.run(op, { input: typedValue })`; that path trusts the value and skips parsing.
Tests of rejected outside input should use `rawInput` or the real HTTP/CLI/tool entry.

Every `parse` slot (`data`, `tag`, an operation's `input`) takes one of two shapes:

- a function `(raw: unknown) => T` that returns the value or throws;
- a Standard Schema object (zod, valibot, arktype) passed as-is: `input: z.object({ ... })`.

A schema's refusal arrives as the `DataValidationFailed` cause: `SchemaRejected { issues }`.
A schema that answers with a promise is refused with `SchemaAsync { vendor }`; every edge parses
before it runs.

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
- A watcher measures against the value at subscribe time: one joining after a write fires when the value
  returns to it; one joining after the return fires on the next change.
- The same listener subscribed twice fires twice; each stop ends one subscription.
- An operation can write a cell over time; watchers see each write.
- Two scopes keep separate data: a write in one never shows in the other.
- A data preset replaces the cell for the whole scope; reads see it.
- `isError` rejects a plain error with no kind.
- `isError` rejects a real error of the wrong kind.
- An empty nested meta list reads frozen.
- A data controller get reads the latest write.
- A scope with empty tag bindings reads defaults.
- An operation depending on a non-unit fails with `InvalidDependency`.

### Tags

- A tag reads the nearest binding, in an operation or through the seam, or its default; with neither it
  throws `MissingTag` naming the tag.
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
- A depended-on resource builds before the body runs, read or not; reading it twice builds once.
- An async dependency arrives as its value, read without awaiting; an async factory's thenable resolves
  to its awaited value.
- Concurrent resolves share one in-flight build; later resolves keep the same settled instance and promise.
- A resource that resolves itself fails with `CircularResource` naming the resource.
- `get` before `resolve` fails with `NotResolved` naming the resource; through a closed owner it fails
  with `Disposed`, and a resolve then builds nothing.
- A scope-target resource is one instance shared across sessions, with one shared sticky rejection.
- A session-target resource builds once per session, distinct across sessions; a child's own instance
  survives its parent's release.
- A scope resource that needs a session-only tag fails with `MissingTag`.
- A build in flight when released never publishes — even when the release starts inside its own factory;
  the next resolve rebuilds.
- An old build settling late never drops its replacement; its late rejection never detaches the
  replacement's edges.
- A rejected build is sticky: re-resolve returns the same rejection with no new build, until a release
  of it or of a dependency lets it rebuild fresh.
- Releasing a resource runs its cleanup; a re-resolve builds a new instance. A sync borrower never delays
  it. Releasing a data cell resets it to its initial and notifies watchers.
- Release drops only the resource's cleanup, never a shared `onClose` hook.
- A release whose owner is already closing fails with `Disposed`.
- A rejecting release cleanup surfaces as secondary: the status stands, the error lands in teardown errors.
- Release cascades down: the dependent rebuilds, exactly once across diamonds, while upstream stays built;
  dependents tear down first, and the cascade re-runs no operation.
- A throwing cleanup mid-cascade still drops every dependent's cache; a throwing watcher still runs
  the cleanups.
- Releasing a scope resource cascades into each session's dependents; an uninvolved session keeps its
  instance, a closed or closing one is skipped while the others still release.
- A release waits for a borrower: a running cross-owner operation keeps the resource and its scope
  dependency alive through their cleanups; teardown runs borrower-first.
- A build superseded in flight leaves the rebuilt instance alive: its late cleanup never drops it.
- A release nested inside a release cleanup never hangs close, nor does a session cleanup closing the
  root; closing another scope from a cleanup still awaits its real teardown.
- A resource preset replaces the built instance, builds once per owner, sees the resolved deps, resolves
  async factories, and runs its own cleanup at owner close; the real factory never runs.
- A child session reads its parent's cell value.
- Releasing a resource drops its dependents so they rebuild.
- A throwing operation defer is aggregated as `TeardownFailed`.
- Releasing a cell cascades into a resource behind its controller edge.
- A released resource rebuilds with a fresh generation.
- Releasing a data cell resets it and releases only its dependents.
- A factory that declares no ctx fails its defer with `Disposed`.
- A factory that declares no ctx still reads its abort signal.
- A resource context hands the same abort signal on every read.
- Releasing a diamond leg then the root still tears down the other leg.
- Releasing one resource leaves another resource's cleanup in place.
- Releasing a mid-chain resource tears down each dependent once in order.
- A resource cleanup that rejects asynchronously lands in teardown errors.
- A child session reads its parent's latest write.
- A child update builds on its parent's latest write.
- Releasing a dependency after its dependent never tears down twice.
- A release inside a run drains unrelated cleanups at once.
- A build superseded in flight never publishes its value.
- A build superseded twice never publishes its value.
- A finished borrow is forgotten before the next release.
- A defer from a superseded build never joins the live rebuild's drain.
- A failing start fails the scope with its cause.
- A forced close aborts a nested grandchild session.
- A rejection from a superseded build never goes sticky.
- Get on a rejected build returns its rejection.
- Concurrent resolves share one tracked build.

### Operations

- An operation runs on every run; calls are never memoized and concurrent calls stay independent.
- A tagged call replays typed input inside the child session.
- A tagged call replays raw input inside the child session.
- A tagged call with no input still reads the call tags.
- An operation writes through a data controller edge.
- A sync run retains its span in history before run returns.
- A session body rejected with a primitive keeps its cause under close.
- A dependency snapshot is captured before the body suspends: a later write never leaks in.
- A read-mode dep delivers the current value; a write-mode dep hands the caller a controller that writes.
- An operation composes through its controller, or through a bare dep delivered as a callable subflow;
  a void-input operation is always a callable subflow, never a value.
- An async operation runs to its awaited value.
- A rejecting operation rejects with its cause, and `settled` still drains when it finishes.
- `settled` stays pending until owned work finishes.
- An operation preset replaces the run for a direct call, a downstream subflow, and an inline config.
- An inline run resolves deps, delivers the full context, and shares nothing between runs; with no call,
  `ctx.input` is void. A tagged inline run sees the call's tags; a preset arrives through its deps.
- A tagged call binds the whole flow: run, subflow, and nested subflow all read the call's tags, and a
  tagged call is always async even for a sync operation.
- A tagged run builds session resources in the flow, scope resources at the root; an untagged run builds
  session resources at the root and opens no session; the tagged session closes with the run.
- An operation reads the scope's clock; a resource factory does too (see Clock).
- An operation's context exposes no borrow or drain internals.
- An operation defer sees the run's own end: `success` on return, `failed` on throw, `cancelled` under
  a forced close.
- A rejected promise with an `undefined` cause keeps that cause; a primitive body cause still settles the
  session.
- A preset is scoped to its scope: another scope still builds the real value.

### Scopes, sessions, and close

- A child session reads its parent's cells and tags until it writes its own; the write stays local.
- A nearer shadow wins for descendants below it, and the parent keeps its own value.
- A watcher on the parent still sees the parent's later writes after a child shadows.
- A closed scope's held controller reads the initial value back; late writes fail with `Disposed`.
- Close runs children first, then `onClose` hooks and cleanups latest-first — a later `onClose` before
  an earlier resource cleanup; a dependent's cleanup before its dependency's.
- A throwing hook or cleanup never stops the rest: every cause lands in teardown errors, in order.
- Close is safe to repeat: hooks run once, a re-entering close tears down once, closing again re-reports.
- A clean scope closes `success` when graceful, `cancelled` when forced, and never throws; a second close
  returns the same result.
- A failed start rejects `ready` with its cause and fails the scope.
- A scope with no extensions is ready at once on one shared promise; a session after ready is ready.
- `scope.resolve` reads a cell's current value with no subscription, builds a resource once, and reads a
  tag's nearest binding, default, or throws `MissingTag`.
- `scope.run` shares the controller path: same lookup, same CallArgs rules, stable controller identity.
- A close hook wraps the structural close and sees its result.
- `session(fn)` commits on return and rolls back on throw, closes the child itself, and passes the error
  on; a throwing outcome hook keeps the outcome and aggregates its error.
- Failed owned work fails the session with its cause; a body failure still wins for caller and hooks.
- A failure in a nested session bubbles to the caller and rolls back the leaf; a collecting parent keeps
  a running descendant's real failure and its cleanup error.
- Closing a parent while a session runs joins the body: success commits, failure rolls back.
- A session-owned build that rejects while the session closes still fails the session with its cause.
- A session that finished before any cancel keeps its success; a settled result survives a later
  interrupt; a cancelled session rejects rather than resolving undefined.
- A graceful close still rolls back children of an already-failed scope; a child closing graceful after
  an ancestor abort still rolls its own resources back.
- A failure already known before the cascade rolls back the remaining children.
- A reused error object counts as the later session's own body failure; a child's own throw wins over a
  manual close of the same cause, which never demotes the parent's own body failure.
- `settled` inside `session(fn)` drains owned work without waiting on the body.
- A teardown hook may return its own `close` without hanging; concurrent closes join the one teardown
  and share its error.
- A close whose owned work waits on a child's hook still completes; closing another scope from a cleanup
  still awaits its real teardown and reports its error.
- A forced close aborts in-flight work: a parked op stops, a sleep rejects, the run's defer sees
  `cancelled`, and close settles `cancelled`.
- A close re-entered during a failing teardown reports the failure.
- A close re-entered during a clean forced teardown reports cancelled.
- A forced close with a cleanup still settles cancelled.
- `settled` stays pending until an operation's async cleanup finishes.
- A session hook that throws before next still lets the body run and rethrows the hook error.
- Two session hooks see each ordered end in turn.
- A body that rejects inside session fails the close with its cause.
- A session body that throws sync rejects the session with its cause.
- A cancelled session rejects with its reason.
- A failing teardown inside session still reports the body failure alongside the cleanup error.
- A wrapped session body that throws sync still drains cleanups then reports the cause.
- Three session hooks nest in registration order.
- A close hook sees the settled end.
- A graceful close through hooks settles success.
- A failing body with a failing cleanup reports both causes.
- A session that ends cancelled rejects with its reason.
- Session hooks wrap sessions nested two deep.

### Clock

- An operation and a resource factory read the scope's clock.
- The default clock reads real wall time; a test clock starts where built, moves on advance, jumps on
  set, and keeps precise nanos; a child session reads its parent's clock.
- A test-clock sleep resolves only after virtual time passes it; a zero sleep resolves at once.
- A sleep with an already-aborted signal rejects with the abort reason, on both clocks.
- An aborted sleep rejects with the signal's reason, on both clocks.
- The system clock's nanos advance with wall time after a sleep.
- A system-clock sleep with no signal resolves.
- A system-clock sleep with a live signal resolves.
- Due test-clock sleeps wake earliest-first.
- A system-clock sleep cleans its timer after an abort.
- A test-clock sleep set into the past wakes at once.

### Observation

- With observation off, the context carries no span and nothing is retained.
- With observation on, values and instances keep their identity: measuring changes nothing.
- A subflow nests its span under its caller; two interleaved async operations keep separate trees.
- A failed parse still closes and exports its span as failed; an async resource build opens and closes
  one balanced span.
- Each caller of a shared resource links its own `used` edge; the resource builds once.
- A throwing exporter, a rejecting async exporter, a throwing logger, and a hostile thenable never fail
  the operation and never leak a rejection.
- A child span never calls a non-promise thenable's `then`.
- An inline run yields one span named `inline`, or its label, with the subflow under it; the same config
  run twice yields two spans and two bodies.
- A manual child span exports its event.
- A manual child span that returns a value closes as ok.
- A manual child span that throws closes as failed and rethrows.
- An async child span closes as ok when its promise resolves.
- An async child span closes as failed when its promise rejects.
- Sibling spans carry distinct ids in call order.

### Extensions

- An operation depending on an extension receives the start value after ready; while pending it raises
  `NotResolved` naming the extension.
- Resolving an extension that is not installed throws `NotResolved` naming it; `resolve(ext)` reads the
  extension's own start value, bypassing the resolve chain.
- A run hook sees every call and passes it through unchanged; a start or run hook that skips `next`
  short-circuits: inner starts never run, the refused body never runs.
- `update(fn)` runs through the write chain with the computed value; the wrapped cell controller is cached
  per cell.
- A write chain skips an extension with no write hook.
- A write chain that skips still refuses when the writer denies.
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
- Three write hooks nest in registration order.
- Three resolve hooks nest in registration order.
- A scope with no resolve hooks reads straight through.
- A session chain is installed only when a hook exists.
- Three run hooks nest in registration order.
- Two close hooks nest in registration order.
- A scope with no close hooks closes straight through.
- A forced close with a close hook still settles cancelled.
