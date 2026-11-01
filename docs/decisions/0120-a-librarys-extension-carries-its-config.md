# 0120 A library's extension carries its config

Date: 2026-10-31. Status: accepted.
Accepted: Duke, 2026-10-31 23:49-23:51 UTC:
"If that's the way then yes".
Builds on: 0015, 0057, 0113, 0119.

## What the user said

- "operation as reusable is ok but it got
  awkward in config and hard to self explain"
- "if I want to use, at least I know what am I
  configure against"
- "testability still very important and
  untradable"
- "a library offers a graph of components, some
  internal, few expose ... we still need to
  retain identity of resource, ops"
- Two copies of one library in a scope:
  "Likely no".
- "Actually config goes hand in hand with
  extension"
- "I like that encapsulation actually"
- Private by convention: "it'll force the use
  of library via extension and with that, the
  freedom is at the extension"
- "The graph itself is still correct at the
  resource and operation level. The extension
  will just make sure the configure integrity
  and sometime effect operation like pulling
  model rather than enforced. Resolve one still
  resolve its dependencies as usual"
- "the configure can take operation or resource
  as parameter for extension ... the pattern
  can happen inside extension and only there"

## Context

- An app's command names each library twice:
  once in `extensions`, once in `tags`.
- The `tags` list mixes 4 kinds of value:
  settings, plugged units (slots), mode
  switches, and values from another scope.
  All of them use `tag(...)`.
- To learn that a slot wants an operation, the
  reader opens the library's slot file.
- To learn that a key is required, the reader
  reads the library's start hook. Each start
  hook checks its tags by hand.
- `Scope.Extension` has only `label` and
  `hooks`.

## Precedent

- **Fastify** `register(plugin, opts)`: the
  plugin owns its options.
- **Guice** `PrivateModule`: a module binds
  its own keys and exposes a few.
- **Effect** `Layer`: a layer is built from
  its inputs; tests swap a layer.
- **Terraform** module: typed inputs, required
  when they have no default.
- **Spring** `@MockBean`: a test swaps one
  bean and keeps the rest.

Where we are simpler: a config key is a tag the
library already reads. Core adds no new store.

## Decision

### 1. A library is a graph of units

Units stay module constants.
Their identity does not change (ADR 0057).

### 2. The extension is the boundary

The library's extension owns the library's
config tags and its start effects (a migration,
pulling a model).

### 3. The extension declares its config

```ts
export const mailStart = extension({
  label: "mail",
  config: {
    smtpUrl,
    from: mailFrom,
    sendTimeout: mailSendTimeout,
  },
  hooks: { /* ... */ },
});
```

Core types the call from the tags.
Each config entry is one of:

- a tag: required when it has no default;
- `tag.required`: required;
- `tag.optional`: optional;
- `tag.all`: a list key, optional.
  The call takes an array. Each item is one
  binding.

### 4. The command fills it, one line each

```ts
extensions: [
  mailStart({
    smtpUrl: env.SMTP_URL,
    from: env.SMTP_FROM,
  }),
],
```

- A filled key binds its tag on the root.
- An `undefined` value is a missing key. An
  optional key then falls back to the tag's
  default.
- A `tags` binding on the root comes first. It
  wins over the extension's binding.

### 5. A missing required key fails twice

- At compile time: the call is a type error.
  An extension with a required key is not an
  extension until it is called.
- At start: `createScope` raises
  `MissingConfig { label, key }`. So no start
  hook checks its tags by hand.

The check runs once, in `createScope`.
Resolve does no new work.

### 6. A slot is a key that takes a unit

```ts
syncStart({ store: sqliteStore, bootstrap })
authStart({ onUserCreated: [a, b] })
```

- A slot key's tag holds an operation or a
  resource.
- The tag-holds-a-unit pattern lives only
  inside the extension. The extension binds the
  given unit to its private tag. The library
  resolves it there.
- A many-fill slot is a list key. So `auth` no
  longer imports `sync`.

### 7. Config tags are private by convention

- The library's index does not export them.
- So the library is used through its extension.
  The freedom sits in the extension.
- Core adds no owner mark.
- Tests may still import them.

### 8. Resolve does not change

- Resolving a unit resolves its dependencies,
  as before.
- With no extension, it fails at the first
  private tag it reads (`MissingTag`).

### 9. Tests fill config the same way

A test calls the same extension.
It swaps a heavy unit with a preset (ADR 0015).
A preset on the unit a slot holds works, since
the library resolves that unit through the
scope.

### 10. Config fills inputs, never makes units

The call binds tags. It never creates an
operation or a resource (ADR 0057).

### 11. One library, one copy

The same configured extension twice in one
root raises `DuplicateExtension { label }`.
`scope.resolve(mailStart)` reads the start
value of the called copy.

## Consequences

- A command lists each library once.
- Apps that use `extension({ label, hooks })`
  keep working.
- A library's slot file goes away; its tags move
  next to its extension.

## Open

- Slot edges: the graph does not follow a slot
  tag to the unit it holds. Core would have to
  read tag values while it builds the graph.
  Left open.
- Migration: `sync` and `sync-sqlite` become one
  `sync` plus a store adapter. A demo shows it
  outside `main`.
