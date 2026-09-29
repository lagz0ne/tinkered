import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, expect, test } from "vite-plus/test";
import { isError } from "../src/index.ts";
import { checkDrift, migrateDatabase } from "@tinker/drizzle/migrations";

const clients: PGlite[] = [];
const folders: string[] = [];
const first = "20260929000000_first";
const second = "20260929000001_second";

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const migrationsFolder = await mkdtemp(join(tmpdir(), "drizzle-migrations-"));
  folders.push(migrationsFolder);
  const client = new PGlite();
  clients.push(client);
  return { client, db: drizzle({ client }), migrationsFolder };
}

async function addFolder(root: string, name: string, sql: string) {
  await mkdir(join(root, name));
  await writeFile(join(root, name, "migration.sql"), sql);
}

test("migration folders run once and a later folder runs on the next boot", async () => {
  const { client, db, migrationsFolder } = await fixture();
  await addFolder(migrationsFolder, first, "create table saved (value text);");
  await migrateDatabase(db, { migrationsFolder });
  await addFolder(migrationsFolder, second, "insert into saved values ('kept');");
  await migrateDatabase(db, { migrationsFolder });
  await migrateDatabase(db, { migrationsFolder });
  expect((await client.query("select * from saved")).rows).toEqual([{ value: "kept" }]);
});

test("a failed batch leaves none of its pending migrations applied", async () => {
  const { client, db, migrationsFolder } = await fixture();
  await addFolder(migrationsFolder, first, "create table partial (id text);");
  await addFolder(migrationsFolder, second, "insert into missing_table values (1);");
  await expect(migrateDatabase(db, { migrationsFolder })).rejects.toThrow();
  expect((await client.query("select to_regclass('partial') as table")).rows).toEqual([
    { table: null },
  ]);
  expect((await client.query("select name from drizzle.__drizzle_migrations")).rows).toEqual([]);
});

test("a named baseline is recorded without running its SQL or skipping later folders", async () => {
  const { client, db, migrationsFolder } = await fixture();
  await client.exec("create table saved (value text); insert into saved values ('old');");
  await addFolder(migrationsFolder, first, "create table saved (value text);");
  await addFolder(migrationsFolder, second, "insert into saved values ('new');");
  await migrateDatabase(db, { migrationsFolder, baseline: first });
  await migrateDatabase(db, { migrationsFolder, baseline: first });
  await migrateDatabase(db, { migrationsFolder });
  expect((await client.query("select value from saved order by value")).rows).toEqual([
    { value: "new" },
    { value: "old" },
  ]);
});

test("a missing baseline names the absent migration folder", async () => {
  const { db, migrationsFolder } = await fixture();
  try {
    await migrateDatabase(db, { migrationsFolder, baseline: "missing" });
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MigrationNotFound")) throw error;
    expect(error.payload.name).toBe("missing");
  }
});

test("the drift check accepts matching files and rejects an unsaved schema change", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drizzle-drift-"));
  folders.push(dir);
  await symlink(join(process.cwd(), "node_modules"), join(dir, "node_modules"));
  const config = join(dir, "drizzle.config.ts");
  const schema = join(dir, "schema.ts");
  await writeFile(
    config,
    'export default { dialect: "postgresql", schema: "./schema.ts", out: "./drizzle" };',
  );
  await writeFile(
    schema,
    'import { pgTable, text } from "drizzle-orm/pg-core"; export const saved = pgTable("saved", { id: text("id") });',
  );
  const kit = join(dirname(createRequire(import.meta.url).resolve("drizzle-kit")), "bin.cjs");
  await promisify(execFile)(process.execPath, [kit, "generate", "--config", config], { cwd: dir });
  await checkDrift(config);
  const foldersBefore = await readdir(join(dir, "drizzle"));
  await writeFile(
    schema,
    (await readFile(schema, "utf8")).replace(
      'id: text("id")',
      'id: text("id"), title: text("title")',
    ),
  );
  try {
    await checkDrift(config);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "SchemaDrift")) throw error;
    expect(error.payload.config).toBe(config);
    expect(await readdir(join(dir, "drizzle"))).toEqual(foldersBefore);
  }
});
