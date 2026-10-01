import { fileURLToPath } from "node:url";
import { extension } from "@tinker/core";
import { migrateDatabase, type Migrations } from "@tinker/drizzle/migrations";
import { migrate, migrationConfig, type Migrate } from "@tinker/drizzle/pglite";
import { sql } from "drizzle-orm";

const firstMigration = "20260929165528_tracker";

/** Keep this folder relative to the app, not the process's working directory. */
export const migrations = {
  migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  baseline: baselineIssues,
} satisfies Migrate.Config;

/** Finish the migration commit before later startup hooks can use the store. */
export const migrateIssues = extension({
  label: "issues.migrate",
  hooks: {
    start: async (event) => {
      await event.scope.run(migrate, { tags: [migrationConfig(migrations)] });
      await event.next();
    },
  },
});

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
