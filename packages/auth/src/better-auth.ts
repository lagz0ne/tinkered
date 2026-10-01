import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";

/** Shared by the lazy resource and the CLI config: generated tables follow the
 * shipped options. The database is borrowed; auth never closes it. */
export function createAuth(
  db: object,
  settings: { secret: string; baseURL: string },
  schema: Record<string, unknown>,
) {
  return betterAuth({
    ...settings,
    basePath: "/api/auth",
    database: drizzleAdapter(db, { provider: "pg", schemaName: "auth", schema, transaction: true }),
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
  });
}
