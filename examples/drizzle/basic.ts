import { fileURLToPath } from "node:url";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createScope, namespace, operation, type Scope } from "@tinker/core";
import { config, database, migrate, migrationConfig, transaction } from "@tinker/drizzle/pglite";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});
export const addUser = operation({
  label: "addUser",
  input: z.string(),
  depends: { tx: transaction },
  run: ({ tx }, ctx) => tx.insert(users).values({ name: ctx.input }),
});
export const listNames = operation({
  label: "listNames",
  depends: { db: database },
  run: ({ db }) => db.select().from(users),
});
export const databaseNamespace = namespace({
  tags: [config({ kind: "open" })],
});
export const migrationsFolder = fileURLToPath(new URL("./drizzle", import.meta.url));

if (import.meta.main) {
  const stop = new AbortController();
  const scope = createScope({ signal: stop.signal });
  let output: string;
  let end: Scope.Result;
  const onStop = () => stop.abort();
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);
  try {
    await scope.ready;
    await scope.run(migrate, {
      ns: databaseNamespace,
      tags: [migrationConfig({ migrationsFolder })],
    });
    await scope.session({ ns: databaseNamespace }, (session) =>
      session.run(addUser, { input: "ada" }),
    );
    const rows = await scope.run(listNames, { ns: databaseNamespace });
    output = rows.map((row) => row.name).join(",");
  } finally {
    stop.abort();
    end = await scope.closed;
    process.off("SIGINT", onStop);
    process.off("SIGTERM", onStop);
  }
  if (end.status === "failed") throw end.error;
  if (end.teardownErrors?.length) {
    const [error] = end.teardownErrors;
    throw error;
  }
  process.stdout.write(`${output}\n`);
}
