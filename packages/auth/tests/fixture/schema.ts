import { pgTable, text } from "drizzle-orm/pg-core";

export * from "./auth-schema.ts";

export const visits = pgTable("visits", { name: text("name").notNull() });
