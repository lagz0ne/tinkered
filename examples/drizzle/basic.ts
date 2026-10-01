import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { createScope, namespace, operation, resource, tag, type Scope } from "@tinker/core";
import { createQueryLogger, openTransaction } from "@tinker/drizzle";
import { z } from "zod";

const users = pgTable("tour_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});
const databaseConfig = tag<{ url: string }>({ label: "tour.config" });
const database = resource({
  label: "tour.db",
  target: "namespace",
  depends: { config: databaseConfig },
  factory: async ({ config }, ctx) => {
    const client = new PGlite(config.url);
    ctx.defer(() => client.close());
    const db = drizzle({ client, logger: createQueryLogger(ctx) });
    await db.execute(sql`create table tour_users (id serial primary key, name text not null)`);
    return db;
  },
});
const transaction = resource({
  label: "tour.tx",
  target: "session",
  depends: { db: database },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
const addUser = operation({
  label: "addUser",
  input: z.string(),
  depends: { tx: transaction },
  run: ({ tx }, ctx) => tx.insert(users).values({ name: ctx.input }),
});
const listNames = operation({
  label: "listNames",
  depends: { db: database },
  run: ({ db }) => db.select().from(users),
});
const tourNamespace = namespace({
  tags: [databaseConfig({ url: "memory://tour" })],
});

/** The session commits its insert before the root reads; each tour owns its database. */
export async function tour(): Promise<string> {
  const stop = new AbortController();
  const scope = createScope({ signal: stop.signal });
  let output: string;
  let end: Scope.Result;
  try {
    await scope.ready;
    await scope.session({ ns: tourNamespace }, (session) => session.run(addUser, { input: "ada" }));
    const rows = await scope.run(listNames, { ns: tourNamespace });
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
