import { operation, resource, tag } from "@tinker/core";
import type { PGlite } from "@electric-sql/pglite";
import { createQueryLogger, openTransaction, type Transaction } from "./index.ts";

export declare namespace Database {
  export type Config = { kind: "open"; url?: string } | { kind: "borrow"; client: PGlite };
  export type Handle = Awaited<ReturnType<typeof database.factory>>;
}

export declare namespace Migrate {
  export type Config = {
    migrationsFolder: string;
    /** Upgrade old tables and record their baseline using this transaction only. */
    baseline?: (tx: Transaction.Handle<Database.Handle>) => Promise<void>;
  };
}

export const config = tag<Database.Config>({ label: "pglite.config" });

/** Each root and namespace owns one lazy database. Borrowed clients keep their outside owner. */
export const database = resource({
  label: "pglite.database",
  target: "namespace",
  depends: { config },
  factory: async ({ config }, ctx) => {
    const { drizzle } = await import("drizzle-orm/pglite");
    ctx.signal.throwIfAborted();
    if (config.kind === "borrow")
      return drizzle({ client: config.client, logger: createQueryLogger(ctx) });
    const { PGlite } = await import("@electric-sql/pglite");
    ctx.signal.throwIfAborted();
    const client = new PGlite(config.url);
    ctx.defer(() => client.close());
    return drizzle({ client, logger: createQueryLogger(ctx) });
  },
});

/** One native transaction per session; the session waits for its commit or rollback. */
export const transaction = resource({
  label: "pglite.transaction",
  target: "session",
  depends: { database },
  factory: ({ database }, ctx) => openTransaction(database, ctx),
});

export const migrationConfig = tag<Migrate.Config>({ label: "pglite.migrationConfig" });

/** Shares Stack's Postgres advisory lock so every migration path on this database agrees. */
const migrationLock = { classId: 1937006964, objectId: 1 };

/** Owns the entire migration transaction, even when called at the root. The answer follows
 * commit or rollback; cancellation checked before commit rolls back every stage together. */
export const migrate = operation({
  label: "pglite.migrate",
  depends: { database, config: migrationConfig },
  run: async ({ database, config }, ctx) => {
    ctx.signal.throwIfAborted();
    const { sql } = await import("drizzle-orm");
    ctx.signal.throwIfAborted();
    const { migrateDatabase } = await import("./migrations.ts");
    ctx.signal.throwIfAborted();
    await database.transaction(async (tx) => {
      ctx.signal.throwIfAborted();
      await tx.execute(
        sql`select pg_advisory_xact_lock(${migrationLock.classId}, ${migrationLock.objectId})`,
      );
      ctx.signal.throwIfAborted();
      await config.baseline?.(tx);
      ctx.signal.throwIfAborted();
      await migrateDatabase(tx, { migrationsFolder: config.migrationsFolder });
      ctx.signal.throwIfAborted();
    });
  },
});
