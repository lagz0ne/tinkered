import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/pg-core/async/session";
import { raise } from "./errors.ts";

export declare namespace Migrations {
  export type Database = Parameters<typeof migrate>[1];
  export type Options = {
    migrationsFolder: string;
    /** Record this folder after the caller has brought an old db to its schema. */
    baseline?: string;
  };
}

/** Borrows the db or transaction. The caller owns locking and any baseline upgrade.
 * Requires Drizzle 1.0; its migrator owns the journal and pending-file order. */
export async function migrateDatabase(
  db: Migrations.Database,
  options: Migrations.Options,
): Promise<void> {
  const files = readMigrationFiles(options);
  const selected =
    options.baseline !== undefined
      ? files.filter((file) => file.name === options.baseline).map((file) => ({ ...file, sql: [] }))
      : files;
  if (options.baseline !== undefined && selected.length === 0)
    raise("MigrationNotFound", { name: options.baseline });
  await migrate(selected, db, options);
}

/** Runs the app's pinned Kit in dry-run mode; no database or migration file is changed.
 * Paths in the config are relative to its folder, as when running Kit there. */
export async function checkDrift(config: string): Promise<void> {
  const path = resolve(config);
  const cwd = dirname(path);
  const kit = join(dirname(createRequire(path).resolve("drizzle-kit")), "bin.cjs");
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [kit, "generate", "--config", path, "--explain", "--output", "json"],
    { cwd },
  );
  const result: unknown = JSON.parse(stdout);
  if (
    typeof result !== "object" ||
    result === null ||
    !("status" in result) ||
    result.status !== "no_changes"
  )
    raise("SchemaDrift", { config: path, result });
}
