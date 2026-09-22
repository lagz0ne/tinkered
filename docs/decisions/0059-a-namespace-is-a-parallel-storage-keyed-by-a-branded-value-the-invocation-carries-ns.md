# 0059 A namespace is a parallel storage keyed by a branded value; the invocation carries `ns`

Date: 2026-09-22. Status: proposed. Refines: 0038 (a tagged call opens a child session), 0036 (the
three verbs), 0044 (a resource dep is its value), 0057 (a unit is declared once), 0058 (the graph
produces the trace). Not yet built — this records a converged design and its probes.

## Context

A frame is a factory today (`httpClient({ label })`) so an app can have github and stripe at once.
ADR 0057 showed the `label` only exists to give a tag a distinct identity — it is the storage axis
with no first-class name. The open question was whether "multiple instances" needs a new primitive.

A probe answered it. Sessions already ARE parallel storages: two sibling sessions off the root, each
binding a config tag, run one declared `client` resource and get one build apiece with isolated cell
state, created dynamically, persisting until closed. Four of five needs are already met by the layer
tree, which keys storage by `(layer, unit)`.

The fifth is not: **one operation touching two persistent storages at once.** The user's case is an
LLM integration (Codex) used to build two agents A and B, where an orchestrator relays A↔B. As a
plain function holding both session handles it works — but it is then OUTSIDE the graph: no span, no
composition, failing ADR 0058's bar. As an operation it cannot address a persistent sibling: a tagged
call (ADR 0038) makes a fresh throwaway child, not the standing A or B. That gap is the whole reason
for this ADR, and it must be closed IN the graph.

**The analogy** is Effect's `LayerMap` (and its `RcMap` underneath): one Layer — the graph template
— keyed by an opaque `K`, `get(key)` returning that key's instance, storage in a reference-counted
map that releases an idle key. We do not invent; a namespace IS `LayerMap`, and our storage key is
its `K`. The chain fallback below is Postgres `search_path` / the JS prototype chain / our own layer
chain — the same read-through shape, sideways.

## Decision

1. **A namespace is a branded value, not a name; its config is its binding.** `namespace(opts?)`
   mints one, exactly as `data({ initial })` and `tag({ default })` mint configured branded handles.
   `opts.tags` are the namespace's own bindings (github's backend, stripe's) — the thing that made
   two frames-with-labels necessary; bare `namespace()` is for instances that differ only by
   accumulated state (agents A and B). It carries no string; two namespaces differ by identity.
   Callers pass the value around; they never name a namespace.
2. **The invocation carries `ns`.** The storage key generalises from `(layer, unit)` to
   `(layer, ns, unit)`, default absent = today's single namespace. `ns` is one more attribute on the
   invocation object the three verbs already share — no new verb, no new edge, no `ctx.in`. A
   namespace is NOT a session: a session is a new layer (it changes the span parent AND the storage);
   a namespace keeps the current layer (the span parent stays, so `relay > a:turn > b:turn` nests)
   and changes ONLY the storage bucket. A probe proved this — running a subflow via a session handle
   re-parents its span to that session, breaking the orchestration trace; keeping the layer and
   swapping the storage key is the one thing no existing primitive does, which is the core change:

```ts
turn.run({ input, ns: a }); // a subflow, in namespace a
scope.run(op, { ns: a, input });
scope.resolve(cell, { ns: a });
scope.controller(cell, { ns: a });
```

3. **`ns` is one key or a fallback chain, read-through.** This is the layer-shadow model on a second
   axis, not new semantics:

```text
ns: a        read a, else default (the unit's initial /
             a default-written value)
ns: [a, b]   read a, else b, else default (a search-path)
read   first key in the chain WRITTEN wins, else default
write  the first key in the chain
```

Resolve walks the layer chain and the ns chain together; a write lands at `(this layer, first
   key)`. A child session inherits a parent's namespaces the way it inherits cells — by shadowing.

4. **Static and dynamic are the same object, a constant or a computed key.** Static: `ns` is a
   wiring-time constant closed over in the run body (`turn.run({ input, ns: a })`), so the graph shows
   which namespaces it touches — the trace reads `relay > a:turn > b:turn`, satisfying ADR 0058. The
   op's `depends` stays `{ turn }`; `ns` rides the run exactly as `tags` does. Dynamic: `ns` is
   derived from a third factor at runtime (`ns: keyFor(ctx.input)`) — a tenant from the request, an
   agent id spawned mid-run.
