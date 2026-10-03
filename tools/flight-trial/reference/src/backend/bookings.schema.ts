import { pgTable, text, jsonb } from "drizzle-orm/pg-core";
import { user } from "./schema.ts";
import type { Bookings } from "../contracts/bookings.ts";
import type { Flights } from "../contracts/flights.ts";
export const booking = pgTable("flight_booking", {
  id: text().primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  offer: jsonb().$type<Flights.Row>().notNull(),
  orderId: text("order_id").notNull(),
  price: text().notNull(),
  expires: text().notNull(),
  emailState: text("email_state").$type<Bookings.Row["emailState"]>().notNull().default("Not sent"),
  paymentId: text("payment_id").unique(),
  state: text().$type<Bookings.Row["state"]>().notNull(),
});

export const flightQuote = pgTable("flight_quote", {
  id: text().primaryKey(),
  offer: jsonb().$type<Flights.Row>().notNull(),
});
