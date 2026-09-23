# 0064 A `namespace`-target resource is one per namespace for the scope's lifetime

Date: 2026-09-23. Status: accepted. Refines: 0059 decision 8.

## Context

ADR 0059 gave resources two targets under namespaces: `scope` (one build at the root, shared by
every namespace) and `session` (one build per asking layer and namespace). Decision 8 said a
per-tenant resource that lives as long as the app is `session`-target inside a long-lived
`createSession({ ns: tenant })`.

That breaks as soon as requests run in child sessions. A `session`-target resource is owned by the
ASKING layer, so a request's child session builds its own copy. A tenant's database pool would open
once per request. Migrating `drizzleStore` exposed it: its `db` pool must be one per namespace and
shared by every request, and neither target says that.

**The analogy** is Effect's `LayerMap`: a layer per key, built once, shared by every request that
uses that key, released with the map.

## Decision

1. **A third target, `namespace`.** A `namespace`-target resource is owned by the ROOT (it lives until
   the scope closes, like `scope`) and keyed by namespace (one build per namespace, like `session`).
2. **Selection** follows the named-bucket rules t02a built for `session` resources, with the root as
   owner: a chain reuses the nearest occupied bucket and builds in its head. With no namespace it
   resolves the root's default bucket.
3. **Its dependencies resolve at the root in its namespace.** Tags come from the namespace's own
   bindings (`namespace({ tags })`) and the root. The asking session's tags never reach it, so a
   request cannot leak into a tenant's pool, the same guard `scope` has.
4. **Lifetime** is the same instance protocol as every other resource (ADR 0063): `release` clears
   its buckets, close finishes them, borrows are waited for.

The three targets, by owner and key:

```text
target     owner         key    one per
scope      root          none   scope
namespace  root          ns     namespace
session    asking layer  ns     session x ns
```

## Open

A `namespace`-target resource reached through a chain that mixes kinds of namespace,
such as `[agent, tenant]`, builds in the chain's head. The tenant's pool can then
be built twice depending on call order. It is safe today when resolved in the
tenant's own namespace. See `docs/roadmap/core-feedback.md`.

## Consequences

- `drizzleStore` declares `db` as `namespace`-target and `tx` as `session`: one declared store, one
  pool per tenant, one transaction per request.
- Other tenant-wide pools (an http client pool per tenant) have a home.
- Decision 8's "long-lived tenant session" advice is withdrawn.
