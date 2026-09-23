# @tinker/drizzle

The client is a namespace resource, the transaction a session resource whose commit is the
session's success (ADR 0041). One declared store can serve many tenants.

```text
drizzleStore({ label?, open, close? })
├── store.config   (tag, required)
├── store.db       (resource, namespace)  open(config, { logger }) once per tenant
└── store.tx       (resource, session)    db.transaction(cb) held open for the session
```

`config` has no default: resolving a database without a root or namespace binding
raises core's `MissingTag` with the config label.

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

Without a namespace, `db` uses the root's default bucket: one database per scope,
and one transaction per request session, as before. `label` defaults to `"drizzle"`;
it names the graph nodes, not the tenant. To keep separate tenant databases in one
scope, bind the same store's config once per namespace:

```ts
const a = namespace({ tags: [store.config({ url: "a" })] });
const b = namespace({ tags: [store.config({ url: "b" })] });
await scope.session({ ns: a }, (s) => s.run(addUser, { input: "ada" }));
await scope.session({ ns: b }, (s) => s.run(addUser, { input: "grace" }));
```

Both requests for `a` reuse its database. Each request has its own transaction.
A request tag cannot override the config used to open the tenant database:
`db` reads the namespace's bindings and root tags, not the asking session's tags.
Closing the scope closes each opened database once, after its transactions settle.

A resource dependency is delivered as its built value (ADR 0044). An operation that writes
declares `depends: { tx: store.tx }` and uses the transaction directly. Core waits for an async
resource build before entering the operation body:

```ts
const addUser = operation({
  label: "addUser",
  input: parseName,
  depends: { tx: store.tx },
  run: async ({ tx }, ctx) => tx.insert(users).values({ name: ctx.input }),
});
```

The logger passed to `open` writes one `db query` log line per statement. It records
SQL, not parameter values.

A helper that accepts a transaction can use
`DrizzleStore.Tx<Awaited<ReturnType<typeof openDatabase>>>` when `openDatabase` is async.
`Awaited` selects the built database value; `ReturnType` alone still names its promise.
The [tracker operations](../../apps/issue-tracker/src/server/operations.ts) use this pattern.

The outcome rule: when the owning session (or a graceful scope close) settles `success`,
the factory returns from the transaction callback — commit. On `failed`, `cancelled`, or
`released` it raises `Rollback` inside the callback — rollback. Nobody outside ever sees
`Rollback`; the resource's `defer` handles that expected rollback. Other commit or cleanup
failures remain in the close result; `scope.session(...)` rejects when cleanup fails. Await
the completed session before publishing saved state to other readers.

One transaction per request session (v1): a tagged call opens a child session, which would
build its own `tx` — a second transaction, not a savepoint. Bind per-flow tags at the
request session, not per call inside a transactional flow.

Test recipe: PGlite (in-memory Postgres) through `drizzle-orm/pglite`, a dev dependency.
`open` creates the client plus schema (`db.execute(sql\`create table …\`)`), `close` closes
the client. PGlite is single-connection: two transactions held open at once serialize (the
second waits), so overlapping sessions are honest in tests too.

## Single-connection stores (PGlite)

Two request sessions can each open `store.tx` at once. PGlite serializes the two
transactions itself — the second waits for the first — so a revision check inside the
transaction sees the first commit. **No app-level queue is needed**: the tracker's
"two concurrent edits on one revision settle exactly one winner" test
(`apps/issue-tracker/tests/issues.test.ts`) fires two PATCHes at one revision and expects
exactly one 200 and one 409.

A queue IS needed only for a store that _rejects_ a second concurrent transaction instead
of waiting. Serialize transaction entries in a scope resource the write operations depend on:

```ts
const noop = (): void => undefined;
/** One transaction at a time: a write waits its turn, then runs. */
const serial = resource({
  label: "serial",
  factory: () => {
    let tail: Promise<void> = Promise.resolve();
    return <T>(work: () => Promise<T>): Promise<T> => {
      const run = tail.then(work);
      tail = run.then(noop, noop);
      return run;
    };
  },
});
depends: { db: store.db, takeTurn: serial },
run: ({ db, takeTurn }, ctx) => takeTurn(() => db.transaction((tx) => writeEdit(tx, ctx.input))),
```
