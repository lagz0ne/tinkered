import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { afterEach, expect, test } from "vite-plus/test";
import { createScope, isError, namespace, operation, type Observe } from "@tinker/core";
import { config, database, migrate, migrationConfig } from "../../src/drizzle/pglite.ts";
import { migrateDatabase } from "../../src/drizzle/migrations.ts";

const clients: PGlite[] = [];
const folders: string[] = [];
const first = "20260929000000_first";
const second = "20260929000001_second";
const failure = new Error("baseline failed");
const boot = operation({
  label: "boot",
  depends: { migrate },
  run: ({ migrate }) => migrate.run(),
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const migrationsFolder = await mkdtemp(join(tmpdir(), "pglite-migrations-"));
  folders.push(migrationsFolder);
  const client = new PGlite();
  clients.push(client);
  return { client, migrationsFolder };
}

async function addFolder(root: string, name: string, query: string) {
  await mkdir(join(root, name));
  await writeFile(join(root, name, "migration.sql"), query);
}

function createGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

test("missing migration settings raise MissingTag with the migration config label", async () => {
  const { client } = await fixture();
  const scope = createScope({ tags: [config({ kind: "borrow", client })] });
  try {
    await scope.run(migrate);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload.label).toBe("pglite.migrationConfig");
  } finally {
    await scope.close();
  }
});

test("root migrations commit before answering and produce a child span under the caller", async () => {
  const { client, migrationsFolder } = await fixture();
  await addFolder(migrationsFolder, first, "create table saved (value text);");
  const spans: Observe.Span[] = [];
  const scope = createScope({
    tags: [config({ kind: "borrow", client }), migrationConfig({ migrationsFolder })],
    observe: { export: (span) => spans.push(span) },
  });
  await scope.run(boot);
  expect((await client.query("select * from saved")).rows).toEqual([]);
  const caller = spans.find((span) => span.name === "boot");
  const migration = spans.find((span) => span.name === "pglite.migrate");
  expect(caller).toBeDefined();
  expect(migration).toMatchObject({ parentId: caller?.id, status: "ok" });
  expect(spans.find((span) => span.name === "pglite.database")).toMatchObject({
    parentId: migration?.id,
  });
  await scope.close();
});

test("baseline and pending files share the migration lock and commit together in the selected tenant", async () => {
  const { client, migrationsFolder } = await fixture();
  await client.exec("create table saved (value text); insert into saved values ('old');");
  await addFolder(migrationsFolder, first, "create table saved (value text);");
  await addFolder(migrationsFolder, second, "insert into saved values ('new');");
  const tenant = namespace({ tags: [config({ kind: "borrow", client })] });
  const other = namespace({ tags: [config({ kind: "open" })] });
  const scope = createScope();
  await scope.run(migrate, {
    ns: tenant,
    tags: [
      migrationConfig({
        migrationsFolder,
        baseline: async (tx) => {
          const locks = await tx.execute(
            sql`select classid, objid from pg_locks where locktype = 'advisory' and granted`,
          );
          expect(locks.rows).toEqual([{ classid: 1937006964, objid: 1 }]);
          await migrateDatabase(tx, { migrationsFolder, baseline: first });
        },
      }),
    ],
  });
  expect((await client.query("select value from saved order by value")).rows).toEqual([
    { value: "new" },
    { value: "old" },
  ]);
  const otherDb = await scope.resolve(database, { ns: other });
  expect((await otherDb.execute(sql`select to_regclass('saved') as table`)).rows).toEqual([
    { table: null },
  ]);
  await scope.close();
});

test("a failed migration rolls back the baseline and every pending file before answering", async () => {
  const { client, migrationsFolder } = await fixture();
  await addFolder(migrationsFolder, first, "create table pending (value text);");
  await addFolder(migrationsFolder, second, "insert into missing_table values (1);");
  const scope = createScope({
    tags: [
      config({ kind: "borrow", client }),
      migrationConfig({
        migrationsFolder,
        baseline: async (tx) => {
          await tx.execute(sql`create table baseline (value text)`);
        },
      }),
    ],
  });
  await expect(scope.run(migrate)).rejects.toThrow();
  expect(
    (
      await client.query(
        "select to_regclass('baseline') as baseline, to_regclass('pending') as pending",
      )
    ).rows,
  ).toEqual([{ baseline: null, pending: null }]);
  await scope.close();
});

test("a failed migration commit rejects the action and rolls back its schema and data", async () => {
  const { client, migrationsFolder } = await fixture();
  await addFolder(
    migrationsFolder,
    first,
    "create table pending (value text unique deferrable initially deferred);\n--> statement-breakpoint\ninsert into pending values ('same'), ('same');",
  );
  const scope = createScope({
    tags: [config({ kind: "borrow", client }), migrationConfig({ migrationsFolder })],
  });
  await expect(scope.run(migrate)).rejects.toMatchObject({ code: "23505" });
  expect((await client.query("select to_regclass('pending') as table")).rows).toEqual([
    { table: null },
  ]);
  await scope.close();
});

test("a failed baseline rolls back and never starts pending migration files", async () => {
  const { client, migrationsFolder } = await fixture();
  await addFolder(migrationsFolder, first, "create table pending (value text);");
  const scope = createScope({
    tags: [
      config({ kind: "borrow", client }),
      migrationConfig({
        migrationsFolder,
        baseline: async (tx) => {
          await tx.execute(sql`create table baseline (value text)`);
          throw failure;
        },
      }),
    ],
  });
  await expect(scope.run(migrate)).rejects.toBe(failure);
  expect(
    (
      await client.query(
        "select to_regclass('baseline') as baseline, to_regclass('pending') as pending",
      )
    ).rows,
  ).toEqual([{ baseline: null, pending: null }]);
  await scope.close();
});

test("stopping during baseline waits for rollback and leaves pending files untouched", async () => {
  const { client, migrationsFolder } = await fixture();
  await addFolder(migrationsFolder, first, "create table pending (value text);");
  const entered = createGate();
  const resume = createGate();
  const stop = new AbortController();
  const scope = createScope({ tags: [config({ kind: "borrow", client })] });
  const running = scope.settle(migrate, {
    signal: stop.signal,
    tags: [
      migrationConfig({
        migrationsFolder,
        baseline: async (tx) => {
          await tx.execute(sql`create table baseline (value text)`);
          entered.resolve();
          await resume.promise;
        },
      }),
    ],
  });
  await entered.promise;
  stop.abort();
  resume.resolve();
  expect((await running).status).toBe("cancelled");
  expect(
    (
      await client.query(
        "select to_regclass('baseline') as baseline, to_regclass('pending') as pending",
      )
    ).rows,
  ).toEqual([{ baseline: null, pending: null }]);
  await scope.close();
});

test("stopping after the last migration statement rolls back before commit", async () => {
  const { client, migrationsFolder } = await fixture();
  await addFolder(migrationsFolder, first, "create table pending (value text);");
  const scope = createScope({
    tags: [config({ kind: "borrow", client }), migrationConfig({ migrationsFolder })],
    observe: {
      log: (entry) => {
        if (entry.attributes.sql === "create table pending (value text);") stop.abort();
      },
    },
  });
  const stop = new AbortController();
  const result = await scope.settle(migrate, { signal: stop.signal });
  expect(result.status).toBe("cancelled");
  expect((await client.query("select to_regclass('pending') as table")).rows).toEqual([
    { table: null },
  ]);
  await scope.close();
});
