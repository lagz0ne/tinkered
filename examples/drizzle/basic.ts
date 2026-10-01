import { fileURLToPath } from "node:url";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createScope, namespace, operation, type Scope } from "@tinker/core";
import { config, database, migrate, migrationConfig, transaction } from "@tinker/drizzle/pglite";
import { z } from "zod";

const users = pgTable("tour_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
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
  tags: [config({ kind: "open" })],
});
const migrationsFolder = fileURLToPath(new URL("./drizzle", import.meta.url));

/** The session commits its insert before the root reads; each tour owns its database. */
export async function tour(): Promise<string> {
  const stop = new AbortController();
  const scope = createScope({ signal: stop.signal });
  let output: string;
  let end: Scope.Result;
  try {
    await scope.ready;
    await scope.run(migrate, {
      ns: tourNamespace,
      tags: [migrationConfig({ migrationsFolder })],
    });
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
