# Drizzle example

A local database tour using Drizzle and PGlite.
PGlite runs Postgres in memory; no database server is needed.
Each run starts with a new database.
The tour runs a migration, then reads the name committed by its session.
It waits for the database to close before returning.

## Run

Use Node 22.18 or newer and Vite+ (`vp`).
The Tinker packages are not released yet.
From the repository root, build and export a copy:

```bash
vp install
vp run -r build
vp run example:export -- drizzle /tmp/tinker-drizzle
```

The copy includes the Tinker packages it needs.
Run these commands inside that folder:

```bash
cd /tmp/tinker-drizzle
vp install
vp run start
```

The output is `ada`.
`vp run dev` runs the same tour.
After the repository install and build, these commands also work in
`examples/drizzle`.

## Check

From the example folder:

```bash
vp run check
vp run test
```

The tests run the real tour through `index.ts` with an in-memory database.
They check the saved name and fresh databases across repeated tours.

## Read the code

- `basic.ts` imports the resources from `@tinker/drizzle/pglite`.
  It declares the app's table and operations once.
- A namespace binds `config({ kind: "open" })` for a fresh in-memory client.
  The migration, session insert, and root read use the same namespace.
- The database resource opens its client when first used and owns its cleanup.
- `migrate` creates the table from `drizzle/20261001000000_users/migration.sql`.
  The migration commits before the session starts.
- Each session owns a transaction, a group of database changes.
  A successful session commits its changes before the root reads them.
- The driver sends SQL logs through the database resource.
- A stop signal closes the root in `finally`; the tour waits for `closed`.
- The entry prints only when run directly.
- `vite.config.ts` and `tsconfig.json` belong to this folder.

The namespace selects the database for the imported resources:

```ts
import { namespace } from "@tinker/core";
import { config } from "@tinker/drizzle/pglite";

const tourNamespace = namespace({
  tags: [config({ kind: "open" })],
});
```

Before inserting, the tour runs the shared migration operation:

```ts
import { fileURLToPath } from "node:url";
import { migrate } from "@tinker/drizzle/pglite";
import { migrationConfig } from "@tinker/drizzle/pglite";

const folder = new URL("./drizzle", import.meta.url);
const migrationsFolder = fileURLToPath(folder);
await scope.run(migrate, {
  ns: tourNamespace,
  tags: [migrationConfig({ migrationsFolder })],
});
```

The imported `transaction` returns the native Drizzle transaction.
The session's cleanup commits or rolls back its changes.
