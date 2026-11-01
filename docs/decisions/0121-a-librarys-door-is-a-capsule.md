# 0121 A library's door is a capsule

Date: 2026-11-01. Status: implemented.
Accepted: Duke, 2026-11-01 05:48 UTC:
"let's go capsule, and surely capsule should
have lifecycle hooks, and we will remove
extension on the way to go".
Replaces: 0120. Amends: 0050, 0051, 0057.

## What the user said

- 02:39: "should be more like Tag (Tag and
  Tagged) ... So the config can be typed as
  such on creation?"
- 02:53: "we should not grant resolve too
  easily. That resolve should associate to the
  controlled, not just any"
- 02:56: "extension loads a watcher, it needs
  to 'explain'"
- 02:57: "make it dynamic, but by the end of
  the start, scope should know exactly what's
  going on with each and every extension"
- 02:58: "Actually, anytime, not only after
  start"
- 03:08: "maybe we export directly from
  extension? Instead of via exports"
- 05:48: "let's go capsule, and surely capsule
  should have lifecycle hooks, and we will
  remove extension on the way to go"
- 05:51: "We'll review and move everything to
  capsule, so follow up with that"

## Words

- **library**: one folder in
  `tinker/components/`.
- **capsule**: a library's door. It holds the
  config, the hooks, and the exports. Made with
  `capsule()`.
- **handle**: what `capsule()` returns.
- **binding**: what a call of the handle
  returns. A scope installs it.
- **unit**: an operation, a resource, or a cell.
- **record**: what the scope knows about each
  installed capsule, at any moment.

The name is not "module" (an ES module) and not
"bundle" (the Vite build).

## Precedent

- **NestJS** `@Module`: a module lists what it
  exports; a provider of a module that is not
  imported fails at resolve.
- **Guice** `PrivateModule`: a module binds its
  own keys and exposes a few.
- **OSGi** bundle: a bundle has a lifecycle
  (start, stop) and a declared export list.

Where we are simpler: one flat `capsules` list
on the root. No import graph between capsules.

## Decision

### 1. `capsule()` replaces `extension()`

```ts
export const mail = capsule({
  label: "mail",
  config: { smtpUrl, from },
  exports: { enqueue, send, outbox },
  hooks: { /* the six hooks */ },
});

createScope({
  capsules: [mail({ smtpUrl, from })],
});
```

- `extension()`, `Scope.Extension`, and the
  `extensions` option are gone.
- `Scope.Configurable` is now `Capsule.Handle`.
- The v1 config rules stay (ADR 0120):
  - a tag, `.required`, `.optional`, `.all`;
  - `MissingConfig { label, key }`;
  - the `unfilled` type marker.
- A capsule with no required key is called
  with nothing: `health()`.
- `tag()` takes `secret: true`.

### 2. Hooks

- The six hooks stay. Only the holder's name
  changes.
- `start` runs once per capsule, in `capsules`
  order. Every start runs, even when one skips
  `next()`.
- `close` runs once, in REVERSE order. Skipping
  `next()` cannot skip cleanup (ADR 0085).
- `resolve`, `run`, `write`, and `session` stay
  onion middleware, as today.

Behavior changes:

- Close hooks ran in install order before. Now
  the last installed closes first.
- A start that skipped `next()` kept the later
  starts from running. Now every start runs once,
  so each capsule gets its start value (lead,
  2026-11-01).

### 3. What a hook event holds

An event loses:

- `resolve`, `controller`, `scope`;
- the 2-argument `run` and `settle`.

An event gains:

- `config`: the config values, read once after
  the binding, with defaults filled.
- `load(unit, meta, options?)`: a resource
  answers a promise of its value; a cell answers
  its controller. `options.ns` reads the unit in
  that namespace, as a run's `ns` does.
- `run(op, options, meta)` and
  `settle(op, options, meta)`: the same options
  and result as `scope.run` / `scope.settle`, as
  a promise. No controller is made.

