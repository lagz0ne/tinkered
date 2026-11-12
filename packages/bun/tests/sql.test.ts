import { createScope } from "@tinkered/core";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { bunSql } from "@/sql";

// Postgres on Bun.SQL as a Drizzle driver: a pool of `max`, migrate from a folder, the pool
// closed with the scope. The live part needs a server: `PG_URL` names one; without it, skipped.

const PG_URL = process.env.PG_URL;
const migrations = new URL("fixtures/migrations/pg", import.meta.url).pathname;

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

/** A fresh database on the server, dropped after the test. */
async function fresh() {
  const name = `t_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = await createScope({ capsules: [bunSql({ url: new URL(PG_URL!) })] }).ready;
  closers.push(() => admin.close());
  const root = await admin.resolve(bunSql.connection);
  await root.db.execute(sql.raw(`CREATE DATABASE ${name}`));
  closers.push(() => root.db.execute(sql.raw(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)));

  const url = new URL(PG_URL!);
  url.pathname = `/${name}`;
  return url;
}

describe.skipIf(!PG_URL)("on a live server", () => {
  test("migrate runs the folder once; a typed query follows", async () => {
    const url = await fresh();
    const scope = await createScope({ capsules: [bunSql({ url, max: 2 })] }).ready;
    closers.push(() => scope.close());
    const conn = await scope.resolve(bunSql.connection);

    await conn.migrate(migrations);
    await conn.migrate(migrations);
    await conn.db.execute(sql`INSERT INTO notes (title) VALUES ('a')`);

    const rows = await conn.db.execute(sql`SELECT title, votes FROM notes`);
    expect([...rows]).toEqual([{ title: "a", votes: 0 }]);
  });

  /** How many server processes a pool used for `n` queries at once. */
  const used = async (max: number | undefined, n: number) => {
    const url = await fresh();
    const scope = await createScope({ capsules: [bunSql(max ? { url, max } : { url })] }).ready;
    closers.push(() => scope.close());
    const conn = await scope.resolve(bunSql.connection);

    const rows = await Promise.all(
      Array.from({ length: n }, () =>
        conn.db.execute(sql`SELECT pg_backend_pid() AS pid, pg_sleep(0.3)`),
      ),
    );
    return new Set(rows.map((r) => [...r][0]!.pid)).size;
  };

  test("the pool holds at most max connections, 10 by default", async () => {
    expect(await used(2, 6)).toBe(2);
    expect(await used(undefined, 20)).toBe(10);
  });

  test("the pool closes with the scope", async () => {
    const url = await fresh();
    const scope = await createScope({ capsules: [bunSql({ url })] }).ready;
    const conn = await scope.resolve(bunSql.connection);
    await conn.db.execute(sql`SELECT 1`);
    await scope.close();

    await expect(conn.db.execute(sql`SELECT 1`)).rejects.toThrow();
  });
});

/** The error a start throws at once (a config error), or null. */
const startError = (values: unknown) => {
  try {
    createScope({ capsules: [bunSql(values as never)] });
    return null;
  } catch (error) {
    const { kind, payload } = Object(error);
    return { kind, label: payload?.label, key: payload?.key, cause: String(payload?.cause) };
  }
};

test("the url must be a URL and max a whole number above 0", () => {
  expect(startError({ url: "postgres://x" })).toEqual({
    kind: "DataValidationFailed",
    label: "bunSql.url",
    key: undefined,
    cause: "TypeError: not a URL",
  });
  for (const max of [0, 1.5]) {
    expect(startError({ url: new URL("postgres://x"), max })).toMatchObject({
      label: "bunSql.max",
      cause: "TypeError: not a whole number above 0",
    });
  }
  expect(startError({})).toMatchObject({ kind: "MissingConfig", label: "bunSql", key: "url" });
  expect(bunSql.label).toBe("bunSql");
  expect(bunSql.connection.label).toBe("bunSql.connection");
});
