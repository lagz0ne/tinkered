# @tinker/drizzle

Drizzle is a graph module for database setup, transactions, and migrations.
App code imports static units from the driver entry.
For PGlite, use `@tinker/drizzle/pglite`:

```ts
import { database } from "@tinker/drizzle/pglite";
import { transaction } from "@tinker/drizzle/pglite";
import { migrate } from "@tinker/drizzle/pglite";
```

The root entry supplies `createQueryLogger` and `openTransaction`
for app-authored resources using a native Drizzle database.
Each driver keeps its own types and optional SDK dependencies.
See the [package roles](../../docs/best-practices.md#give-the-package-a-job).

Requires `drizzle-orm@^0.45.2` or `drizzle-orm@^1.0.0-rc.4`.
This repo pins Drizzle ORM and Kit to `1.0.0-rc.4`.

## PGlite graph

`@tinker/drizzle/pglite` requires Drizzle `1.0.0-rc.4`
and `@electric-sql/pglite@^0.5.8`.
It exports `config`, `database`, `transaction`,
`migrationConfig`, and `migrate` as static units.
Declare app tables and operations once at module scope.

```ts
import { createScope, extension } from "@tinker/core";
import { namespace, operation } from "@tinker/core";
import { config } from "@tinker/drizzle/pglite";
import { transaction } from "@tinker/drizzle/pglite";
import { migrate } from "@tinker/drizzle/pglite";
import { migrationConfig } from "@tinker/drizzle/pglite";
import { pgTable, text } from "drizzle-orm/pg-core";

const users = pgTable("users", {
  name: text("name").notNull(),
});
const addUser = operation({
  label: "addUser",
  depends: { tx: transaction },
  run: ({ tx }) => tx.insert(users).values({ name: "Ada" }),
});
const team = namespace({
  tags: [config({ kind: "open", url: "./data/team" })],
});
const prepare = extension({
  label: "prepare",
  hooks: {
    start: async (event) => {
      await event.scope.run(migrate, {
        ns: team,
        tags: [
          migrationConfig({
            migrationsFolder: "./drizzle",
          }),
        ],
      });
      await event.next();
    },
  },
});
const stop = new AbortController();
const scope = createScope({
  signal: stop.signal,
  extensions: [prepare],
});
await scope.ready;
await scope.session({ ns: team }, (session) => {
  return session.run(addUser);
});
stop.abort();
await scope.closed;
```

Generate the `./drizzle` files from the app's tables with
its pinned Drizzle Kit before running this example.
The first migration creates the `users` table.

`Database.Config` chooses who owns the client:

```ts
import { PGlite } from "@electric-sql/pglite";
import { config } from "@tinker/drizzle/pglite";

const client = new PGlite();
config({ kind: "open", url: "./data/team" });
config({ kind: "open" });
config({ kind: "borrow", client });
```

An open client uses the given path, or memory without a URL.
A borrowed client keeps the exact client open after scope close.
`Database.Handle` is the inferred native Drizzle database.
Custom typed schemas can still declare their own resources
with `createQueryLogger` and `openTransaction`.

Missing PGlite config raises `MissingTag` with the config label.
An owned database opens its configured path lazily and closes with the scope.
Stopping a lazy database build leaves its configured path unopened.
An owned database is ready before resolution returns.
An invalid owned path rejects during resolution without a duplicate cleanup error.
Two roots open separate clients and closing one leaves the other usable.
Tenant databases stay separate and request config cannot replace the tenant client.
A failed session rolls back while the prior session commit stays visible.
Each session reuses one native transaction and the next session gets another.

`Migrate.Config` takes `migrationsFolder` and an optional
`baseline(tx)` callback with the native transaction.
The callback upgrades old tables and records their baseline
before pending files run.
The migration operation owns its complete transaction,
including the Postgres advisory lock shared with Stack.
Its key is `classId: 1937006964, objectId: 1`.

- Missing migration settings raise `MissingTag` with the migration config label.
- Root migrations commit before answering and produce a child span under the caller.
- Baseline and pending files share the migration lock and commit together in the selected tenant.
- A failed migration rolls back the baseline and every pending file before answering.
- A failed migration commit rejects the action and rolls back its schema and data.
- A failed baseline rolls back and never starts pending migration files.
- Stopping during baseline waits for rollback and leaves pending files untouched.
- Stopping after the last migration statement rolls back before commit.

Pass a call signal to stop a migration.
Each awaited stage checks the signal before more work starts.
The last check happens before the transaction commits.
Awaited database calls finish before the stop reaches rollback.

## Custom resources

The root helper entry supports Drizzle `^0.45.2` or
`^1.0.0-rc.4` callback transactions that await their callback.
It has no SDK or Node runtime import.
Synchronous SQLite transactions need a separate driver;
these helpers cannot keep their callback open.
The helpers create no graph nodes.
This custom resource example uses Drizzle 1.0 relations.

```ts
import { resource } from "@tinker/core";
import { createQueryLogger } from "@tinker/drizzle";
import { openTransaction } from "@tinker/drizzle";
import { defineRelations } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";

const users = pgTable("users", {
  name: text("name").notNull(),
});
const customDatabase = resource({
  label: "custom.database",
  target: "namespace",
  factory: async (_deps, ctx) => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const client = new PGlite();
    ctx.defer(() => client.close());
    return drizzle({
      client,
      relations: defineRelations({ users }),
      logger: createQueryLogger(ctx),
    });
  },
});
const customTransaction = resource({
  label: "custom.transaction",
  target: "session",
  depends: { db: customDatabase },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
```

The driver loads only when the database first resolves.
Binding a tag or importing these declarations opens no database.
A config tag without a binding raises Core's `MissingTag` with its label.

A namespace database stays open across request transactions until scope close.
Repeated requests in one namespace reuse that database.
A request config tag cannot replace its tenant database config.

Use `target: "scope"` on the database to share one client across namespaces.
The same declaration used by two roots opens a separate client in each root.
Closing one root closes only its owned client, after its transactions settle.
For a borrowed client, leave its close call to its owner.

`createQueryLogger(ctx)` returns `QueryLogger.Handle` for Drizzle's `logger` option.
Each statement writes one `db query` log line with SQL and never the parameter values.
`openTransaction(db, ctx)` returns the exact native transaction handle.
`Transaction.Database` describes Drizzle's callback transaction method.
`Transaction.Handle<DB>` names the native transaction type for a concrete database type.

Core waits for resource dependencies before entering an operation.
Each session opens one transaction; two sequential sessions open two transactions.
At the root, the transaction builds once and a graceful scope close commits with success.

A successful session commits before its answer reaches the caller.
A failed, cancelled, or released session rolls back.
A throwing operation rejects the session with its error and leaves no row behind.
A failed tenant request rolls back without losing another request's commit.
A forced close rolls back a parked insert and leaves a borrowed client open.

A failed begin rejects the session without waiting for a transaction handle.
A failed commit rejects the session with `TeardownFailed` holding the database error.
The adapter handles its own expected `Rollback`; other cleanup errors remain visible.
Await the completed session before publishing saved state to other readers.

A tagged call opens a child session with its own transaction, not a savepoint.
Bind per-flow tags on the request session when its operations must share one transaction.

PGlite serializes overlapping transactions on its single connection.
The second transaction waits for the first commit, so its revision check sees that commit.
The tracker tests two edits at one revision and expects one success and one conflict.
A driver that rejects overlapping transactions needs a queue owned by a resource.

## Migration files

The Node entry `@tinker/drizzle/migrations` requires
Drizzle ORM and Kit `1.0.0-rc.4`.
`migrateDatabase(db, { migrationsFolder })` borrows a
Postgres database or transaction and runs Drizzle's files.
The caller owns the lock and the boot order.
The PGlite `migrate` operation supplies the locked transaction.

For an old database, first bring its tables level.
Then pass `baseline` with the exact first folder name.
Drizzle records that file with its original hash and time,
but without running its SQL.
Later folders still run on the normal call.
The caller must make the upgrade and record one transaction.

```ts
await migrateDatabase(tx, {
  migrationsFolder: "./drizzle",
  baseline: "20260929165528_tracker",
});
```

`checkDrift("/app/drizzle.config.ts")` runs the app's
pinned Kit with `generate --explain --output json`.
Only `no_changes` passes.
A mismatch raises `SchemaDrift` with the config path
and Kit's result.
Kit failures with JSON output also raise `SchemaDrift`.
Other Kit failures reach the caller unchanged.
It writes no migration and uses no database.

- Migration folders run once and a later folder runs
  on the next boot.
- A failed batch leaves none of its pending migrations
  applied.
- A named baseline is recorded without running its SQL
  or skipping later folders.
- A missing baseline names the absent migration folder.
- An empty migrations folder needs no baseline.
- The drift check accepts matching files and rejects
  an unsaved schema change.
- A renamed column raises `SchemaDrift` with `missing_hints`.
- A Kit failure with text output keeps the command error.
- A config path with a NUL keeps Node's argument error.
- Kit output without a status raises `SchemaDrift`.
