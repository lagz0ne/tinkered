import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createScope } from "@tinker/core";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, expect, test } from "vite-plus/test";

import { bunSqlite } from "@/sqlite";

// bun:sqlite as a Drizzle driver: one file in WAL mode, foreign keys on, migrate from a folder,
// BEGIN and COMMIT on the one connection, and the file closed with the scope.

const folder = mkdtempSync(join(tmpdir(), "bun-sqlite-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const migrations = new URL("fixtures/migrations/sqlite", import.meta.url).pathname;

/** A scope on one database file; `conn` is its connection. */
async function open(file = join(folder, `${crypto.randomUUID()}.db`)) {
  const scope = await createScope({ capsules: [bunSqlite({ file })] }).ready;
  closers.push(() => scope.close());

  const conn = await scope.resolve(bunSqlite.connection);
  return { scope, conn, file };
}

const titles = (rows: Array<{ title: string }>) => rows.map((r) => r.title);

test("a file opens in WAL mode with foreign keys on", async () => {
  const { conn } = await open();

  expect(await conn.db.get(sql`PRAGMA journal_mode`)).toEqual({ journal_mode: "wal" });
  expect(await conn.db.get(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 1 });
});

test("migrate runs the folder's migrations once", async () => {
  const { conn } = await open();

  await conn.migrate(migrations);
  await conn.migrate(migrations);
  await conn.db.run(sql`INSERT INTO notes (title) VALUES ('a')`);

  expect(await conn.db.all(sql`SELECT title, votes FROM notes`)).toEqual([
    { title: "a", votes: 0 },
  ]);
});

test("begin and end: a commit keeps the writes, a rollback drops them", async () => {
  const { conn } = await open();
  await conn.migrate(migrations);

  const kept = await conn.begin();
  await kept.tx.run(sql`INSERT INTO notes (title) VALUES ('kept')`);
  await kept.end(true);
  const dropped = await conn.begin();
  await dropped.tx.run(sql`INSERT INTO notes (title) VALUES ('dropped')`);
  await dropped.end(false);

  expect(titles(await conn.db.all(sql`SELECT title FROM notes`))).toEqual(["kept"]);
});

test("begin takes the write lock at once: a second writer is busy", async () => {
  const one = await open();
  await one.conn.migrate(migrations);
  const two = await open(one.file);

  const held = await one.conn.begin();
  await expect(two.conn.begin()).rejects.toThrow(/locked|busy/i);
  await held.end(true);
});

test("the file closes with the scope", async () => {
  const { scope, conn } = await open();
  await scope.close();

  expect(() => conn.db.run(sql`SELECT 1`)).toThrow();
});

test("the default file is in memory", async () => {
  const scope = await createScope({ capsules: [bunSqlite({})] }).ready;
  closers.push(() => scope.close());
  const conn = await scope.resolve(bunSqlite.connection);

  expect(await conn.db.get(sql`PRAGMA journal_mode`)).toEqual({ journal_mode: "memory" });
});

test("a file that is not a non-empty name stops the start", () => {
  for (const file of ["", 7]) {
    let error: unknown = null;
    try {
      createScope({ capsules: [bunSqlite({ file } as never)] });
    } catch (thrown) {
      error = thrown;
    }
    const { kind, payload } = Object(error);
    expect([kind, payload?.label, String(payload?.cause)]).toEqual([
      "DataValidationFailed",
      "bunSqlite.file",
      "TypeError: not a file name",
    ]);
  }
  expect(bunSqlite.label).toBe("bunSqlite");
  expect(bunSqlite.connection.label).toBe("bunSqlite.connection");
});
