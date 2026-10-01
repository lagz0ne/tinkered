# Drizzle PGlite module

Status: Doing.
Owner: authoring lead.
Writers: Astra, xhigh, one package each.
Review: Opus 5.5, high.

## Goal

Publish reusable static units from `@tinker/drizzle/pglite`.
Apps import the database graph and declare their own tables and actions.
Namespace tags select independent instances.
Scopes own database clients; sessions own app transactions.

The precedent is Effect SQL's split between a shared contract and database drivers.
Each driver must keep the connection reserved until its transaction ends.
PGlite already awaits its transaction callback.
SQLite needs its own connection and transaction path.
This ticket implements the PGlite case.

## Public shape

- `config`: a required static database settings tag.
- `database`: a namespace resource returning native Drizzle.
- `transaction`: a session resource returning the native transaction.
- `migrationConfig`: a static migration settings tag.
- `migrate`: an operation that runs a locked migration transaction.

```ts
import { namespace } from "@tinker/core";
import { config } from "@tinker/drizzle/pglite";

const issues = namespace({
  tags: [
    config({
      kind: "open",
      url: "./data/issues",
    }),
  ],
});
```

`Database.Config` has two cases:
`{ kind: "open", url?: string }` opens an owned client.
`{ kind: "borrow", client: PGlite }` retains a borrowed client.
The SDK loads only inside the resource factory.
`Database.Handle` is the native inferred database type.

`Migrate.Config` names `migrationsFolder` and an optional `baseline` callback.
The callback receives the native transaction and runs before pending files.
The migration operation depends on `database` and `migrationConfig`.
It owns a native callback transaction for the whole action.
It takes the existing Postgres advisory lock before baseline or migrations.
Its answer comes after commit; errors roll back before returning.
After each async stage, check the call signal before starting more work.
An aborted call must reach rollback rather than commit.

An app extension runs `migrate` before continuing startup.
The extension receives the scope in its event hook.
It passes migration settings as a tag binding on the call.
It may select a namespace on that call.
App actions depend on the exported `transaction` resource.

The helper entry stays for custom typed schemas and other awaited drivers.
It cannot supply a SQLite transaction protocol.
No generic CRUD operations or empty extension are needed.

## Tickets

- **p01 public PGlite graph** — [ ] blocked by: none.
  Native static resources, settings, migration action, public behavior tests.
  Verify: package build/check/test, strict census, Jev, release checks.
- **p02 tracker caller** — [ ] blocked by: p01.
  Import the graph and run its migration action in the app startup extension.
  Keep baseline upgrades, borrowed fixtures, issue behavior, and startup order.
  Verify: tracker tests and browser-helper tests.
- **p03 standalone example** — [ ] blocked by: p01.
  Show direct imports, namespace settings, and app operations.
  Verify: check/test/start, repeated tours, standalone export check.
- **p04 review and land** — [ ] blocked by: p02, p03.
  Review the combined change and run the final gates by exit code.
  Verify: full build/check/tests, prose, release checks,
  fresh isolated Drizzle fault score >= 85, and SCIP references.

## Impact before code

Add public units and types at `@tinker/drizzle/pglite`.
Keep `openTransaction`, `createQueryLogger`, and the migration helper entry.
No Core or Stack API change is planned.

Tracker `storeConfig` becomes an alias of the driver config tag.
Its bindings change from a path or client to the object cases above.
Tracker `store` and `transaction` become aliases of the driver resources.
Keep the app's `Store.Config` and `Store.Database` type names.
Tracker `migrateIssues` stays an extension with the same startup order.
Its start hook calls the exported migration operation.

Known callers: tracker server main, seven tracker test files,
tracker migration baseline, standalone Drizzle example.
Hono and Stack custom resource fixtures still use the helper entry.

Before review, index Drizzle and Stack and inspect references:

```bash
scripts/scip.sh index drizzle stack
scripts/scip.sh symbols 'openTransaction|database' drizzle
scripts/scip.sh refs 'openTransaction|migrateDatabase'
```

Review also checks all `storeConfig` bindings and example exports.
Fresh faults are required for Drizzle because source and tests change.
Other packages keep their existing mutation proof only when source,
tests, settings, and the runtime they import are unchanged.

## Proof

Pending.
