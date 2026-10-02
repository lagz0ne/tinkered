import { PGlite } from "@electric-sql/pglite";
import { createScope, extension } from "@tinker/core";
import { migrate } from "../../src/stack/index.ts";
import { expect, test } from "vite-plus/test";
import { jobs } from "../../src/jobs/index.ts";
import { database, databaseConfig, migrationsFolder, transaction } from "./fixtures.ts";

test("jobs migrate after Drizzle commits and release their own lock", async () => {
  const client = new PGlite();
  const piece = jobs([], { pglite: database, tx: transaction, env: {} });
  let tables: unknown;
  const between = extension({
    label: "between",
    hooks: {
      async start(event) {
        tables = (
          await client.query(
            "select to_regclass('receipts')::text as app, to_regclass('pgboss.version')::text as jobs",
          )
        ).rows;
        await event.next();
      },
    },
  });
  const scope = createScope({
    tags: [databaseConfig({ client })],
    extensions: [migrate(database, { migrationsFolder }), between, piece.extension],
  });
  try {
    await scope.ready;
    expect(tables).toEqual([{ app: "receipts", jobs: null }]);
    expect((await client.query("select count(*)::int as count from pgboss.version")).rows).toEqual([
      { count: 1 },
    ]);
    expect(
      (
        await client.query(
          "select count(*)::int as locks from pg_locks where locktype = 'advisory'",
        )
      ).rows,
    ).toEqual([{ locks: 0 }]);
  } finally {
    await scope.close();
    await client.close();
  }
});
