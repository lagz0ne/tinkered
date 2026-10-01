import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createScope, extension, resource } from "@tinker/core";
import { hono } from "@tinker/hono";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterEach, expect, test } from "vite-plus/test";
import { createTestDatabase, isError, jsonLines, migrate, server } from "../src/index.ts";
import { readFreePort } from "./fixtures.ts";

const clients: { close(): Promise<void> }[] = [];
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(statement: string) {
  const migrationsFolder = await mkdtemp(join(tmpdir(), "stack-migrate-"));
  folders.push(migrationsFolder);
  const folder = join(migrationsFolder, "20260929000000_first");
  await mkdir(folder);
  await writeFile(join(folder, "migration.sql"), statement);
  const client = new PGlite();
  clients.push(client);
  const db = drizzle({ client });
  const database = resource({ label: "test.db", factory: () => Promise.resolve(db) });
  return { client, database, migrationsFolder };
}

test("two starts on one database migrate once under a lock released before the next start", async () => {
  const { client, database, migrationsFolder } = await fixture(`
    create table runs as select count(*)::int as locks from pg_locks
      where locktype = 'advisory' and classid = 1937006964 and objid = 1 and granted;
  `);
  const first = createScope({ extensions: [migrate(database, { migrationsFolder })] });
  const checked = Promise.withResolvers<unknown>();
  const after = extension({
    label: "after",
    hooks: {
      start: async (event) => {
        checked.resolve(
          (
            await client.query(
              "select count(*)::int as locks from pg_locks where locktype = 'advisory'",
            )
          ).rows,
        );
        await event.next();
      },
    },
  });
  const second = createScope({ extensions: [migrate(database, { migrationsFolder }), after] });
  try {
    await Promise.all([first.ready, second.ready]);
    expect((await client.query("select * from runs")).rows).toEqual([{ locks: 1 }]);
    expect(await checked.promise).toEqual([{ locks: 0 }]);
  } finally {
    await first.close();
    await second.close();
  }
});

test("a failed migration stops the port opening and rolls back its tables and history", async () => {
  const { client, database, migrationsFolder } = await fixture(
    "create table partial (id text);\n--> statement-breakpoint\ninsert into absent values (1);",
  );
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const web = hono([]).extension;
  const lines: string[] = [];
  const scope = createScope({
    observe: jsonLines((line) => lines.push(line)),
    extensions: [
      server(web, { env, clientDir: "/missing" }),
      migrate(database, { migrationsFolder }),
      web,
    ],
  });
  try {
    await expect(scope.ready).rejects.toThrow();
    await expect(fetch(`http://${env.HOST}:${env.PORT}/`)).rejects.toThrow();
    expect(lines).toEqual([]);
    expect(
      (
        await client.query(
          "select to_regclass('partial') as table, to_regclass('drizzle.__drizzle_migrations') as history",
        )
      ).rows,
    ).toEqual([{ table: null, history: null }]);
    expect(
      (
        await client.query(
          "select count(*)::int as locks from pg_locks where locktype = 'advisory'",
        )
      ).rows,
    ).toEqual([{ locks: 0 }]);
  } finally {
    await scope.close();
  }
});

test("a bad PORT fails boot naming PORT and runs no migration", async () => {
  const { client, database, migrationsFolder } = await fixture("create table saved (id text);");
  const web = hono([]).extension;
  const scope = createScope({
    extensions: [
      server(web, { env: { HOST: "127.0.0.1", PORT: "abc" }, clientDir: "/missing" }),
      migrate(database, { migrationsFolder }),
      web,
    ],
  });
  try {
    await scope.ready;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "BadListenSettings")) throw error;
    expect(error.payload.keys).toEqual(["PORT"]);
    expect(
      (
        await client.query(
          "select to_regclass('saved') as table, to_regclass('drizzle.__drizzle_migrations') as history",
        )
      ).rows,
    ).toEqual([{ table: null, history: null }]);
  } finally {
    await scope.close();
  }
});

test("the test helper migrates once and gives each clone its own rows", async () => {
  const { migrationsFolder } = await fixture("insert into saved values ('seed');");
  const template = await createTestDatabase({
    migrationsFolder,
    baseline: async (db) => {
      await db.execute(sql`create table saved (value text)`);
    },
  });
  clients.push(template);
  const first = await template.clone();
  clients.push(first);
  await first.exec("insert into saved values ('first test');");
  const second = await template.clone();
  clients.push(second);
  expect((await second.query("select * from saved")).rows).toEqual([{ value: "seed" }]);
  expect((await first.query("select * from saved order by value")).rows).toEqual([
    { value: "first test" },
    { value: "seed" },
  ]);
});

test("the test helper rejects a migration failure", async () => {
  const { migrationsFolder } = await fixture("insert into absent values (1);");
  await expect(createTestDatabase({ migrationsFolder })).rejects.toThrow();
});
