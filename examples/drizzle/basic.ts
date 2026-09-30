import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { createScope, operation, type Scope } from "@tinker/core";
import { drizzleStore } from "@tinker/drizzle";
import { z } from "zod";

const users = pgTable("tour_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});
const store = drizzleStore({
  label: "tour",
  open: async (_config, { logger }) => {
    /** The store takes ownership only after this callback returns the database. */
    const client = new PGlite();
    try {
      const db = drizzle({ client, logger });
      await db.execute(sql`create table tour_users (id serial primary key, name text not null)`);
      return db;
    } catch (error) {
      await client.close();
      throw error;
    }
  },
  close: (db) => db.$client.close(),
});
const addUser = operation({
  label: "addUser",
  input: z.string(),
  depends: { tx: store.tx },
  run: ({ tx }, ctx) => tx.insert(users).values({ name: ctx.input }),
});
const listNames = operation({
  label: "listNames",
  depends: { db: store.db },
  run: ({ db }) => db.select().from(users),
});

/** The session commits its insert before the root reads; each tour owns its database. */
export async function tour(): Promise<string> {
  const stop = new AbortController();
  const scope = createScope({ signal: stop.signal, tags: [store.config(null)] });
  let output: string;
  let end: Scope.Result;
  try {
    await scope.ready;
    await scope.session((session) => session.run(addUser, { input: "ada" }));
    const rows = await scope.run(listNames);
    output = rows.map((row) => row.name).join(",");
  } finally {
    stop.abort();
    end = await scope.closed;
  }
  if (end.status === "failed") throw end.error;
  if (end.teardownErrors?.length) {
    const [error] = end.teardownErrors;
    throw error;
  }
  return output;
}

if (import.meta.main) {
  process.stdout.write(`${await tour()}\n`);
}
