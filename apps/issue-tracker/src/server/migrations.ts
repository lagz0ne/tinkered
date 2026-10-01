import { fileURLToPath } from "node:url";
import { migrateDatabase, type Migrations } from "@tinker/drizzle/migrations";
import { migrate, type Migrate } from "@tinker/stack";
import { sql } from "drizzle-orm";
import { store } from "./store.ts";

const firstMigration = "20260929165528_tracker";

/** Keep this folder relative to the app, not the process's working directory. */
export const migrations: Migrate.Options = {
  migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  baseline: baselineIssues,
};

export const migrateIssues = migrate(store, migrations);

/** Only databases from the old hand-SQL history enter here. Every upgrade and
 * the journal record share the migrate step's locked transaction (ADR 0079). */
async function baselineIssues(db: Migrations.Database): Promise<void> {
  const [tables] = await db
    .select({
      issues: sql<string | null>`to_regclass('public.issues')`,
      history: sql<string | null>`to_regclass('drizzle.__drizzle_migrations')`,
    })
    .from(sql`(select 1) as probe`);
  if (tables.issues === null) return;
  if (tables.history !== null) {
    const applied = await db
      .select({ name: sql<string>`name` })
      .from(sql`drizzle.__drizzle_migrations`)
      .where(sql`name = ${firstMigration}`);
    if (applied.length > 0) return;
  }
  await db.execute(
    sql`alter table public.issues add column if not exists status text not null default 'open'`,
  );
  await db.execute(sql`alter table public.issues add column if not exists assignee text`);
  await db.execute(
    sql`alter table public.issues add column if not exists revision integer not null default 0`,
  );
  await db.execute(
    sql`alter table public.issues add column if not exists created_at bigint not null default 0`,
  );
  await db.execute(
    sql`alter table public.issues add column if not exists updated_at bigint not null default 0`,
  );
  await db.execute(
    sql`create table if not exists public.comments (id text primary key, issue_id text not null, author text not null, text text not null, created_at bigint not null)`,
  );
  await db.execute(
    sql`create table if not exists public.activity (id text primary key, issue_id text not null, kind text not null, summary text not null, created_at bigint not null)`,
  );
  await migrateDatabase(db, {
    migrationsFolder: migrations.migrationsFolder,
    baseline: firstMigration,
  });
}
