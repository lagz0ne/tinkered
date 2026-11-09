import { capsule, resource, tag } from "@tinker/core";
import { SQL } from "bun";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { drizzle } from "drizzle-orm/bun-sql/postgres";

// Postgres through Bun's own client, `Bun.SQL`, with a pool: no npm driver. The connection is
// what a Drizzle facade takes (`drizzlePg({ driver: bunSql.connection })`): its db and its
// migrator. Drizzle's own `drizzle-orm/bun-sql` does the SQL; this capsule owns the pool's life.

/** A whole number above 0. */
const positive = (raw: unknown): number => {
  if (!Number.isSafeInteger(raw) || Number(raw) <= 0) {
    throw new TypeError("not a whole number above 0");
  }
  return Number(raw);
};

const url = tag<URL>({
  label: "bunSql.url",
  secret: true,
  parse: (raw) => {
    if (!(raw instanceof URL)) throw new TypeError("not a URL");
    return raw;
  },
});

const max = tag<number>({ label: "bunSql.max", default: 10, parse: positive });

/** The pool, its Drizzle db and its migrator; the pool closes with the scope. */
const connection = resource({
  label: "bunSql.connection",
  depends: { url, max },
  factory: async ({ url, max }, { defer }) => {
    const client = new SQL({ url: url.href, max });
    defer(() => client.close());
    const db = drizzle({ client });

    return {
      db,
      migrate: async (folder: string) => void (await migrate(db, { migrationsFolder: folder })),
    };
  },
});

/** Postgres on `Bun.SQL`. */
export const bunSql = capsule({
  label: "bunSql",
  config: { url: url.required, max },
  exports: { connection },
});
