import type { PGlite } from "@electric-sql/pglite";
import { resource, tag, type Resource } from "@tinker/core";
import { createQueryLogger, openTransaction } from "@tinker/drizzle";

export { issueRows, commentRows, activityRows } from "./schema.ts";

export declare namespace Store {
  export type Database = Awaited<ReturnType<typeof openDatabase>>;
  /** A path transfers the opened client to the scope; a supplied client stays borrowed. */
  export type Config = string | undefined | { client: PGlite };
}

async function openDatabase({ config }: { config: Store.Config }, ctx: Resource.Ctx) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const borrowed = typeof config === "object";
  const client = borrowed ? config.client : new PGlite(config);
  if (!borrowed) ctx.defer(() => client.close());
  return drizzle({ client, logger: createQueryLogger(ctx) });
}

export const storeConfig = tag<Store.Config>({ label: "issues.config" });

/** Opening the store does no schema work. List migrateIssues before serving.
 * The caller closes a borrowed client after all scopes using it have closed. */
export const store = resource({
  label: "issues.db",
  target: "namespace",
  depends: { config: storeConfig },
  factory: openDatabase,
});

export const transaction = resource({
  label: "issues.tx",
  target: "session",
  depends: { db: store },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
