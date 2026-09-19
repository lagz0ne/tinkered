import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { drizzleStore } from "@tinker/drizzle";

/** One row in the saved issue table. */
export const issueRows = pgTable("issues", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
});

export declare namespace Store {
  /** The opened PGlite database behind the frame. */
  export type Database = ReturnType<typeof openDatabase>;
}

async function openDatabase(path: string | undefined) {
  const client = new PGlite(path);
  const db = drizzle(client);
  await db.execute(
    sql`create table if not exists issues (id text primary key, title text not null, description text not null)`,
  );
  return db;
}

/** The frame: config is the PGlite data path (undefined = in-memory). */
export const store = drizzleStore({
  label: "issues",
  open: (path: string | undefined) => openDatabase(path),
  close: (db) => db.$client.close(),
});
