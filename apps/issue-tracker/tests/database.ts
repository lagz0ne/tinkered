import { afterAll, afterEach, beforeAll } from "vite-plus/test";
import { createTestDatabase, type TestDatabase } from "@tinker/stack";
import type { PGlite } from "@electric-sql/pglite";
import { migrations } from "../src/index.ts";

let template: TestDatabase.Handle;
const clients: PGlite[] = [];

beforeAll(async () => {
  template = await createTestDatabase(migrations);
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});
afterAll(async () => {
  await template.close();
});

export async function cloneDatabase() {
  const client = await template.clone();
  clients.push(client);
  return { client };
}
