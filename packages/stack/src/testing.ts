import type { PGlite } from "@electric-sql/pglite";
import { createScope, resource } from "@tinker/core";
import { migrate, type Migrate } from "./migrate.ts";

export declare namespace TestDatabase {
  export type Handle = {
    clone(): Promise<PGlite>;
    close(): Promise<void>;
  };
}

/** Builds one template through the boot migrate step. Ownership transfers to the
 * caller: close the template after the file/run and each clone after its test. */
export async function createTestDatabase(options: Migrate.Options): Promise<TestDatabase.Handle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  const database = resource({
    label: "test.db",
    factory: () => Promise.resolve(drizzle({ client })),
  });
  const scope = createScope({ extensions: [migrate(database, options)] });
  try {
    await scope.ready;
    return {
      /** PGlite's clone returns a PGlite; its declaration loses the class type. */
      clone: async () => (await client.clone()) as PGlite,
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  } finally {
    await scope.close();
  }
}
