# @tinkered/core

## Install

```bash
bun add @tinkered/core
```

On Node 22.18 or later, with npm:

```bash
npm install @tinkered/core
```

Each release also attaches tarballs to its
GitHub release; the
[changelog](../../CHANGELOG.md) lists them.

## Scope handles

A scope handle is passed by reference (ADR 0108).
Do not copy it with spread or pull out its verbs.

Plain scopes and both session forms share their verbs on one prototype,
the object they inherit from.
Opening and closing a plain scope makes no own verb functions.

Only `release` may be passed on its own, as in `cells.forEach(scope.release)`.
Its function is tied to the handle.
It is made on first read and kept for later reads.

## Test helpers

The main entry exports no test helpers.
Import them from `@tinkered/core/testing`:

```ts
import { createScope, data } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { makeTestRandom } from "@tinkered/core/testing";
import { preset } from "@tinkered/core/testing";
import type * as Core from "@tinkered/core";
import type { Clock, Random } from "@tinkered/core/testing";

const time: Clock.Options = { now: 100 };
const seed: Random.Options = { seed: 42 };
const clock: Clock.Test = makeTestClock(time);
const random: Core.Random.Handle = makeTestRandom(seed);
const source: Core.Clock.Handle = clock;
const count = data({ initial: 0 });
const scope = createScope({
  clock: source,
  random,
  presets: [preset(count, 3)],
});
await scope.close();
```

`Clock.Handle` and `Random.Handle` stay in `@tinkered/core`.
`Clock.Test`, `Clock.Options`, and `Random.Options` live in
`@tinkered/core/testing`.
`preset` also lives in `@tinkered/core/testing`.
`Scope.Preset` and the scope's `presets` option stay in
`@tinkered/core`.
The test entry ships in the package beside the main entry.
Test files and source files do not ship.

### Test tooling

A capsule's author ships test tooling as a plain capsule
in a `*.testing.ts` file (ADR 0131). Only test files import
it, so a prod build leaves it out. An app's build check
refuses any `*.testing.ts` file in a prod bundle.

```ts
// auth.testing.ts
const signIn = operation({
  label: "auth.testing.signIn",
  depends: { verify: auth.verify },
  run: ({ verify }) => verify.run({ input: TEST_CODE }),
});

export const authTesting = capsule({
  label: "auth.testing",
  exports: { signIn },
});
```

```ts
// auth.test.ts
await using app = createScope({
  capsules: [auth({ api: fakeApi }), authTesting],
});
await app.run(authTesting.signIn);
```

- Its label is `auth.testing`.
- It takes `config`, `tags`, `exports`, and `hooks`, as a capsule does.
- It reaches `auth` through its exports only.
- Its ops reach `auth` through `auth`'s exports.
- So without `auth` installed, such a run raises `CapsuleMissing`.

## Operation input

Pass outside data with `scope.run(op, { rawInput: value })`. Core runs the operation's
input reader before its body. Pass an already typed value with
`scope.run(op, { input: typedValue })`; that path trusts the value and skips parsing.
Tests of rejected outside input should use `rawInput` or the real HTTP/CLI/tool entry.

An operation needs no `input` reader when its caller builds the value. The slot it fills
names the type, and that annotation types `ctx.input` — no reader, no cast:

```ts
const guard: Tinkerer.Gate = operation({
  label: "guard",
  depends: { allowed },
  run: (_deps, ctx) => ({
    allow: ctx.input.mode !== "read-only",
  }),
});
```

`rawInput` belongs to an operation that parses: it is the process edge. Handing `rawInput`
to an operation with no reader leaves `ctx.input` `undefined` — there is nothing to parse
it with. A frame that builds the value calls `{ input }`.

