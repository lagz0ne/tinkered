import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createScope } from "@tinker/core";
import { isError } from "@tinker/drizzle";
import { checkDrift } from "@tinker/drizzle/migrations";
import { expect, test } from "vite-plus/test";
import { migrations, migrateIssues, storeConfig } from "../src/index.ts";
import { cloneDatabase } from "./database.ts";

const oldSteps = [
  "alter table issues add column if not exists status text not null default 'open'; update issues set status = 'done'",
  "alter table issues add column if not exists assignee text; update issues set assignee = 'Ada'",
  "alter table issues add column if not exists revision integer not null default 0; update issues set revision = 4",
  "alter table issues add column if not exists created_at bigint not null default 0; update issues set created_at = 12",
  "alter table issues add column if not exists updated_at bigint not null default 0; update issues set updated_at = 34",
  "create table if not exists comments (id text primary key, issue_id text not null, author text not null, text text not null, created_at bigint not null); insert into comments values ('comment', 'old', 'Ada', 'Kept comment', 56)",
  "create table if not exists activity (id text primary key, issue_id text not null, kind text not null, summary text not null, created_at bigint not null); insert into activity values ('activity', 'old', 'created', 'Kept activity', 78)",
];
const columns = `select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns where table_schema = 'public'
  order by table_name, column_name`;
const indexes =
  "select tablename, indexdef from pg_indexes where schemaname = 'public' order by tablename, indexname";

async function boot(client: PGlite) {
  const scope = createScope({ tags: [storeConfig({ client })], extensions: [migrateIssues] });
  await scope.ready;
  await scope.close();
}

test("a fresh tracker boots from migration files and its next boot applies nothing", async () => {
  const client = new PGlite();
  try {
    await boot(client);
    expect(
      (
        await client.query(
          "select tablename from pg_tables where schemaname = 'public' order by tablename",
        )
      ).rows,
    ).toEqual([{ tablename: "activity" }, { tablename: "comments" }, { tablename: "issues" }]);
    const before = await client.query("select * from drizzle.__drizzle_migrations");
    await boot(client);
    expect((await client.query("select * from drizzle.__drizzle_migrations")).rows).toEqual(
      before.rows,
    );
  } finally {
    await client.close();
  }
});

test.each([0, 1, 2, 3, 4, 5, 6, 7])(
  "an old tracker at hand-SQL step %i keeps every row and matches a fresh schema",
  async (step) => {
    const fresh = await cloneDatabase();
    const client = new PGlite();
    try {
      await client.exec(
        "create table issues (id text primary key, title text not null, description text not null); insert into issues values ('old', 'Keep me', 'Before migrations');",
      );
      for (const statement of oldSteps.slice(0, step)) await client.exec(statement);
      const [savedIssue] = (await client.query<Record<string, unknown>>("select * from issues"))
        .rows;
      const savedComments = step >= 6 ? (await client.query("select * from comments")).rows : [];
      const savedActivity = step >= 7 ? (await client.query("select * from activity")).rows : [];
      await boot(client);
      await boot(client);
      expect((await client.query("select * from issues")).rows).toEqual([
        {
          status: "open",
          assignee: null,
          revision: 0,
          created_at: 0,
          updated_at: 0,
          ...savedIssue,
        },
      ]);
      expect((await client.query("select * from comments")).rows).toEqual(savedComments);
      expect((await client.query("select * from activity")).rows).toEqual(savedActivity);
      expect((await client.query(columns)).rows).toEqual((await fresh.client.query(columns)).rows);
      expect((await client.query(indexes)).rows).toEqual((await fresh.client.query(indexes)).rows);
      expect((await client.query("select name from drizzle.__drizzle_migrations")).rows).toEqual([
        { name: "20260929165528_tracker" },
      ]);
    } finally {
      await client.close();
    }
  },
);

test("the tracker drift check passes and rejects a column added only in a temp schema copy", async () => {
  await checkDrift(join(process.cwd(), "drizzle.config.ts"));
  const dir = await mkdtemp(join(tmpdir(), "tracker-drift-"));
  try {
    await symlink(join(process.cwd(), "node_modules"), join(dir, "node_modules"));
    await cp(join(process.cwd(), "drizzle.config.ts"), join(dir, "drizzle.config.ts"));
    await cp(migrations.migrationsFolder, join(dir, "drizzle"), { recursive: true });
    await cp(join(process.cwd(), "src/server/schema.ts"), join(dir, "src/server/schema.ts"), {
      recursive: true,
    });
    const schema = join(dir, "src/server/schema.ts");
    await writeFile(
      schema,
      (await readFile(schema, "utf8")).replace(
        'title: text("title").notNull(),',
        'title: text("title").notNull(), extra: text("extra"),',
      ),
    );
    try {
      await checkDrift(join(dir, "drizzle.config.ts"));
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "SchemaDrift")) throw error;
      expect(error.payload.config).toBe(join(dir, "drizzle.config.ts"));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