Kept: `next`, `tap`, `kind`, `log`, `signal`,
`clock`, `random`, `ns`, `defer`, and the
`target` / `op` / `call` / `cell` / `value` /
`handle` of each hook.

### 4. The meta

```ts
await run(migrate, {}, {
  role: "setup",
  explain: "Brings the schema up to date",
});
```

- `role`: `setup`, `worker`, `handler`, or
  `state`.
- `explain`: one line for devtools.
- Call options (`input`, `rawInput`, `signal`,
  `ns`, `tags`) go on the run, never in the
  meta.
- A sink capsule runs and loads its own units
  in a namespace made with `observe: false`, so
  the hose shows none of them. A `scope` target
  resource builds with no namespace, so a sink
  keeps its state in a `namespace` target one
  (ADR 0119).

### 5. Reach

- `load`, `run`, and `settle` use the hook's
  own context: owner, namespace, trace, signal,
  and lifetime.
- A controller from one request never serves
  another (review X1).
- They work in every hook, at any time.
- In a `close` hook, `load` reads units already
  built on the root until `next()` releases
  them. After that, and for a unit never built,
  it raises `Disposed` (review X3).
- The options types are today's
  `Scope.Invocation` and `Scope.ProvideInput`;
  a cell's controller is `Scope.DataController`.

### 6. The record

```ts
scope.capsules: readonly Capsule.Record[]
```

- One line per installed binding, in
  `capsules` order.
- It exists before the first `start`, with
  `config` and `exports`.
- `loaded` gains one line per unit per capsule,
  on its first `load`, `run`, or `settle`. A
  later one keeps the first meta.
- A `secret` tag's value shows `"[hidden]"`. A
  unit shows its label.
- No run status and no event stream: runs are
  spans, as before (review X6, X7).

### 7. Exports

- Exports are copied onto the handle and every
  binding: `mail.enqueue === enqueue`.
- A reserved name (`label`, `config`, `hooks`,
  `exports`) is a type error, and `capsule()`
  raises `ReservedExport { label, key }`.
- A span of an exported unit carries
  `attributes.capsule`. A hook's log line
  carries `attributes.capsule` too (it carried
  `extension`).
- A tag export is one the capsule binds per
  call (`http.request`).

### 8. An export needs its capsule

- A scope that first touches an exported unit
  whose capsule it does not install raises
  `CapsuleMissing { unit, capsule }`.
- First touch: a run, a resolve, a `load`, or
  a `depends` of another unit. It raises before
  any work.
- A pass is kept on the unit, per root, so
  later runs do not check again.
- A tag export is not checked: an unbound one
  fails as any tag does (`MissingTag`).
- A unit that is not exported is not checked.

### 9. A binding is still a start value

- `depends: { db }` delivers its start value.
- `scope.resolve(db)` reads it, through the
  binding or the handle.

### 10. The command holds the scope

A start hook no longer has `scope`. A command
that must hand the root to a framework passes
the handle it already holds (review X2):

```ts
requestContext: { scope: app },
```

### 11. Library rules (convention)

- Config tags stay private.
- Core units others use go through the
  capsule: `mail.enqueue`.
- Plain values and types may stay named
  exports (review X8).
- Names do not stutter: `mail`, `enqueue`.
- One capsule per place; each place keeps its
  own entry file, so a browser import never
  reaches server code (review X4).

### 12. Errors

- `MissingConfig { label, key }`.
- `DuplicateCapsule { label }` (was
  `DuplicateExtension`).
- `ReservedExport { label, key }`.
- `CapsuleMissing { unit, capsule }`.
- `Disposed`: `load` after release.

## Consequences

- A hook reads a tag only through a unit or a
  config key. Start reads its tab stop signal
  through `readTabStop`, a one-line operation.
- Start's auth part is a capsule with one config
  key. The server entry fills it from env.
- Start's app seam still names its export
  `extensions`; its values are capsules. The
  rename waits for the `tinker-app` port.
- A close hook that loads before its work starts
  that work one microtask later.

## Review

Astra: SHIP WITH FIXES. X1 to X8 all taken.
