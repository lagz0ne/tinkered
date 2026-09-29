import { extension, type Resource, type Scope } from "@tinker/core";
import type { Migrations } from "@tinker/drizzle/migrations";

/** Postgres advisory lock key shared by every migrate step on the same database.
 * Reserved for these migrations; other app locks and pg-boss must use another key. */
const migrationLock = { classId: 1937006964, objectId: 1 };

export declare namespace Migrate {
  export type Options = {
    migrationsFolder: string;
    /** Bring old app tables level and record their baseline, using this transaction only. */
    baseline?: (db: Migrations.Database) => Promise<void>;
  };
}

/** List before the server. The transaction pins one connection and releases its
 * advisory lock on commit or rollback. PGlite serializes these transactions too.
 * A later owner such as pg-boss can start after this commit, under its own lock. */
export function migrate(
  database: Resource.Handle<Promise<Migrations.Database>>,
  options: Migrate.Options,
): Scope.Extension<void> {
  return extension({
    label: "stack.migrate",
    start: async (scope, _ctx, next) => {
      const { sql } = await import("drizzle-orm");
      const { migrateDatabase } = await import("@tinker/drizzle/migrations");
      const db = await scope.resolve(database);
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${migrationLock.classId}, ${migrationLock.objectId})`,
        );
        await options.baseline?.(tx);
        await migrateDatabase(tx, { migrationsFolder: options.migrationsFolder });
      });
      await next();
    },
  });
}
