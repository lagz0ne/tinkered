import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, expect, test } from "vite-plus/test";
import { isError } from "../../src/drizzle/index.ts";
import { checkDrift, migrateDatabase } from "../../src/drizzle/migrations.ts";

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

async function createDriftFixture() {
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
    'import { pgTable, text } from "drizzle-orm/pg-core"; export const saved = pgTable("saved", { id: text("id"), assignee: text("assignee") });',
  );
  const kit = join(dirname(createRequire(import.meta.url).resolve("drizzle-kit")), "bin.cjs");
  await promisify(execFile)(process.execPath, [kit, "generate", "--config", config], { cwd: dir });
  return { dir, config, schema };
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
  await addFolder(migrationsFolder, first, "create table saved (value text);");
  try {
    await migrateDatabase(db, { migrationsFolder, baseline: "missing" });
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MigrationNotFound")) throw error;
    expect(error.payload.name).toBe("missing");
  }
});

test("an empty migrations folder needs no baseline", async () => {
  const { client, db, migrationsFolder } = await fixture();
  await migrateDatabase(db, { migrationsFolder });
  expect((await client.query("select name from drizzle.__drizzle_migrations")).rows).toEqual([]);
});

test("the drift check accepts matching files and rejects an unsaved schema change", async () => {
  const { dir, config, schema } = await createDriftFixture();
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

test("a renamed column raises SchemaDrift with missing_hints", async () => {
  const { config, schema } = await createDriftFixture();
  await writeFile(
    schema,
    (await readFile(schema, "utf8")).replace(
      'assignee: text("assignee")',
      'assignee: text("owner")',
    ),
  );
  try {
    await checkDrift(config);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "SchemaDrift")) throw error;
    expect(error.payload.result).toMatchObject({ status: "missing_hints" });
  }
});

test("a Kit failure with text output keeps the command error", async () => {
  const { config } = await createDriftFixture();
  await writeFile(config, 'process.stdout.write("config failed\\n"); process.exit(7);');
  await expect(checkDrift(config)).rejects.toMatchObject({
    code: 7,
    stdout: "config failed\n",
    stderr: "",
  });
});

test("a config path with a NUL keeps Node's argument error", async () => {
  const { config } = await createDriftFixture();
  await expect(checkDrift(`${config}\0`)).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
});

/** Kit loads app config as code; an early exit can leave only the app's stdout. */
test.each([null, {}, false])(
  "Kit output without a status raises SchemaDrift (%j)",
  async (result) => {
    const { config } = await createDriftFixture();
    await writeFile(
      config,
      `process.stdout.write(${JSON.stringify(JSON.stringify(result))}); process.exit(0);`,
    );
    try {
      await checkDrift(config);
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "SchemaDrift")) throw error;
      expect(error.payload).toEqual({ config, result });
    }
  },
);
