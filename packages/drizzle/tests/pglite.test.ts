import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { afterEach, expect, test } from "vite-plus/test";
import { createScope, isError, namespace, operation } from "@tinker/core";
import { config, database, transaction } from "@tinker/drizzle/pglite";

const saved = pgTable("saved", { value: text("value").notNull() });
const failure = new Error("request failed");
const insert = operation({
  label: "insert",
  depends: { tx: transaction },
  run: ({ tx }) => tx.insert(saved).values({ value: "kept" }),
});
const insertThenFail = operation({
  label: "insertThenFail",
  depends: { tx: transaction },
  run: async ({ tx }) => {
    await tx.insert(saved).values({ value: "lost" });
    throw failure;
  },
});
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("missing PGlite config raises MissingTag with the config label", async () => {
  const scope = createScope();
  try {
    await scope.resolve(database);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload.label).toBe("pglite.config");
  } finally {
    await scope.close();
  }
});

test("an owned database opens its configured path lazily and closes with the scope", async () => {
  const path = await mkdtemp(join(tmpdir(), "pglite-owned-"));
  folders.push(path);
  const scope = createScope({ tags: [config({ kind: "open", url: join(path, "db") })] });
  expect(await readdir(path)).toEqual([]);
  const db = await scope.resolve(database);
  await db.execute(sql`create table saved (value text)`);
  expect(await readdir(path)).toEqual(["db"]);
  await scope.close();
  expect(db.$client.closed).toBe(true);
});

test("stopping a lazy database build leaves its configured path unopened", async () => {
  const path = await mkdtemp(join(tmpdir(), "pglite-stopped-"));
  folders.push(path);
  const scope = createScope({ tags: [config({ kind: "open", url: join(path, "db") })] });
  const building = scope.resolve(database);
  const closing = scope.close();
  await expect(building).rejects.toBeDefined();
  await closing;
  expect(await readdir(path)).toEqual([]);
});

test("two roots open separate clients and closing one leaves the other usable", async () => {
  const first = createScope({ tags: [config({ kind: "open" })] });
  const second = createScope({ tags: [config({ kind: "open" })] });
  const firstDb = await first.resolve(database);
  const secondDb = await second.resolve(database);
  expect(secondDb).not.toBe(firstDb);
  await first.close();
  expect((await secondDb.execute(sql`select 42 as value`)).rows).toEqual([{ value: 42 }]);
  await second.close();
});

test("tenant databases stay separate and request config cannot replace the tenant client", async () => {
  const a = namespace({ tags: [config({ kind: "open" })] });
  const b = namespace({ tags: [config({ kind: "open" })] });
  const scope = createScope();
  const first = await scope.resolve(database, { ns: a });
  const second = await scope.resolve(database, { ns: b });
  await first.execute(sql`create table saved (value text)`);
  await second.execute(sql`create table saved (value text)`);
  await scope.session({ ns: a, tags: [config({ kind: "open" })] }, (session) =>
    session.run(insert),
  );
  await scope.session({ ns: a }, (session) => session.run(insert));
  expect(await first.select().from(saved)).toEqual([{ value: "kept" }, { value: "kept" }]);
  expect(await second.select().from(saved)).toEqual([]);
  await scope.close();
});

test("a borrowed database keeps the exact client open after scope close", async () => {
  const client = new PGlite();
  const scope = createScope({ tags: [config({ kind: "borrow", client })] });
  expect((await scope.resolve(database)).$client).toBe(client);
  await scope.close();
  expect((await client.query("select 42 as value")).rows).toEqual([{ value: 42 }]);
  await client.close();
});

test("a failed session rolls back while the prior session commit stays visible", async () => {
  const scope = createScope({ tags: [config({ kind: "open" })] });
  const db = await scope.resolve(database);
  await db.execute(sql`create table saved (value text)`);
  await scope.session((session) => session.run(insert));
  await expect(scope.session((session) => session.run(insertThenFail))).rejects.toBe(failure);
  expect(await db.select().from(saved)).toEqual([{ value: "kept" }]);
  await scope.close();
});

test("each session reuses one native transaction and the next session gets another", async () => {
  const scope = createScope({ tags: [config({ kind: "open" })] });
  let previous: unknown;
  await scope.session(async (session) => {
    const tx = await session.resolve(transaction);
    previous = tx;
    expect(await session.resolve(transaction)).toBe(tx);
    await tx.transaction(async (savepoint) => {
      expect((await savepoint.execute(sql`select 42 as value`)).rows).toEqual([{ value: 42 }]);
    });
  });
  await scope.session(async (session) => {
    expect(await session.resolve(transaction)).not.toBe(previous);
  });
  await scope.close();
});
