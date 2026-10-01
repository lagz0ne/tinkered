# 0094 Databases are static resources, not store frames

Date: 2026-10-01. Status: accepted.
Refines the public API shape in 0041; keeps its transaction outcome rule.

## Context

The user rejected `drizzleStore({ open, close })` wrapping the resource API.
The database and transaction must be static authored resources.
Namespaces select settings and keep database instances apart.

The precedent is Core's resource factory and owned cleanup.
The author declares setup, dependencies, and cleanup in that one place.
Drizzle's callback transaction still needs a bridge to the session outcome.

## Decision

Remove the store frame builder.
Declare the config tag, database resource, and transaction resource directly.
Return native database and transaction values; do not wrap the client.
The logger and transaction adapters work inside a resource factory.
They do not create graph nodes, keep a scope, or choose instance lifetime.
Do not add an empty extension to resources that already own the work.

```ts
const dbUrl = tag<string>({ label: "db.url" });
const db = resource({
  label: "db",
  target: "namespace",
  depends: { url: dbUrl },
  async factory({ url }, ctx) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const client = new PGlite(url);
    ctx.defer(() => client.close());
    return drizzle({
      client,
      logger: createQueryLogger(ctx),
    });
  },
});
const tx = resource({
  label: "tx",
  target: "session",
  depends: { db },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
const tenant = namespace({
  tags: dbUrl("memory://"),
});
```

Import `tag`, `resource`, and `namespace` from `@tinker/core`.
Import both adapters from `@tinker/drizzle`.
A shared connection uses `target: "scope"` explicitly.
An externally owned client stays borrowed; its owner closes it.

A transaction resource awaits commit or rollback during its owned cleanup.
Successful session completion commits; other outcomes roll back.
Begin, commit, cleanup, SQL logging, and native type guarantees remain.
The session still completes its transaction before an HTTP answer leaves.
