import { Database } from "bun:sqlite";

import { capsule, resource, tag } from "@tinkered/core";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

// SQLite through Bun's own `bun:sqlite`: sync, in process, one connection. The connection is
// what a Drizzle facade takes (`drizzleSqlite({ driver: bunSqlite.connection })`): its db, its
// migrator, and `begin`, a plain BEGIN and COMMIT on the one connection.

/** The database file; `:memory:` keeps it in memory. */
const file = tag<string>({
  label: "bunSqlite.file",
  default: ":memory:",
  parse: (raw) => {
    if (typeof raw !== "string" || raw === "") throw new TypeError("not a file name");
    return raw;
  },
});

/** The database, in WAL mode with foreign keys on; it closes with the scope. */
const connection = resource({
  label: "bunSqlite.connection",
  depends: { file },
  factory: async ({ file }, { defer }) => {
    const client = new Database(file);
    client.exec("PRAGMA journal_mode = WAL");
    client.exec("PRAGMA foreign_keys = ON");
    defer(() => client.close());
    const db = drizzle({ client });

    return {
      db,
      migrate: async (folder: string) => void migrate(db, { migrationsFolder: folder }),
      // A sync driver: the facade's write turn keeps other sessions' transactions off it.
      begin: async () => {
        client.exec("BEGIN IMMEDIATE");

        return {
          tx: db,
          end: async (commit: boolean) => void client.exec(commit ? "COMMIT" : "ROLLBACK"),
        };
      },
    };
  },
});

/** SQLite on `bun:sqlite`. */
export const bunSqlite = capsule({
  label: "bunSqlite",
  config: { file },
  exports: { connection },
});
