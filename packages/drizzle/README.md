# @tinker/drizzle

The client is a scope resource, the transaction a session resource whose commit is the
session's success (ADR 0041).

```text
drizzleStore({ label, open, close? })
├── store.config   (tag, required)
├── store.db       (resource, scope)      open(config, { logger }) once; defer → close(db)
└── store.tx       (resource, session)    db.transaction(cb) held open for the session
```

A frame is cheap to import (ADR 0042): the driver import lives inside `open`, so binding
`store.config` at an entrypoint — or listing CLI commands — loads no database code until the
store is first resolved:

```ts
export const store = drizzleStore({
  label: "store",
  open: async ({ url }: { url: string }, { logger }) => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    return drizzle(new PGlite(url), { logger });
  },
  close: (db) => db.$client.close(),
});
createScope({ tags: [store.config({ url: "memory://" })] });
```

An async resource is delivered as a promise (`Scope.ResourceValue`): an op that writes declares
`depends: { tx: store.tx }` and awaits it, nothing else:

```ts
const addUser = operation({
  label: "addUser",
  input: parseName,
  depends: { tx: store.tx },
  run: async ({ tx }, ctx) => tx.insert(users).values({ name: ctx.input }),
});
```

The outcome rule: when the owning session (or a graceful scope close) settles `success`,
the factory returns from the transaction callback — commit. On `failed`, `cancelled`, or
`released` it raises `Rollback` inside the callback — rollback. Nobody outside ever sees
`Rollback`; the resource's `defer` swallows the transaction promise.

One transaction per request session (v1): a tagged call opens a child session, which would
build its own `tx` — a second transaction, not a savepoint. Bind per-flow tags at the
request session, not per call inside a transactional flow.

Test recipe: PGlite (in-memory Postgres) through `drizzle-orm/pglite`, a dev dependency.
`open` creates the client plus schema (`db.execute(sql\`create table …\`)`), `close` closes
the client. PGlite is single-connection — never hold two transactions open at once in a
test; sequential sessions are fine.
