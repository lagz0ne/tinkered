# 0041 Drizzle: the client is a scope resource, the transaction is a session resource whose commit is the session's success

Date: 2026-09-18. Status: accepted. Refines: 0034 (dedicated capability), 0013/0018 (resource
target + owner), 0024/0026 (`defer` + `end.status`), 0028 (close modes), 0038 (tagged calls).

## Context

The second dedicated capability is a database through Drizzle. Drizzle is a query builder over a
driver client; its transactions are callback-scoped (`db.transaction(async (tx) => …)`, nested
calls are savepoints) and it logs through one `logQuery(sql, params)` per database instance.
Effect's `@effect/sql` binds a transaction to the fiber (`withTransaction`, nesting by depth) and
`@effect/sql-drizzle` runs Drizzle through that client.

Ours is simpler and already decided elsewhere: a request is a session (ADR 0039), a session
closes gracefully on success and forced on abort (ADR 0028), and a resource's `defer` sees that
outcome as `end.status` (ADR 0024/0026). So **the transaction is a session-target resource and
its commit or rollback IS the session's outcome**. No transaction API for operations to call.

## Decision

```text
drizzleStore({ label, open, close? })        the frame (dedicated capability)
├── store.config   (tag, required)            slot: connection config, bound at the scope
├── store.db       (resource, scope)          open(config, { logger }) once; defer → close(db) at scope close
└── store.tx       (resource, session)        db.transaction(cb) held open for the session's lifetime:
                                              defer(end): success → return (commit) · failed | cancelled | released → throw (rollback)
      queries      → one `db query` log line per statement (Drizzle's logger bound to the db resource's ctx.log)
```

- **The client is owned by the scope.** `store.db` is `target: "scope"`; its factory calls the
  frame's `open(config, tools)` once and registers `close(db)` with `defer`, so the entrypoint's
  `scope.close()` closes the pool — the same ownership as every other resource. `open` receives
  `tools.logger`, a Drizzle `Logger` bound to the resource ctx's `log`, so `drizzle(client, {
schema, logger })` makes every statement a `db query` log line (`{ sql }` only — params are
  data, never logged). The driver import lives in `open`, at module level, once.
- **The transaction is owned by the session.** `store.tx` is `target: "session"`, depends on
  `store.db`; its factory starts `db.transaction(cb)` and resolves the `tx` handle from inside
  the callback, holding the callback open on a promise the `defer` settles: `end.status ===
"success"` returns from the callback (commit); anything else throws inside it (rollback). The
  `defer` awaits the transaction's own promise, so a graceful close resolves only after the
  commit is durable. Operations depend on `store.tx` and just write; the request decides.
- **At the root scope** (no session) `tx` builds at the root and commits at scope close — legal,
  documented, rarely what you want; a CLI command runs in a session (ADR 0042) for this reason.
- **One transaction per request session (v1).** A tagged call (ADR 0038) opens a child session,
  and a child session would build its own `tx` — a second transaction, not a savepoint. Rule:
  bind per-flow tags at the request session (hono's `tags` slot), not per call inside a
  transactional flow. Savepoints need a core affordance ("inherit the parent session's built
  instance") — recorded as core feedback, not built here.
- **Types follow the instance.** `drizzleStore<DB, Config>` infers `DB` from `open`'s return and
  the transaction handle type from `DB["transaction"]`'s callback parameter — no Drizzle import
  at runtime in the frame; `drizzle-orm` is a peer dependency used for types only.
- **Tests use a real database:** PGlite (in-memory Postgres, pure JS) through `drizzle-orm/pglite`,
  a dev dependency. No mocks. PGlite is single-connection: two transactions held open at once
  serialize (the second waits) — tests never hold two open concurrently, and a production pool
  (postgres-js, node-postgres) has no such limit.

```ts
export function drizzleStore<Config, DB extends Transactional>(config: {
  label: string;
  open: (config: Config, tools: { logger: Logger }) => DB | PromiseLike<DB>;
  close?: (db: DB) => void | PromiseLike<void>;
}): DrizzleStore.Frame<Config, DB>;
// Frame = { label; config: Tag.Handle<Config>; db: Resource.Handle<Promise<DB>>; tx: Resource.Handle<Promise<Tx<DB>>> }
// Transactional = { transaction<T>(cb: (tx: any) => Promise<T>): Promise<T> }   (structural; Drizzle's shape)
// Tx<DB> = Parameters<Parameters<DB["transaction"]>[0]>[0]
// Logger = { logQuery(query: string, params: unknown[]): void }                (Drizzle's interface, declared structurally)
```

## Consequences

- An operation that writes declares `depends: { tx: store.tx }` and nothing else; commit and
  rollback follow the request (hono) or the command (cli) outcome. This is the first place the
  ADR 0028 close modes pay off outside core.
- Core feedback (recorded in `docs/roadmap/core-feedback.md`): (1) a session-target resource
  that inherits the parent session's instance when one exists (savepoints, per-flow sharing);
  (2) a resource `defer` that can veto or delay the close is not needed — awaiting the commit
  inside `defer` suffices.

## Alternatives rejected

- **The entrypoint creates the Drizzle instance and binds it on a tag** — moves a pool's close
  out of `defer`; the scope already owns lifetimes.
- **Operations call `db.transaction` themselves** — the outcome logic would be repeated per op and
  could not follow a forced close.
- **Savepoints now** — needs a core affordance first; one transaction per request session is
  honest and enough for v1.
- **sql.js as the test database** — SQLite semantics; the promise under test is Postgres-shaped
  transactions.
