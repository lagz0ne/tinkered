# 0023 Static unit metadata is tag bindings, read off the handle

Date: 2026-09-14. Status: superseded. Refines: 0004-era tags (ambient metadata) for the static case.

> Superseded by drivers/t08 (2026-09-26). Units carry no `meta`: the field, the config option,
> `Tag.Handle.read`, and `Tag.Metaed` are gone. A driver takes rows (ADR 0051 §3). Tags bind on a
> scope, a session, or a call; `Tag.Bindings` and `Many` stay for those.

## Context

An extension (devtools, a form/UI generator, a router) needs to read **static metadata** off a
unit at definition time: which widget renders a `data` cell, which group an operation belongs to,
whether a resource is internal. The unit already has one metadata primitive — the **tag**. The
question was whether static meta is a new plain-record field (`meta: Record<string, unknown>`) or
reuses tags. A plain record is simplest to read but adds a second, untyped metadata concept beside
tags; reusing tags keeps the primitive count small and stays typed.

## Decision

Static metadata on every unit — `data`, `operation`, `resource`, and a **tag itself** — is a list
of **tag bindings**, fixed at definition and read off the handle. It never affects resolution.

- **Attach:** every factory config takes `meta?: Tag.Bindings`. (Amended 2026-09-21: was
  `readonly Tag.Binding<unknown>[]`. `Tag.Bindings` is the authored shape — one binding,
  nothing (`null`/`undefined`/`false`, never `0`/`""`), or a list of those to any depth, the
  `clsx` / ESLint flat-config precedent — flattened once at definition, so optional and grouped
  bindings need no spread: `meta: [ui("slider"), dev && debug(true), shared]`. The handle still carries the flat list.)

  ```ts
  const ui = tag<string>({ label: "ui" });
  const port = data({ initial: 8080, parse: asPort, meta: [ui("slider")] });
  const secret = tag<string>({ label: "secret", meta: [ui("password")] }); // meta on a tag
  ```

- **Expose:** every handle carries `readonly meta: readonly Tag.Binding<unknown>[]` (a shared
  **frozen** empty array when unset — zero per-unit allocation, and immutable so no caller can
  reach past `readonly` and leak a binding across every no-meta unit). An extension reads
  `handle.meta` generically.

- **Read (typed):** a tag reads its own value off any unit's meta via `tag.read(unit)`, returning a
  `Tag.Presence<T>`: the nearest matching binding, else the tag's default, else absent — the same
  shape as an optional scope read, but over the unit's static list (no scope chain).

  ```ts
  ui.read(port); // { present: true, value: "slider" }
  ```

- **Static and inert.** Meta is definition-time and does not participate in scope resolution,
  release, or observation. It is a stored array reference plus a linear `read`; off the hot path.

## Consequences

- No new metadata primitive: tags serve both ambient (scope-resolved) and static (per-unit) roles,
  so the unit/primitive count is unchanged and meta values are typed by `tag<T>`.
- "Meta on the tag itself" is free — a `Tag.Handle` is a unit like the others and carries `.meta`.
- The extension story is a single generic read (`handle.meta`) or a typed `tag.read(unit)`.
- Multiple bindings of one tag are allowed (the array keeps them); `tag.read` returns the nearest.
  A list reader (`.all`-style) can be added later if a consumer needs every value; not in this cut.