5. **Ambient on the session, explicit per call.** "All work in this tenant" binds the namespace once
   on the session (`createSession({ ns: tenant })`, inherited by every unit inside); "one op touches
   A and B" passes `ns` per subflow. This is the ambient-plus-override shape tags already have, so the
   two needs have one expression each and do not overlap — a probe found the per-call-only form was a
   trap (forget `ns`, silently hit default) that the ambient session removes.
6. **Fallback is write-what-differs, read-through.** `ns: [a, b]` reads a, else b, else default; a
   tenant writes only the settings it overrides and inherits the rest (CASE 5), and a shared value is
   one written in the default namespace that every tenant reads through to (CASE 6, for data).
7. **Storage is reference-counted, per the precedent.** A namespace's `(layer, ns, unit)` entries
   release when no live borrow holds them (Effect's `RcMap`), so the dynamic case (thousands of
   short-lived tenants) needs no hand-close. The layer closing still closes everything under it.
8. **`target` is the shared-versus-per-namespace axis; there is no new marker.** A resource with
   `target: "scope"` is namespace-blind: one build at the root, every namespace reads through to it
   (a shared pool). A resource with `target: "session"` is namespace-keyed: one build per layer x
   namespace (a per-tenant client). This is what the two words already mean, stretched one step —
   scope is the whole scope; session is the asking layer, and a namespace is a bucket inside a layer.
   It is also the precedent: Effect's `LayerMap` keeps shared things outside the keyed region and only
   what varies inside it. A probe ran the exact case — `client` (session-target) depending on `pool`
   (scope-target) across two namespaces — and got one pool, two clients, both holding the one pool.
   "Per-tenant for the app's lifetime" is `target: "session"` inside a long-lived
   `createSession({ ns: tenant })`: a tenant's lifetime IS a layer. The mistake is loud, not silent:
   a scope-target resource that needs a namespace-bound tag resolves at the root's default bucket
   and raises `MissingTag` on its first run, exactly as it does today for a session-bound tag.
9. **The frame stops needing `label`.** With config bound per namespace, one `httpClient` declaration
   serves github and stripe: `send.run({ input, ns: github })`. The factory-with-label pattern (ADR
   0057's Case 2) is the thing this retires; `label` remains only where a genuinely distinct tag
   identity is wanted at authoring time.

## Consequences

- One core generalisation: `nodeState` keyed by `(layer, ns, unit)`; the invocation object and the
  two scope verbs grow an optional `ns: Namespace | readonly Namespace[]`; `namespace()` mints keys.
  Additive, benchable; the hot path is unchanged when `ns` is absent.
- A↔B, cross-tenant migrate/compare, and multi-agent orchestration become first-class traced graphs.
- Sessions and namespaces are orthogonal: session is the layer axis (nested lifetime), namespace the
  key axis (parallel, refcounted). "Session is layer, namespace is cross-cut" holds.

## Open — decide with a probe before building

- **Refcount release timing.** When exactly a dynamic namespace's storage releases (last borrow
  settles vs an idle grace like `RcMap`'s `idleTimeToLive`), and whether a resource `defer` in a
  released namespace runs on release or on layer close. The one place Effect's `RcMap` and our
  layer-close model differ; needs its own probe.
- **`ns` chain × session chain order.** Whether resolve walks layers-then-namespaces or the reverse
  when both are chains; the probe is a cell written at a parent layer in namespace `b` read from a
  child layer with `ns: [a, b]`.

## Alternatives rejected

- **Keep the factory-with-`label`** — mints a new graph identity per instance to fake parallel
  storage (ADR 0057); the probe shows one declaration plus `ns` serves N.
- **Namespace as a held session handle** — cannot be reached from an operation's `ctx`, so the
  orchestrator stays a plain function outside the graph (fails ADR 0058). The probe proved this.
- **A string-named namespace with a registry** — invents names, ownership, and collisions the branded
  key avoids; Effect's `K` is opaque for the same reason.
- **A new verb (`ctx.in(ns)`) or edge (`unit.of(ns)`)** — a second mechanism where the invocation
  object already carries per-call concerns (`tags`); `ns` is one more attribute, not a new surface.
