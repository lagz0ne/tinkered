import { bigint, integer, pgTable, text } from "drizzle-orm/pg-core";

/** One row in the saved issue table. Times are epoch millis (bigint).
 * The first migration and the old-db baseline both fill these defaults. */
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
