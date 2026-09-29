import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzleStore, type DrizzleStore } from "@tinker/drizzle";

export { issueRows, commentRows, activityRows } from "./schema.ts";

export declare namespace Store {
  /** The opened PGlite database behind the frame. */
  export type Database = ReturnType<typeof openDatabase>;
  /** A path transfers the opened client to the scope; a supplied client stays borrowed. */
  export type Config = string | undefined | { client: PGlite };
}

function openDatabase(config: Store.Config, logger: DrizzleStore.Logger) {
  const borrowed = typeof config === "object";
  const client = borrowed ? config.client : new PGlite(config);
  return Object.assign(drizzle({ client, logger }), { ownsClient: !borrowed });
}

/** Opening the store does no schema work. List migrateIssues before serving.
 * The caller closes a borrowed client after all scopes using it have closed. */
export const store = drizzleStore({
  label: "issues",
  open: (config: Store.Config, { logger }) => openDatabase(config, logger),
  close: (db) => (db.ownsClient ? db.$client.close() : undefined),
});
