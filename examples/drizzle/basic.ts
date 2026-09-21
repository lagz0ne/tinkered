import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { createScope, operation } from "@tinker/core";
import { drizzleStore } from "@tinker/drizzle";
import { z } from "zod";

/** A cast-free tour of the frame: a PGlite store, a table, a session insert, and a root
 * read that sees the committed row. Every value's type is INFERRED — no `as`, no `!`. */
export async function tour(): Promise<string> {
  const users = pgTable("tour_users", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
  });
  const store = drizzleStore({
    label: "tour",
    open: async (_config, { logger }) => {
      const db = drizzle(new PGlite(), { logger });
      await db.execute(sql`create table tour_users (id serial primary key, name text not null)`);
      return db;
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
  const scope = createScope({ tags: [store.config(null)] });
  await scope.session((s) => s.run(addUser, { input: "ada" }));
  const rows = await scope.run(listNames);
  await scope.close({ graceful: true });
  return rows.map((row) => row.name).join(",");
}
