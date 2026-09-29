# 0079 Migrations: one step at boot, on Drizzle 1.0 RC; pg-boss keeps its own

Date: 2026-09-29. Status: accepted. Builds on: 0074 (the stack), 0075 (the v1 picks), 0077
(glue lives in its home package). Research: `docs/roadmap/stack-v1/RESEARCH.md`, round 3.

## Context

Three owners make tables in one database: the app, Better Auth, and pg-boss. Dev, tests, and
prod must end with the same tables. Today the issue tracker runs hand SQL at boot
(`create table if not exists`), which cannot rename a column or change a type.

Drizzle's stable line (`drizzle-orm` 0.45, `drizzle-kit` 0.31) breaks on branches. Two branches
that each run `generate` conflict in `meta/_journal.json`. `migrate()` runs only files newer than
the last one applied, so a merged file with an older time never runs, and nothing says so
(tested). Every writer here works on its own branch. Drizzle 1.0 (`rc.4`, 2026-06-27, no stable
date) keeps one folder per migration and runs every folder not yet applied. Its `check` fails
when two branches clash.

**The precedent is Rails.** A gem's migrations join the app's one history (engines, Devise), and
the app migrates at boot under a Postgres advisory lock. Solid Queue is the exception: it keeps
its own schema. Ours follows both: Better Auth joins our history, pg-boss keeps its own.

## Decision

1. **Drizzle 1.0 RC, pinned to an exact version.** `drizzle-orm` and `drizzle-kit` must match.
   We move to stable when 1.0 ships.
2. **One migrate step, at boot and in test setup,** before anything serves:
   1. take a Postgres advisory lock, so two servers never migrate at once (Drizzle takes none);
   2. Drizzle's `migrate()`: our tables and Better Auth's;
   3. pg-boss `start()`: its own `pgboss` schema, under its own lock.
3. **Better Auth's tables join our history.** `npx auth generate` writes its Drizzle schema into
   the app under `pgSchema("auth")`. `drizzle-kit generate` makes the SQL.
4. **pg-boss keeps its own history.** Its SQL cannot go into a Drizzle file: each script has its
   own `BEGIN`/`COMMIT`, and some end with `CREATE INDEX CONCURRENTLY`, which cannot run in a
   transaction. Drizzle's `schemaFilter` leaves `pgboss` alone; 1.0's `push` would otherwise plan
   `DROP SCHEMA "pgboss"`.
5. **The tests check that everything agrees:**
   - the schema in code matches the migration files (`drizzle-kit generate --explain` says
     `no_changes`);
   - `auth generate` matches the committed file;
   - tests build one database by the same step, then `clone()` it for each test.
6. **Never `drizzle-kit push`.** Dev runs the same files as prod.

## Consequences

- The Drizzle half lives in `@tinker/drizzle`; the order across owners lives in the stack.
- The issue tracker's hand SQL becomes its first migration. An existing tracker database needs a
  baseline; its ticket settles how.
- Neither Drizzle version notices an edited old migration. Review is the guard.
- On PGlite, a file with two statements needs a `--> statement-breakpoint` line between them.
  `drizzle-kit` writes them; a hand-written `--custom` file must too.

## Options considered

- **Stay on 0.45 and write our own check.** Rejected: the silent skip is Drizzle's bug, and our
  check would have to track every Drizzle release.
- **Copy pg-boss's SQL into Drizzle files** (the Rails engines way). Rejected: see 4.
- **Hand SQL at boot.** Rejected: it cannot rename a column or change a type.
