import type { Database as PGliteDatabase } from "@tinker/drizzle/pglite";

export { config as storeConfig, database as store, transaction } from "@tinker/drizzle/pglite";
export { issueRows, commentRows, activityRows } from "./schema.ts";

export declare namespace Store {
  export type Database = PGliteDatabase.Handle;
  export type Config = PGliteDatabase.Config;
}
