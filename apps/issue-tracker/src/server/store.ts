import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { bigint, integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { drizzleStore } from "@tinker/drizzle";

/** One row in the saved issue table. Times are epoch millis (bigint).
 * Slices before t02 saved bare id/title/description rows; the migration
 * below fills the rest. */
export const issueRows = pgTable("issues", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  assignee: text("assignee"),
  revision: integer("revision").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(0),
});

/** One saved comment row: appended independently of edit revisions. */
export const commentRows = pgTable("comments", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").notNull(),
  author: text("author").notNull(),
  text: text("text").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

/** One saved activity row: creation, successful changes, and comments. */
export const activityRows = pgTable("activity", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").notNull(),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
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
  await db.execute(
    sql`alter table issues add column if not exists status text not null default 'open'`,
  );
  await db.execute(sql`alter table issues add column if not exists assignee text`);
  await db.execute(
    sql`alter table issues add column if not exists revision integer not null default 0`,
  );
  await db.execute(
    sql`alter table issues add column if not exists created_at bigint not null default 0`,
  );
  await db.execute(
    sql`alter table issues add column if not exists updated_at bigint not null default 0`,
  );
  await db.execute(
    sql`create table if not exists comments (id text primary key, issue_id text not null, author text not null, text text not null, created_at bigint not null)`,
  );
  await db.execute(
    sql`create table if not exists activity (id text primary key, issue_id text not null, kind text not null, summary text not null, created_at bigint not null)`,
  );
  return db;
}

/** The frame: config is the PGlite data path (undefined = in-memory). */
export const store = drizzleStore({
  label: "issues",
  open: (path: string | undefined) => openDatabase(path),
  close: (db) => db.$client.close(),
});
