import { PGlite } from "@electric-sql/pglite";
import { drizzleStore } from "@tinker/drizzle";
import { type Scope } from "@tinker/core";
import { createTestDatabase } from "@tinker/stack";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll } from "vite-plus/test";
import { jobs, type Jobs } from "../src/index.ts";
import { createJobsClock } from "@tinker/jobs/testing";

export const store = drizzleStore({ open: (client: PGlite) => drizzle({ client }) });
export const scopes: Scope.Handle[] = [];
const clients: PGlite[] = [];
let template: PGlite;
export const migrationsFolder = new URL("./migrations", import.meta.url).pathname;

beforeAll(async () => {
  const migrated = await createTestDatabase({ migrationsFolder });
  template = await migrated.clone();
  await migrated.close();
});
afterEach(async () => {
  await Promise.all(scopes.splice(0).map((scope) => scope.close()));
  await Promise.all(
    clients
      .splice(0)
      .filter((client) => !client.closed)
      .map((client) => client.close()),
  );
});
afterAll(async () => {
  await template.close();
});

export async function fixture(rows: readonly Jobs.Row[]) {
  /** PGlite's clone declaration loses its concrete class. */
  const client = (await template.clone()) as PGlite;
  clients.push(client);
  const clock = await createJobsClock("2030-01-01T00:00:00Z");
  const piece = jobs(rows, { pglite: store.db, tx: store.tx, env: {} });
  return { client, clock, piece, tags: [store.config(client), clock.binding] };
}