Every `parse` slot (`data`, `tag`, an operation's `input`) takes one of two shapes:

- a function `(raw: unknown) => T` that returns the value or throws;
- a Standard Schema object (zod, valibot, arktype) passed as-is: `input: z.object({ ... })`.

A schema's refusal arrives as the `DataValidationFailed` cause: `SchemaRejected { issues }`.
A schema that answers with a promise is refused with `SchemaAsync { vendor }`; every edge parses
before it runs.

A run passes objects the way a function call does: no copy.

- `{ input: obj }` reaches `ctx.input` as `obj` itself. Core never copies it or freezes it.
- `{ rawInput: obj }` reaches `ctx.rawInput` as `obj`. `ctx.input` is what the parser returns.
- The caller gets the body's return value itself, or a promise of it.
- This holds for a scope run, a session run, and a controller run, tagged or namespaced.
- So a body that changes its input changes the caller's object.

## Root lifetime

A root given `capsules` has a starting type (ADR 0127, ADR 0128):

```ts
await using app = createScope({ capsules: [db] });
const rows = await app.run(listRows);
```

```ts
const live = await createScope({ capsules: [db] }).ready;
const now = live.run(countRows);
```

- On `app`, `run`, `settle`, `session` and `controller(op).run`
  always return a promise.
- A call made before start ends waits for start.
- After a failed start or a close, a waiting `run` raises `Disposed`.
- A waiting `settle` returns its result; it never throws.
- `ready` resolves to the started handle; its sync calls stay sync.
- `isStarting(scope)` tells the two apart.
- A root with no `capsules` is a plain handle, as before.
- `await using` closes the scope at the end of the block.

Give a root a stop signal and await its final Result (ADR 0085):

```ts
const scope = createScope({ ...pieces, signal: stop });
const end = await scope.closed;
process.exitCode = exitCode(end);
```

- `signal` asks the root to close gracefully once `ready` resolves.
  An abort before or during start waits for start to end.
  The root stays usable until then.
  In-flight work can finish; the stop never aborts `ctx.signal`.
  A waiting run hook and its cleanup count as in-flight work.
- A failed start records its error and closes through the handle's current `close`.
  Every close hook runs, including its after-work.
  `ready` rejects with the start error only after that forced close ends.
  A close already under way in core wins; the failed start joins it without running hooks again.
  An abort adds no second close once a close reaches core.
  A replaced `close` that waits first (NATS drains) is seen only when it calls core's close.
- The root drops its abort listener as soon as a close reaches core, before the hooks run.
  A signal close runs each hook with `graceful: true`.
  A later forced close joins it and keeps its Result.
- Only a root given a `signal` has `closed`; sessions take no stop signal.
  `closed` stays pending while open, settles once, and never rejects.
  It holds core's own Result after the close hooks finish their after-work.
  A hook's returned substitute does not change it.
  Each ordinary `close()` shares that Result; the first call's `withData` wins.
- Root close hooks run once, even across repeated close calls.
  Skipping `next()` still runs inner hooks and resource cleanup.
  Repeating `next()` joins its first call.
  A hook cannot replace Core's Result.
  A hook's throw is a teardown error in both `close()` and `closed`.
  Both wait for every close hook's after-work.

The exit-code choice stays outside core.
Stack uses 1 for a failed Result or any teardown error, and 0 otherwise.
A cancelled Result is a clean stop there.
Process keeps its own forced stop and exit code 130.

```ts
import type { Scope } from "@tinkered/core";

function exitCode(end: Scope.Result): number {
  if (end.status === "failed") return 1;
  if (end.teardownErrors?.length) return 1;
  return 0;
}
```

## Capsules

A capsule is a library's door (ADR 0121).
It holds the library's config, its hooks, and the units it exports.
Make one with `capsule()` and install it with `createScope({ capsules })`.
Wait with `await scope.ready`, then read its start value with `scope.resolve(mail)`.
A library that reads tags declares them as its `config` ([Config](#config)).

```ts
import { capsule, createScope } from "@tinkered/core";

export const mail = capsule({
  label: "mail",
  config: { smtpUrl, from },
  exports: { enqueue, send },
  hooks: {
    start: async ({ run }) => {
      await run(migrate, {}, {
        role: "setup",
        explain: "Brings the outbox up to date",
      });
    },
  },
});

const scope = createScope({
  capsules: [mail({ smtpUrl: url, from: "ops@example.com" })],
});
await scope.ready;
scope.run(mail.enqueue, { input: message });
await scope.close({ graceful: true });
```

A capsule with no required key is called with nothing: `health()`.
It also installs uncalled: `capsules: [health]`.

Start has a 10 000 ms limit on the scope clock (ADR 0119).
Set `createScope({ startTimeout: 5_000 })` to change it.
A hanging start rejects `ready` with `StartTimeout`.
Its payload holds the capsule's `label`.
Core closes the scope and runs cleanup before `ready` rejects.
The label names the innermost start still waiting.
A settled start cancels the timer.
Closing the root cancels it and rejects pending `ready` with the close reason.
Set `createScope({ startTimeout: 0 })` or `Infinity` to turn the timer off.
Negative limits and `NaN` raise `BadStartTimeout`.
Finite limits are capped at 2 147 483 647 ms.
A clock sleep throw or rejection leaves startup waiting without a timeout.

### Hooks

Each hook takes one event object.
`event.kind` names the hook and narrows its fields.
Common access is built on first use.
Reading `op`, `call`, `ns`, or `next` does not build that access.

- `start`: `next()`; returns the start value. Every start runs once, in `capsules` order.
- `run`: `op`, the original `call`, `next()`.
- `write`: `cell`, `value`, `next()`.
- `resolve`: `target`, `next()`.
- `close`: `options`, `next()` returns the close result. Close hooks run in reverse order.
- `session`: `handle`, `next()` returns the session result.

`resolve`, `run`, `write`, and `session` are onion middleware: install order, first is outermost.
A `start` that skips `next()` still lets the next start run once it returns.
A `close` that skips `next()` cannot skip cleanup (ADR 0085).

### What a hook reaches

Every event has `config`, `load`, `run`, and `settle`.
None has `resolve`, `controller`, or `scope`.

- `config`: the config values, read once after the binding, with defaults filled.
- `load(unit, meta, options?)`: a resource answers a promise of its value; a cell answers its
  controller. `options.ns` reads it in that namespace; one made with `observe: false` is quiet.
- `run(op, options, meta)`: what `scope.run` answers, as a promise. No controller is made.
- `settle(op, options, meta)`: what `scope.settle` answers, as a promise.

The meta is what devtools show: `{ role, explain }`.
`role` is `setup`, `worker`, `handler`, or `state`.
Call options (`input`, `rawInput`, `signal`, `ns`, `tags`) go on the run, never in the meta.

```ts
const active = data({ initial: 0 });
const audit = capsule({
  label: "audit",
  hooks: {
    run(event) {
      const count = event.load(active, {
        role: "state",
        explain: "Counts runs in flight",
      });
      count.update((value) => value + 1);
      event.defer((end) => {
        event.log("finished", { status: end.status });
      });
      return event.next();
    },
  },
});
```

They use the hook's own owner, effective `ns` chain, trace, signal, and lifetime.
A controller one request loaded never serves another.
Run hooks share the run's trace, cancellation, and `defer` cleanup.
Other hooks defer cleanup to their session; start and close use the root.
All events also have `closing`, `signal`, `obs`, `log`, `clock`, `random`, and `raise`.
A namespace chain selects buckets in that owner; it does not find a sibling session.
A hook reads a tag through a unit that depends on it, or through a config key.

In a `close` hook, `load` reads units already built on the root until `next()` releases them.
After that, and for a unit never built, it raises `Disposed`.

`Capsule.Events[keyof Capsule.Events]` is the union of these event shapes.
`Capsule.Events["run"]` names one shape.
A run hook may refuse raw input before its parser runs.

One run hook serves every operation, so its event is untyped.
`event.is(op)` says if the run is `op`'s; a true answer gives `op`, `call`, `input`, and
`next()` that operation's types (ADR 0142).
`event.input` is the input the body gets: the caller's `input`, or its `rawInput` through the
operation's parser. A bad raw input raises `DataValidationFailed` at the read.

```ts
const tide = capsule({
  label: "tide",
  hooks: {
    run(event) {
      if (!event.is(press)) return event.next();

      const hue = event.next();
      const input = { ...event.input, hue };
      return event.run(send, { input }, meta);
    },
  },
});
```

Graceful close joins hook waits before and after `next()`.
After a run finishes, a saved `next()` raises `Disposed` and starts no body.
A waiting hook can still use its saved `load` and `run` during graceful close.
Saved data controllers can read, update, and watch through the run's deferred cleanup.
Forced close aborts its signal and prevents a late `next()` from starting the body.
Resource loads through a run event retain the selected instance through hook and run cleanup.
A hook that starts `next()` and returns a substitute still owns that body's work.
That body keeps its span open until it ends; its failure still marks the span.
Catching a body's panic in its hook does not erase the owner's failure.
A hook-started run shares the active trace; a dropped failure stays on the owner.
`event.settle` receives a child failure without failing the owner.
A saved `settle` returns `cancelled` when a waiting hook is forced closed.
It returns `failed` with `Disposed` when called after that hook ends.
A run in a namespace made with `observe: false` leaves no span and no log line.

A tagged call enters its actual child before run hooks start.
Its session hook runs before its run hook; each runs once.

Start and close can load a root-owned resource to keep state apart across roots.
Concurrent and repeated closes join the same close hook once.

Resolve hooks cover direct root `resolve` calls only.
Session reads, dependency reads, controller reads, and event loads bypass them.

A `resolve` hook wraps snapshot reads on the root handle (skip `next()` to short-circuit with a
substitute):

```ts
const gate = capsule({
  label: "gate",
  hooks: {
    resolve: (event) => (allowed ? event.next() : "denied"),
  },
});
```

A `run` hook wraps every operation call, on the root or in a session (skip `next()` to refuse a
call with a substitute):

```ts
const audit = capsule({
  label: "audit",
  hooks: {
    run: async (event) => {
      console.log("before");
      const out = await event.next();
      console.log("after");
      return out;
    },
  },
});
```

Await `ready` before the first `resolve(capsule)`.

A `start` can read, after `await next()`, only capsules listed after it.
So list a capsule that reads a server before that server: `[serve, server]`.

A `write` hook wraps cell writes at every layer (skip `next()` to refuse a write, leaving the value
and watchers unchanged):

```ts
const even = capsule({
  label: "even",
  hooks: {
    write: (event) => {
      const { value } = event;
      if (typeof value !== "number" || value % 2 === 0) {
        event.next();
      }
    },
  },
});
```

A session read still skips `resolve` hooks; its runs and writes use inherited `run` and `write` hooks.
A root run and a session run each invoke the `run` hook once.
A tagged run invokes its `run` hook once with the original call, not again on its child session.
A subflow invokes `run` hooks once even when its caller is another operation.
An inline run in a session passes its original inline config to the `run` hook.
A `run` hook that skips `next()` stops a subflow and returns its substitute to the caller.
A `run` hook that throws stops a subflow before its body and throws to its caller.
An async `run` hook keeps a dropped subflow's rejection on the scope, not the host.
A root write and a session write each invoke the `write` hook once.
A write through a `depends: { x: cell.controller }` edge invokes the `write` hook.
A namespaced write invokes the `write` hook once and stores its value in that namespace.
Two hooks keep install order for both runs and writes on child layers.

### Exports

Exports are copied onto the handle and every binding (ADR 0057).
An op, a resource, or a tag is the same object: `mail.enqueue === enqueue`.
A cell is not. It shows as a read view (ADR 0123):

```ts
const talk = capsule({ label: "talk", exports: { point, clear } });

depends: { point: talk.point, clear: talk.clear }
// point.get(), point.watch(fn): no set
```

- A read view has no `controller` and no path to the cell.
- `depends`, `scope.resolve`, and a hook's `load` hand a reader: `get()` and `watch()`.
- `useData(talk.point)` reads it in React.
- A `depends` that names `talk.point.controller` is a type error, and `InvalidDependency` at
  first touch.
- To change the cell from outside, call an op the capsule exports.
- The raw cell, imported from its own file, keeps full power. Lint `tinker/cell-write` warns
  on `.controller` of another capsule's cell.

A value that is not a unit is a foreign export (ADR 0125), such as a React component:

```ts
const talk = capsule({ label: "talk", exports: { said, say, Panel } });
// <talk.Panel title="Talk" />
```

- It is the same object on the handle and on each binding, with its type.
- Core never marks, checks, or resolves it. It may be frozen.
- `CapsuleMissing` comes from the exported units it touches.

`label`, `config`, `hooks`, `exports`, and `tags` are reserved: a type error, and `ReservedExport`.

A capsule may carry fixed tags: `capsule({ label, tags: [side("server")] })`.
They take what `createScope({ tags })` takes and bind on the root at install, before the
command's own `tags`.
A tag bound twice follows the root list rule: the last binding wins, so a later capsule wins
over an earlier one, and the command's `tags` win over every capsule.
The record shows them in `tags`, by tag label.

An export needs its capsule.
A scope that first touches an exported unit whose capsule it does not install raises
`CapsuleMissing` with `{ unit, capsule }`, before any work.
A first touch is a run, a resolve, a `load`, or a `depends` of another unit.
A later run under the same root does not check again.
A unit that is not exported fails as before, at its first private tag (`MissingTag`).

A tag export is one the capsule binds per call, such as `http.request`.
It has no capsule check: an unbound one fails with `MissingTag`.

A span of an exported unit carries `attributes.capsule`.
A hook's log line carries `attributes.capsule`, the hook's capsule label.

### The record

`scope.capsules` is what the scope knows about each installed capsule, in `capsules` order.

```ts
scope.capsules[0];
// { label: "mail",
//   config: { smtpUrl: "smtp://x", from: "ops@x" },
//   tags: {},
//   exports: ["enqueue", "send"],
//   loaded: [{ unit: "mail.migrate",
//     role: "setup",
//     explain: "Brings the outbox up to date" }] }
```

It exists before the first `start`, and a read shows the state now.
A unit's first `load`, `run`, or `settle` adds one `loaded` line; a later one keeps the first meta.
A tag made with `secret: true` shows `"[hidden]"` for its whole value.
A config value that is a unit shows its label.
It holds no run status: runs and failures are spans.

### Config

A library reads tags to learn what it is configured against.
It declares them once, as its `config` (ADR 0120).
Calling the capsule fills the config and answers the binding a scope installs.

A key is required when its tag has no default.
Leaving it out is a type error: the error names the key.
A required key still takes `undefined`, since an env value may be unset.
An `undefined` value counts as unfilled, so such a key fails at start.
An optional key then reads its tag's default instead.
Use `tag.required` to make a key required whatever its tag says.
Use `tag.optional` to let the call leave it out.
Use `tag.all` for a list key: the call takes a list, and each item is one binding.

A filled key binds its tag on the root, before the app's own `tags`.
So a `tags` entry on the root still wins over the capsule's.
A list reads every binding last first, so a list key reads back in the reverse of the call's order.

A slot key holds a unit: a resource or an operation the app chooses.

```ts
const storeSlot = tag<Resource.Handle<Store>>({
  label: "sync.store",
});
const migrateSlot = tag<Operation.Handle<string, void>>({
  label: "sync.migrate",
});

const sync = capsule({
  label: "sync",
  config: { store: storeSlot, migrate: migrateSlot },
  hooks: {
    start: async ({ config, load, run }) => {
      const store = await load(config.store, {
        role: "state",
        explain: "Holds the records",
      });
      const ran = await run(config.migrate, {}, {
        role: "setup",
        explain: "Migrates the store",
      });

      return { store, ran };
    },
  },
});
```

The library builds the held unit in its own start, through the scope.
A unit that reads the start value sees the instance the scope built, not a copy.
So a preset on that unit reaches every reader of it.

Core adds no owner mark on config tags. A library's index does not export them, so the app uses
the library through its capsule.

`createScope` checks the config once, before the root layer exists.
A required key written as `undefined` raises `MissingConfig` with `{ label, key }`.
One library installed twice on a root raises `DuplicateCapsule` with `{ label }`.
A bad value raises `DataValidationFailed` from the tag's own `parse`, there.
Resolve, run, and write add no work: the bindings sit on the root like any other tag.

`scope.resolve(sync)` and `scope.resolve(sync({ ... }))` both read the start value.
A binding in `depends` delivers the same start value.

A test fills config the same way, and swaps a heavy unit with a preset (ADR 0015):

```ts
const scope = createScope({
  capsules: [sync({ store: sqlite, migrate })],
  presets: [preset(sqlite, () => fakeStore)],
});
```

## Errors and panics

ADR 0067 splits failures in two:

- **error** — a managed error: an `Error` with a string `kind` and a `payload`.
- **panic** — anything else thrown: a `TypeError`, a bug, a primitive.

`ctx.raise(kind, payload)` throws an error. Operation and resource ctx both have it:

```ts
run: ({ users }, { input, raise }) =>
  users.get(input.id) ??
  raise("NotFound", { id: input.id }),
```

`raise` returns `never`. A later line sees the narrowed value only when
TypeScript knows the call never returns. It knows that only when every name
in the call has a written type. So the form decides:

- A destructured `raise(...)` does not narrow. That is TypeScript's rule;
  no Core type changes it.
- `ctx.raise(...)` narrows only when the parameter is written
  `ctx: Operation.Ctx<I>`.
- `return raise(...)` narrows in every form. Use it when a later line needs
  the narrowed value.

`settle` runs like `run` but never throws. It returns a Result:

```ts
const r = await scope.settle(op, { input });
if (r.status === "failed") log(r.kind, r.origin);
```

- `success` carries `value`.
- `failed` carries `error`, `kind` (`"error"` or `"panic"`), and `origin` when known.
- `cancelled` carries the abort `reason`.
  It reads like the web's `AbortError`: `String(reason)` is `"AbortError: The scope closed before this work finished."`.

The Result says what `run` would do.
A value returned under a forced close is `success`, as `run` returns it.
Only the abort `reason` thrown on an aborted scope is `cancelled`.

`scope.settle(op, call)` and a controller's `settle(call)` take the same calls as `run`.
A sync operation settles at once. A tagged call settles at once too when its child session ended
in place, and through a promise when the session must wait (ADR 0072).
An operation typed `unknown` may do either, so its type is a Result or a promise of one.
`await` it.

`originOf(error)` reads where an error was first thrown: `{ label, span?, path }`.
`span` is the failed span's id when the scope observes.
`path` lists the failed runs, outermost first.
It grows only while the error is in flight: a rethrown error keeps its first path.
A primitive throw has no origin. A failed session close carries `origin` too.

A panic is sticky.
It fails the layer its run ran in, at the moment the run fails.
A caller's `try/catch` does not undo it: the layer still closes `failed`.
`settle` is the one recover: a panic it receives does not fail the layer.
That holds at any depth, and for a panic in the received error's `cause` chain.
A panic caught before it reaches `settle` stays sticky.
An error thrown by a run is a value: a caller that catches it leaves the layer fine.
A failed build still fails its layer, whatever its error's kind.
A dropped subflow's panic fails the layer, even while its caller still runs.
A dropped subflow's error stays with its caller and shows on its span.
A root run's dropped error goes to the host as an unhandled rejection; the layer stays fine.
A forced close after a sticky panic settles `failed`, not `cancelled`.

### Your own error shapes

`raise` stays open for an app: any string `kind`, any object `payload`.
Core keeps no registry of app errors.

An app keeps each shape in its contracts. In the Hedl app, refusals live in
its `src/contracts/hedl/errors.ts`:

```ts
export const refused = "Refused" as const;
export type RefusedPayload = { message: string };
```

A body raises that kind with `satisfies`, so the payload must fit the shape:

```ts
run: (_deps, { raise }) => {
  const payload = { message: "no seat" }
    satisfies RefusedPayload;
  return raise(refused, payload);
},
```

A caller reads `kind` and `payload` back. `settle` gives them on a Result of
kind `"error"`. A `catch` gets them with the app's own check.

`isError` and `Errors` cover Core's own kinds only. An app's kinds are the
app's to check.

## Resource cleanup

A call can own a stop signal (ADR 0090):

```ts
const stop = new AbortController();
const result = step.settle({
  input: "check services",
  signal: stop.signal,
});
stop.abort("new instruction");
const ended = await result;
```

- `run` and `settle` accept a call `signal`, including inline runs.
- The call opens a child session, just like a call with tags.
  Its data writes and session resources belong to that child.
  They are released before the call settles.
  A later call gets new session resources; scope resources stay shared.
- Aborting the call stops its body and subflows through `ctx.signal`.
  Work must pass that signal to its waits or check it.
  This also stops waits, such as retry sleeps, that use `ctx.signal`.
- An already aborted call starts no body, parse, resource, or hook.
- A call stopped by its signal preserves the exact `signal.reason`.
  `run` rejects with it; `settle` returns it after cleanup ends.
  A different error after abort still returns `failed`.
  A handled cancel or failure leaves the caller alive.
- A call keeps its input parsing, tags, and namespace.
  The namespace selects values; the child session owns their lifetime.
- A call signal can still stop work while its owner closes gracefully.
  Forced owner close stops the child even if the call signal stays live.
- Run and session hooks share the call's lifetime.
  Abort blocks a late body start.
  Graceful close keeps active run-hook access alive until the hook ends.
- Finishing the call removes its abort listener.
  Calls without a signal keep their existing return shape and lifetime.

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

## Closing signal

Resources read `ctx.closing`; capsule hooks read `event.closing`.
It is an `AbortSignal` that fires when the owner begins closing.
It fires on graceful and forced close, before Core drains running work.
Its reason keeps the web abort name `AbortError` and code `20`.
Its message gives the caller a non-empty reason for the stop.
A parent's closing also fires in its child sessions.
Closing one session leaves its parent and siblings live.
Each owner keeps the same signal, created on first read.
A first read after closing began returns an aborted signal.
Reading a child also links its parents' controllers.
A tree with no reads creates no signal or controller.

A resource can end a wait it owns without blocking graceful close:

```ts
const waiting = resource({
  label: "waiting",
  factory: (_deps, { closing, defer }) => {
    let finish = (): void => undefined;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (closing.aborted) finish();
    else closing.addEventListener("abort", finish);
    defer(() => {
      closing.removeEventListener("abort", finish);
    });
    return { wait };
  },
});
```

Running work still finishes during a graceful close.
`ctx.signal` keeps its work-cancellation timing.
`ctx.defer` still runs after the drain.
The close event's `scope` is the root handle whose close it observes.

## Closing and cell writes

Core seals a layer's cell writes when a forced close begins.
Later writes throw `Disposed`, including writes through held controllers from an abort
listener, an operation catch, or a resource `defer`.
A forced close cannot record a final status in that layer's cells.
Read the returned `Scope.Result` instead: a clean forced close is `cancelled`.
A real failure can make it `failed`.

`close({ graceful: true })` keeps state usable until running work and its cleanup finish.
Held cell controllers can write until that drain ends, even from outside a call.
A running call can call its `depends` operations, including after an await.
While a `session(fn)` body is running, anyone holding that handle can run or settle operations.
After the body returns or fails, that handle refuses calls during the drain.
The call's `ctx.defer` cleanup can also write and call helpers after an await.
This holds for a root stop signal, a direct root close, and a session close.
Both close modes refuse brand-new outside calls and sessions as soon as closing begins.
Saved operation controllers from finished calls also refuse calls during the drain.
A layer's `release()` and `releaseNs()` are refused during the drain.
A child also cannot release a resource owned by a closing parent.
New calls are refused before run hooks start.
New sessions are refused before session hooks start.
The closing signal still fires before the drain; the work signal stays live during graceful drain.
State is sealed after running calls and their cleanup finish, before resource cleanup.
A resource's `ctx.defer` write then becomes a `Disposed` teardown error.
A forced parent close also seals a child that was already closing gracefully.
A graceful close of a child already aborted by its parent keeps writes sealed.
Saved resource controllers stay usable during the drain.
A parent release keeps a draining child's resources usable, including named resources.
A draining session cannot release its parent's resource.
A panic from a running call's write makes `closed` report `failed`.
A failure received through `settle` stays recovered, as with any call.
Use plain `close()` when the work needs a stop signal.
Forced close aborts work instead of waiting for its normal finish.
The first close call chooses the mode.
A later forced close does not upgrade a graceful close already in progress.

A closed scope frees its data. `close({ withData: true })` hands it over instead (ADR 0069):

- `result.data.get(cell)` is present when the scope wrote the cell itself.
- It is absent for a value the scope only inherited; the parent still holds that.
- Every status carries `data` when asked: `success`, `cancelled`, and `failed`.
- `data.get(cell, { ns })` reads a named bucket, as `controller(cell, { ns })` does.
- Like `graceful`, `withData` is read from the first close call.
- A `session` hook still reads the session's cells and tags after `next()`, through `resolve`.
- That `resolve` also reads an ancestor's current write, or the initial value.
- That `resolve` takes `{ ns }` too, as `controller(cell, { ns })` does.
- Writes and resource reads there still throw `Disposed`.
- Once the hooks return, `resolve` and `controller(cell)` throw `Disposed`.

A held data controller keeps its last write alive until you drop it.
Once the hooks return, its reads no longer see that write.
They return the nearest ancestor's current write, or the initial value when no ancestor holds one.

## Sessions and cell writes

A child session inherits its parent's cells until it writes its own value. That write stays
in the child's copy: it does not change the parent or notify the parent's watchers. Closing
the child does not merge its cell values back into the parent.

A driver whose shared state belongs to the source scope must read and write through that
scope's handle, such as `scope.controller(cell).set(value)`. A cell controller supplied in
a session operation's `depends` writes to that session.

### Placed edges

The edge picks the layer a write lands on (ADR 0126).
The cell declares no place. The words are resource targets:

- `cell.controller`: the caller's own layer (as `session`).
- `cell.atNamespace.controller`: the root, in the caller's
  namespace (as `namespace`).
- `cell.atScope.controller`: the root, outside any
  namespace (as `scope`).

```ts
const token = data({ initial: null });

const renew = operation({
  depends: { t: token.atScope.controller },
  run: async ({ t }) => t.set(await refresh()),
});

// From a session, or a call with a `signal`:
await session.run(renew, { signal });
scope.resolve(token); // the new token
```

- A placed edge works from a session, a tagged call,
  and a call with a `signal`.
- Nothing climbs by itself. A plain `controller` write
  stays in its own layer.
- A namespace that holds its own value still reads it
  after an `atScope` write.
- A read view (a capsule's cell export) has no
  placed edge, at run time and in the types.
- `tinker/cell-write` flags a placed edge on another
  capsule's raw cell.
- Before 0.12.0, a `scope`-target resource that takes
  the controller wrote the root. It still works.

On an open scope, a repeat `controller(target)` read returns the same controller.
A controller read after close throws `Disposed`.

## Keyed data

A keyed cell holds members under keys (ADR 0135 to 0138).
Its `key` function reads the key from a member.

```ts
const tasks = data({
  mode: "keyed",
  parse: Task,
  key: (t) => ({ project: t.project, id: t.id }),
});

const items = scope.controller(tasks);
items.set(task);
items.update({ project, id }, (t) => ({
  ...t,
  done: true,
}));
items.delete({ project, id });
```

- `items.get()` reads all members, in the order they came.
- `of(key)` reads one member; `where(part)` reads the members whose
  key holds the part's fields.
- `tasks.of(key)` and `tasks.where(part)` name a read; `scope.resolve`
  gives its reader, and React's `useData` takes it.
- A write wakes the readers of its member and of its parts, and no other.
- `update` of a missing key raises `MissingMember`; a result with another
  key raises `KeyChanged`; a number in a key that is not finite raises
  `InvalidKey`.

On a `remoteData` board, a keyed cell is served by part: the first reader
of a part asks for it, and the guard runs at each ask. `board.invalidate`
marks parts dirty on either side. With `load`, the server reads each part
from a store and keeps no member (`docs/keyed-projector.md`).

## Tags

`scope.resolve(tag.all)` returns bindings nearest layer first, and last binding first
within each layer. For example, bindings `[region("first"), region("last")]` are read as
`["last", "first"]`. A driver that needs declaration order must arrange that order itself.

A custom binding builder names the value types it can return in `Tag.Binding<T>`. A binding
with a narrower value type can be assigned to one with a wider union of value types.

Every list a config takes is a `Many<T>`: one item, nothing (`null`, `undefined`, or `false`),
or a list of those to any depth. That covers a scope's or session's `tags`, a
call's `tags`, `presets`, `capsules`, and every driver's rows (`routes`, `tools`, `commands`,
`cells`). Core reads it once, flat, in authored order, so optional and grouped items need no
spread:

```ts
/** Only false is nothing; 0 and "" remain values. */
const shared = [group("net"), audit && trace(true)];
createScope({ tags: [region("eu"), shared] });
/** A single binding is a tagged call. */
scope.run(op, { tags: zone("us") });
/** An absent group is skipped. */
scope.createSession({
  tags: [request(raw), wiring.tags?.(c)],
});
/** Capsules and presets take the same list shape. */
createScope({ capsules: [base?.capsules, mail()] });
```

A call whose `tags` is nothing, or a list that flattens to nothing, is an untagged call: it runs
inline and opens no session. A driver reads its rows with `readMany(rows)` at its seam; when the
rows are themselves arrays (sync's `[cell, key]` pairs) it passes the row discriminator.

## Observation

Core owns one hose for spans and log lines (ADR 0119).
`createScope({ observe })` adds one tap.
A start hook can add another with `event.tap(config)`.
Each tap is an `Observe.Config` and gets records made after it joins.
Each tap gets the same span object.
The hose uses the lowest tap level and largest history.
Each log sink still filters to its own level.
All taps share the first tap's clock.
No tap makes no spans.
One tap is called directly; two or more use a loop.
A throwing sink does not stop the other sinks.

```ts
const telemetry = capsule({
  label: "telemetry",
  hooks: {
    start(event) {
      event.tap({ export: sendSpan, history: 80 });
      return event.next();
    },
  },
});
```

Enable `observe.history` to retain a bounded list of completed spans for `scope.spans()`.
Each call returns a list that keeps its entries when later runs replace the history.
Each resource build emits a `resource` span, so tests can count builds without a test-only
hook. If you keep the scope handle, its retained history is still readable after close.

When a driver creates its own scope and returns only its result (as the CLI does), pass
`observe.export` in the scope options before starting it. The callback receives each span
as it ends, including spans that finish during close; save those spans outside the driver.
Export works without retained history.

Each observed operation writes one step line to the `log` sink:

- `message` is the operation's label.
- `attributes` hold elapsed `ms` and `outcome` (`ok` or `failed`).
- `level` is `debug` when ok and `error` when failed; the scope's `level` can drop it.
- `span` is the operation's span.

This needs observation (`export` or `history`) and a `log` sink.
Resource builds write no step line.

Start events send logs before and after `await event.next()` to the scope's `observe.log`.
They use its clock and level filter, even without span observation.
The bare call uses `info`; `debug`, `info`, `warn`, and `error` pick a level.

Each line keeps caller attributes and sets `attributes.capsule` to the capsule's label.
Start opens no span, so its log lines have `span: undefined`.
Calling `event.tap` after the start chain settles raises `LateTap`.
Close events use the same logger.

## Namespaces

`namespace({ observe: false })` makes a quiet bucket (ADR 0119).
Operations, resource builds, nested work, and hook logs in that bucket emit no records.
Use it for a tool's own sends, so they do not trace themselves.
Quiet covers the call's namespace only.
An explicit nested namespace uses its own setting.
This keeps extra checks off plain runs.
Other buckets still observe.

A resource factory's `ctx.ns` is the chain used for its dependencies.
Scope-target resources expose no namespace; namespace and session targets expose their build chain.
The default bucket exposes `undefined`.

`namespace(opts?)` makes a key, not a string name. Use its `tags` to bind settings
for that key; use `namespace()` when only the stored values differ:

```ts
const region = tag<string>({ label: "region" });
const west = namespace({ tags: [region("west")] });
const east = namespace();
```

Pass `ns` to a run, a read, or a controller. A subflow can switch keys without
leaving its caller's layer:

```ts
scope.run(op, { input: value, ns: west });
scope.resolve(region, { ns: west });
scope.controller(cell, { ns: east }).set(1);
// In a run with `depends: { child: op }`:
child.run({ input: value, ns: east });
```

`createSession({ ns })` sets an ambient namespace: child sessions, tagged subflows,
inline runs, and controllers inherit it. An explicit `ns` changes just that call;
the next call still uses the session's key:

```ts
const request = scope.createSession({ ns: west });
request.run(op); // west
request.run(op, { ns: east }); // east for this call
request.run(op); // west again
```

A chain reads each named key, then the default, but checks the nearer layer
before the farther one. Within each layer it checks the chain in order.
A write goes to the current layer's first key, not its fallback:

```ts
scope.controller(cell, { ns: east }).set(2);
scope.resolve(cell, { ns: [west, east] }); // 2
scope.controller(cell, { ns: [west, east] }).set(3);
scope.resolve(cell, { ns: west }); // 3
```

Pick a resource `target` by how long and where the value must be shared:

- `"scope"`: one build for everyone, regardless of namespace. Use it for a
  shared pool. Its build reads the root's bindings, never namespace or request tags.
- `"namespace"`: one build per namespace for the scope's life, shared by
  request sessions. Use it for a tenant pool. Its build reads the namespace's
  and root tags, not the asking request's tags.
- `"session"`: one build per session per namespace. Use it for a request
  transaction. A named bucket stays warm for later reads in that session.

```ts
const db = resource({
  target: "namespace",
  factory: () => openDb(),
});
const tx = resource({
  target: "session",
  depends: { db },
  factory: ({ db }) => db.begin(),
});
```

`release(target)` clears all of that resource's buckets.
`releaseNs(target, ns)` clears one namespace's bucket
of a resource or a data cell (ADR 0063).
Resources built on that bucket are released with it.
Other namespaces and the default bucket stay.
A `scope` resource has no namespace buckets,
so `releaseNs` leaves it built.

```ts
scope.releaseNs(pool, tenantA);
```

The namespace tests also pin these guarantees:

- An ambient `createSession({ ns })` resolves there; a per-call `ns` wins for one run.
- A named write lands at the current layer's first key and never notifies a default watcher.
- Named calls keep the real layer lifecycle and capsule registry.
- A tagged subflow in a named run uses session hooks.
- Pass-through capsules preserve namespaces for writes and resolves.
- A session-target resource builds once in each namespace and reuses its warm bucket.
- A resource chain reuses its fallback, then switches to a nearer warm bucket.
- A sync-failed named bucket is not filled by a sibling chain.
- A named resource dependency reads a nearer default before a farther named entry.
- Namespace resource dependencies see tenant and root tags but not request tags.
- Namespace resources share a root bucket across request sessions.
- Sessions without a namespace share one root default resource.
- Request transactions share their tenant database but not each other.
- Closing the root waits for a request and cleans each namespace bucket once.
- Close waits for a named resource borrow and tears every bucket down once.
- Namespace clients share one scope-target pool.
- A scope-target resource is namespace-blind and keeps default storage clean.
- An ambient namespace cannot enter a scope-target resource build.
- Namespace-blind scope builds keep tagged operation dependencies blind.
- A re-registered named watcher refreshes its comparison value.
- A namespace-blind watcher observes default storage, never ambient tenant storage.
- A chained watcher compares against the full resolved namespace chain.
- A named write compares only its namespace watcher among a thousand.
- A chain watcher sees its fallback key but not an unrelated key.
- Unsubscribing a chain watcher removes it from every named key.
- `releaseNs` notifies only chains containing the released key.
- A child named watcher sees a parent's named write once.
- A grandchild named watcher sees a root named write.
- A child's own named entry shields its watcher from a parent's write.
- A child's named entry skips comparisons in its subtree on a parent write.
- A child's fallback chain sees its parent's write until the child shadows it.
- Releasing a parent's named entry notifies a child watcher of its fallback.
- `release(cell)` resets every named entry at its layer.
- `release(cell)` notifies a named watcher of its reset value once.
- `release(cell)` calls only the child watcher that inherits its named entry.
- `release(cell)` unlinks clients of its named entries, not another layer's entries.
- A new named client after `release(cell)` is still unlinked by `releaseNs`.
- An empty namespace chain is rejected with `InvalidDependency`.
- A non-namespace `ns` value fails with `InvalidDependency`, not a silent key.
- Invalid input rejects before dependencies build.
- A watcher that writes during notify does not rob a later watcher of its change.
- Named and chained cell watches notify only when their resolved value changes.
- A failed named resource retries without leaking to a sibling chain.

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
- An empty nested list reads frozen.
- A data controller get reads the latest write.
- A scope with empty tag bindings reads defaults.
- An operation depending on a non-unit fails with `InvalidDependency`.
- Each placement lands where its resource-target word says.
- With no namespace, `atNamespace` and `atScope` both land in the
  root's own bucket.
- A session's own write never climbs; its shadow wins its own reads.
- `atScope` from a call two levels below a session still lands at
  the root.
- A read view has no placement, at run time and in the types.
- A placed controller kept past its call still writes the root,
  and watchers see it.

### Keyed data

- A keyed cell starts empty and reads all members in the order they came.
- `of` reads one member and `where` reads the members of a part.
- `update` and `delete` change one member by its key.
- A write wakes the watchers of its member and of its parts, and no other.
- Two keys with the same fields in another order name one member.
- A served keyed cell is read by part: a client asks for a part, and the
  last reader leaving drops it.
- A set on the server makes each reader of its part ask for one member.
- An answer that arrives after a later ask started is dropped.
- With a load, the server keeps no member.
- `board.part(call)` gives a guard the part of a keyed join or ask, typed;
  any other call gives `undefined`.
- `board.status(read)` gives a part's state: `pending` until its first
  answer, then `ready` or `fault`; `undefined` when no reader holds it.
- A part that rides a ready part is `ready` at once.
- A `refused` or `invalid` part waits: no ask again until an
  `invalidate` names it. A broken link asks again by itself.

### Faults

- Each fault of `rpc` and `remoteData` says who
  spoke: `from` is `"server"` or `"local"`.
- A server fault is the server's answer:
  `refused`, `invalid`, `failed`, `missing`, and
  `encode` or `decode` on the server.
- `missing`: no one serves the address, so
  nothing ran (as HTTP 404).
- A local fault also says `sent`: `false` when
  nothing left, so the server ran nothing.
- `link` is local; a transport that cannot tell
  says `sent: true`.
- No call is sent again by itself.
- A backend's `send` and `open` end with a value,
  never a throw. A throw in a backend is a bug:
  logged, `failed` on this side, never `link`.

### Tags

- A tag edge reads the nearest binding, in an operation or through the seam, or its default; with
  neither it throws `MissingTag` naming the tag.
- Resolving a tag edge delivers its form: `all` lists nearest-first, `optional` reports presence,
  `required` reads or throws.
- `optional` tells absent apart from an undefined default: the default reads present, the missing reads
  absent.
- A tag binding runs through `parse`; a bad value throws `DataValidationFailed` naming the tag.
- A unit takes no meta: the option is a type error and the handle has no field. Tags bind on a
  scope, a session, or a call; a driver takes rows.

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
- A resource preset replaces the built instance, builds once per owner, resolves async factories, and
  runs its own cleanup at owner close; the real factory never runs.
- A resource preset does not build the deps of the node it replaces.
- A resource preset gets empty deps: the real node's deps are never read.
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
- A release waits for every borrower, not just the first done.
- A build that releases itself still rebuilds on the next resolve.

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
- A scope run that catches a subflow's managed error returns normally without failing its scope.
- A tagged scope run that catches a subflow's managed error returns normally without failing its child
  session.
- A session run that catches a subflow's managed error returns normally without failing its session.
- A tagged session run that catches a subflow's managed error returns normally without failing either
  session.
- A graceful parent close stays successful when a still-running tagged subflow's managed error is caught.
- A subflow failure that escapes its caller fails the session with that cause.
- An orphan fails the session: its subflow failed after the caller finished.
- A dropped subflow's panic fails the session while its caller still runs.
- A dropped subflow's managed error does not fail the session; its span keeps the error.
- An awaited catch of a managed subflow error leaves the session successful.
- A controller subflow's managed error caught by its caller leaves the session successful.
- An orphan through a controller edge fails its session.
- A tagged orphan fails its parent session.
- A catch after its caller returns does not undo an orphan failure.
- An orphan reports the original failure once on its own span.
- A detached callback rejection after its root closes belongs to the host.
- A detached callback rejection after its session closes belongs to the host, not the root.
- An async subflow that succeeds exports an ok span.
- An awaited catch after finally receives a managed subflow error and leaves the session successful.
- An awaited then rejection handler receives a managed subflow error and leaves the session successful.
- An awaited catch after fulfillment-only then receives a managed subflow error and leaves the session
  successful.
- A graceful close does not wait for an endless then callback after a successful subflow.
- A forced close does not wait for an endless then callback after a successful subflow.
- A graceful close reports an orphan without joining its endless catch callback.
- A forced close reports an orphan without joining its endless catch callback.
- An awaited slow rejection handler receives a managed error and keeps the session successful even
  before its own work finishes.
- A caller awaiting finally can catch the original managed error and leave the session successful.
- An async subflow returns a native promise that `Promise.resolve` keeps unchanged.
- A managed subflow error awaited and caught inside an operation defer does not fail the session.
- Returning a subflow promise to an outer caller that awaits and catches its managed error does not fail
  the session.
- Promise.all receives both managed subflow errors; a caller that catches them leaves the session
  successful.
- A handler added from a later timer cannot undo an unreceived failure already settled.
- A failed subflow's span keeps its error when caught, while its caller's span closes ok.
- A failed unreceived subflow's span keeps its error even though its caller finishes normally.
- A forced close after a caught managed subflow error cancels the session, rather than failing it.
- A caller two subflows deep can catch a managed error without failing the session.
- `settled` stays pending until owned work finishes.
- An operation preset replaces the run for a direct call, a downstream subflow, and an inline config.
- An operation preset gets empty deps: the real node's deps are not built.
- An operation preset does not read an unbound tag.
- An operation preset gets empty deps under a run hook too.
- An operation preset still parses the call's input and rejects a bad one.
- An inline run resolves deps, delivers the full context, and shares nothing between runs; with no call,
  `ctx.input` is void. A tagged inline run sees the call's tags; a preset arrives through its deps.
- A tagged call binds the whole flow: run, subflow, and nested subflow all read the call's tags; a
  tagged sync call that ended in place returns its value, and one that must wait returns a native
  promise (ADR 0072).
- A tagged run builds session resources in the flow, scope resources at the root; an untagged run builds
  session resources at the root and opens no session; the tagged session closes with the run.
- An operation reads the scope's clock; a resource factory does too (see Clock).
- An operation reads the scope's random; a resource factory does too (see Random).
- An operation's context exposes no borrow or drain internals.
- An operation defer sees the run's own end: `success` on return, `failed` on throw, `cancelled` under
  a forced close.
- A rejected promise with an `undefined` cause keeps that cause; a primitive body cause still settles the
  session.
- A preset is scoped to its scope: another scope still builds the real value.
- A nested controller run passes the caller's object to the callee and returns the callee's own.
- An async nested controller run gives the caller the callee's own object.
- A callee that changes `ctx.input` changes the caller's object.
- A tagged nested call passes the caller's object into the child session.
- A namespaced nested call passes the caller's object to the callee.
- A scope run passes the caller's object to the callee and returns the callee's own object.
- A session run passes the caller's object to the callee and returns the callee's own object.
- A parser that hands back its raw object gives `ctx.input` that object.
- A parser's new object is `ctx.input`, while `ctx.rawInput` stays the caller's.

### Errors and panics

- `settle` returns an async operation's success value.
- `settle` classifies a registry-shaped `Error` as an error.
- `settle` classifies a plain `Error` as a panic.
- `settle` classifies a non-`Error` object, an `Error` with no `payload`, or one whose `kind`
  is not a string, as a panic.
- `settle` returns a primitive panic without an origin.
- `settle` returns the value when an operation returns under a forced close.
- `settle` returns what `run` returns when a body answers its abort with a value.
- `settle` reports cancellation when a forced close aborts its operation.
- `settle` reports cancellation when a body rejects with its abort reason.
- `settle` mirrors `run` for a sync operation under a forced close.
- `settle` reports a cancel reason from another scope as a failure.
- A forced close's cancel reason reads as `AbortError` text.
- A forced close's cancel reason is named `AbortError`.
- A forced close's cancel reason inspects as `AbortError` text.
- `settle` reports a foreign `AbortError` rejecting during a forced close as a failure.
- `settle` returns a sync Result for an untagged sync operation.
- `settle` on a tagged sync call returns its Result directly when it ended in place.
- `scope.settle` accepts a typed inline call without making it async.
- `scope.settle` on a tagged inline config gives a Result in place, a native promise when it waits.
- `settle` on an unknown-typed operation types as a Result or a promise of one.
- `settle` on a generic operation assigns to a Result or a promise of one.
- `scope.settle` keeps an unknown-typed inline a Result or a promise of one.
- `settle` recovers a root operation's panic without failing the layer.
- `settle` recovers through a controller edge and through a bare operation dependency.
- A settle call remains recovered when its caller finishes first.
- A tagged settle failure does not bubble through a graceful parent close.
- `settle` returns a closed-scope error rather than throwing.
- A sync throw gets the innermost run's origin.
- An async rejection gets the innermost run's origin.
- Three failed runs build a root-first origin path.
- `originOf` follows cause chains to a stamped error.
- Rethrowing an already-stamped error keeps its first origin.
- A sentinel error thrown on every settle keeps a one-run path.
- A sibling rethrow does not extend the first path.
- A sentinel thrown by a tagged or namespaced root run five times keeps a one-run path.
- A tagged subflow keeps its caller in the path.
- An observed origin carries the failed run's span id.
- An unobserved origin has no span id.
- A destructured operation `raise` sets kind, payload, and message at the throw site.
- A destructured `raise` call does not narrow a later value of its run.
- A `ctx` read without a written type does not narrow a later value.
- A `raise` call on a written `ctx` type narrows a later value.
- A returned `raise` narrows a later value even when it is destructured.
- A resource `raise` stamps the resource ctx before a run receives it.
- An escaping operation `raise` adds its own run label only once.
- An empty ctx `raise` gets its origin from the run it reaches.
- A capsule `raise` stamps the start ctx.
- A failed session close carries its error's origin.
- A panic caught with `try/catch` still fails its layer, with the panic and its origin.
- A panic received through `settle` leaves its layer successful.
- `settle` recovers a panic that a nested subflow threw.
- `settle` recovers a panic carried as the cause of the error it receives.
- A panic swallowed inside a settled run still fails the layer.
- `settle` recovers only the panic it receives, not one swallowed earlier.
- A caught panic after an earlier failure leaves the first failure as the layer's error.
- Two caught panics in one layer leave the first, with its origin, as the layer's error.
- A caught panic before a failed resource build stays the layer's error.
- A managed error caught with `try/catch` leaves its layer successful.
- A caught panic in a session run fails that session and not its parent.
- A caught panic in an inline run fails the scope it ran in.
- A panic caught inside a tagged run fails the run's own session.
- A tagged subflow's panic fails its caller's layer even when the caller catches it.
- A forced close after a caught panic settles `failed`, not `cancelled`.

### Scopes, sessions, and close

- A child session reads its parent's cells and tags until it writes its own; the write stays local.
- A nearer shadow wins for descendants below it, and the parent keeps its own value.
- A watcher on the parent still sees the parent's later writes after a child shadows.
- Once close resolves, a held controller no longer reads the scope's own writes.
- A closed scope's held controller reads the nearest ancestor's current write, or the initial value.
- Late writes fail with `Disposed` before write hooks or update functions run.
- Close runs children first, then `onClose` hooks and cleanups latest-first — a later `onClose` before
  an earlier resource cleanup; a dependent's cleanup before its dependency's.
- With no body, child, or pending work, close runs synchronous cleanup in its first promise job.
  It adds no wait between synchronous cleanups.
  If a cleanup returns a promise, close waits for it before the next cleanup.
- A destructured operation defer keeps its run's cleanup.
- Settle keeps the call signal chosen before its body runs.
- A throwing hook or cleanup never stops the rest: every cause lands in teardown errors, in order.
- Close is safe to repeat: hooks run once, a re-entering close tears down once, closing again re-reports.
- A clean scope closes `success` when graceful, `cancelled` when forced, and never throws; a second close
  returns the same result.
- A failed start rejects `ready` with its cause and fails the scope.
- A hanging inner start times out on the scope clock and closes with its label.
- Start defaults to ten seconds and names an outer hook hanging after next.
- A settled start cancels its timeout.
- Close cancels a hanging start and its timer with the close reason.
- Zero and infinite start limits keep the timer off.
- Negative start limits raise a managed error.
- Finite start limits are capped at the largest timer delay.
- A recovered inner start leaves ready and close successful.
- A tap called after ready raises a managed error.
- A clock sleep throw or rejection leaves startup waiting without a timeout.
- A real start error after close begins fails `closed` and keeps the error.
- An explicit nested namespace chooses its own observation setting.
- A held controller keeps its last write alive after its root closes, with or without a watcher or an `onClose` hook.
- A held controller keeps its last write alive after its session closes, fast, under a session hook, or swept by its root.
- Without a held controller, a closed root frees its last write.
- A scope with no capsules is ready at once on one shared promise; a session after ready is ready.
- `scope.resolve` reads a cell's current value with no subscription, builds a resource once, and reads a
  tag's nearest binding, default, or throws `MissingTag`.
- `scope.run` shares the controller path: same lookup, same CallArgs rules, stable controller identity.
- A close hook wraps the structural close and sees its result.
- `session(fn)` commits on return and rolls back on throw, closes the child itself, and passes the error
  on; a throwing outcome hook keeps the outcome and aggregates its error. The session's handle closes
  when its body ends (ADR 0071): after the body returned, `onClose`, `resolve` and `run` on a handle
  the body kept raise `Disposed`, and `close({ withData: true })` on it gets no data.
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
- A wrapped session cut by a forced close rejects.
- A clean body with a failing cleanup still reports the cleanup.
- An operation that finishes after abort still sees cancelled.
- A cleanup that closes another scope sees its real result.
- An idle scope's close still reports an operation cleanup that threw.
- A default close frees a session's data and returns none.
- A withData close hands over what the session wrote, never what it inherited.
- A family member and a namespaced session's cell read back from data.
- A graceful withData close keeps what in-flight work wrote before it settled.
- A session hook reads the session's cells and tags after next.
- A session hook cannot write a cell or read a resource after next.
- A hooked session's reads throw once its hooks return.

### Clock

- An operation and a resource factory read the scope's clock.
- Span and log times read the scope's clock, so a test clock freezes them too; an explicit
  `observe.clock` wins over it.
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

### Random

- An operation and a resource factory read the scope's random.
- The default random reads the system source (`Math.random` / `crypto.randomUUID`); a child session
  reads its parent's random.
- A test random built from a seed replays the same `next()` stream across scopes; a different seed
  gives a different stream.
- A test random built from a seed replays the same `uuid()` stream, each id v4-shaped; every `uuid()`
  call yields a distinct id.
- A test random with no seed is a deterministic default generator.

### Observation

- One start tap receives a span and misses work before the tap.
- Two taps receive the same span, filter their own levels, and keep the largest history.
- A throwing tap does not stop another tap.
- A quiet namespace emits no spans or logs from its work and hooks.

- Capsule start logs before and after next reach the scope sink without a span.
- A destructured capsule start logger sends every level without span observation.
- An info threshold drops capsule start debug lines before reading the clock.
- Capsule start logging without a sink reads no clock or attributes.
- A failed capsule start delivers the log before its throw.
- A throwing capsule start log sink does not fail ready.
- A capsule close hook logs before and after next with the scope filter and clock.
- A destructured operation logger stays the same and sends every level in order.
- A destructured resource logger stays the same and keeps the level threshold.
- A resource keeps its observation tools and exports manual events and children.
- A caught operation raise carries its span before the body reads observation tools.
- A caught resource raise carries its span before the factory reads observation tools.

- An observed operation logs its label, elapsed time, outcome, level, and span.
- A failed operation logs its failure at error level.
- Nested subflows log child before parent, once each.
- An info threshold drops ok step lines but keeps failed ones.
- Logging without observation keeps `ctx.log` but emits no step line.
- Observing without a log sink preserves operation and resource spans.
- A throwing step log sink does not change the run result.
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

### Capsules

- An operation depending on a capsule receives the start value after ready; while pending it raises
  `NotResolved` naming the capsule.
- Resolving a capsule that is not installed throws `NotResolved` naming it; `resolve(capsule)` reads
  the capsule's own start value, bypassing the resolve chain.
- `capsule({ label, config })` declares the tags a library reads; call it to fill them and get the
  binding a scope installs (ADR 0120, 0121).
- Leaving a required config key out is a type error; a key written as `undefined` raises
  `MissingConfig { label, key }` at start; one library installed twice raises `DuplicateCapsule`.
- The capsule tests (I1-I5, N1-N3, A01-A23) live in `tests/capsule.test.ts` and
  `tests/capsule.types.test.ts`.
- A filled config key binds its tag on the root, and the root's own `tags` win; a `tag.all` key binds
  one tag per item and reads every binding last first.
- A slot key holds a resource or an operation, which the library resolves through the scope, so a
  preset on the held unit reaches its readers.
- A run hook sees every call and passes it through unchanged; a start or run hook that skips `next`
  short-circuits: inner starts never run, the refused body never runs.
- `update(fn)` runs through the write chain with the computed value; the cell controller is cached
  per cell.
- Requesting a cell controller after close raises `Disposed`, even when it was cached.
- A closed scope with session hooks refuses a new session with `Disposed`.
- A write chain skips a capsule with no write hook.
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
- A run hook that asks which op it wraps changes that op only; its event gives a raw call's input
  as the op parses it, refuses a bad raw input as the op does, gives an inline run the caller's
  input, and has no input for a run with no call (ADR 0142).
- Two close hooks nest in reverse install order.
- A scope with no close hooks closes straight through.
- A forced close with a close hook still settles cancelled.
- A close chain runs past a capsule with no close hook.
- A resolve chain runs past a capsule with no resolve hook.

## Trace ids

- Importing core draws no random values; the id stream seeds on the first observed span.
- A root span has nonzero W3C ids before its body runs.
- Operation, resource, and manual children inherit the trace and name their parent span.
- Two unseeded root spans start different traces.
- A seeded random replays trace and span ids.
- Reading ids later leaves the seeded random stream and ids unchanged.
- Observation leaves seeded and custom user randomness unchanged.
- User random reads do not change seeded trace and child span ids.
- Seeded ids use generator bits in every hex position and stay nonzero.
- Span JSON keeps public fields, ids, attributes, and events without internal state.
- Observation off leaves the ambient random stream untouched.
- A session copies its remote trace seed and child sessions inherit it.
- A session seed overrides its scope seed without changing siblings.
- A seeded subflow uses its local caller as parent and keeps the sampled flag.

- A null session seed starts a fresh trace without changing its parent.
- A session seed follows direct resource builds to their scope owner.

Absent `trace` inherits the parent seed; `trace: null` clears it.
Numeric `id` and `parentId` still order the local tree.
A span is a class instance, so spread or `structuredClone` copies only its own fields; use JSON for its public fields.
`traceId` is 32 lowercase hex digits; `spanId` and
`parentSpanId` are 16.
ID bits come from a private 32-bit generator at open.
IDs are reproducible only with `makeTestRandom({ seed })`.
It keeps a second generator for IDs; user `next()` and `uuid()` calls stay unchanged.
The system source and custom random sources use a core-owned generator seeded once from crypto.
Hex text is made on first read and kept for later reads.
Children share the trace's numbers and saved text.
A zero final number becomes one, so an id cannot be all zeros.
`sampled` carries the remote hint; local observation still
follows `observe`.
A new local trace defaults to sampled.
A driver validates the seed before passing it to core:

```ts
scope.createSession({
  trace: {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    parentSpanId: "00f067aa0ba902b7",
    sampled: false,
  },
});
```

The sink sets `service.name` from its own config.
Core adds no OTel import, span kind hint, or links.
`kind` still means operation, resource, or manual work.
