# Drizzle PGlite module

Status: Review; code gates pass, fresh faults pending.
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

- **p01 public PGlite graph** — [x] blocked by: none.
  Native static resources, settings, migration action, public behavior tests.
  Verify: package build/check/test, strict census, Jev, release checks.
- **p02 tracker caller** — [x] blocked by: p01.
  Import the graph and run its migration action in the app startup extension.
  Keep baseline upgrades, borrowed fixtures, issue behavior, and startup order.
  Verify: tracker tests and browser-helper tests.
- **p03 standalone example** — [x] blocked by: p01.
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

Source checkpoint: `3d61241c`.
Opus 5.5 review: READY on that full code diff.

Observed gates, all exit 0:

- Full recursive build and root code check.
- All 28 test tasks using each project's own settings.
- Drizzle: 43 tests; tracker: 80 tests.
- Browser-helper: 7 more tests.
- Standalone example: 2 tests and output `ada`.
- The exported standalone copy installs, checks, tests, and runs.
- All 48 deterministic release checks.
- Prose: 0 hits; changed TypeScript census: OK; TSDoc: 0 rows.
- SCIP indices rebuilt for Drizzle and Stack; helper references remain valid.
- Built helper and migration entries match the base bytes exactly.

Both lifecycle regressions failed before their fixes:

- A stopped lazy factory created a database directory.
  It now checks the stop signal after every import.
- A bad path was published and repeated its error during cleanup.
  Owned clients now await readiness before publication.

The deferred UNIQUE test fails at COMMIT, raises native `23505`,
and leaves no new table.
It proves the migration answer waits for commit.
The tracker HTTP regression proves a failed activity write rolls back its insert.
A separate root/tenant probe confirms their native clients stay separate.

The full directory census shows two unchanged `void run` rows in app services.
They are outside this task; the changed-file strict census passes.
The root check has the same 28 existing warnings and 0 errors.

Frozen inputs cover all 14 packages.
Thirteen packages retain identical source, tests, settings, and built modules.
Their existing fault scores remain valid.
Drizzle needs its fresh isolated fault lane; the retry is pending.
The first attempt exited 1 during the initial tests with Node `SIGILL`.
Its Wasm cleanup assertion matches [Node issue 66366](https://github.com/nodejs/node/issues/66366).
The retry passes `--testRunnerNodeArgs "--no-wasm-code-gc"`.
Only the test process receives the flag; code, tests, and floor stay unchanged.
The crash log is `/tmp/tinkered-pglite-mutation-node24-crash.log`.
Five Jev labels are saved; full calibration completed with exit 0.
[Package input and fault proof](pglite-fault-proof.json).
