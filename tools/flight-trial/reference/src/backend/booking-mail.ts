import { operation, resource, type Operation } from "@tinker/core";
import { eq, asc, and } from "drizzle-orm";
import { database } from "./database.ts";
import { currentUser } from "./auth.ts";
import { booking } from "./bookings.schema.ts";
import { user } from "./schema.ts";
import { bookingCommand, type Bookings } from "../contracts/bookings.ts";
import type { Sync } from "../contracts/sync.ts";
import { eventHistory } from "../scaffold/backend/events.ts";
import { execution } from "../scaffold/backend/sync.schema.ts";
import { sendMail } from "./mail.ts";
import { raise } from "../errors.ts";
/** SMTP runs after the booking commit, outside its stream lock; only the final mail state needs a new lock. */
const deliverBookingMail = operation({
  label: "deliver flight confirmation",
  depends: { database, history: eventHistory, send: sendMail },
  async run(
    { database, history, send },
    ctx: Operation.Ctx<{ executionId: string; bookingId: string }>,
  ) {
    const stored = (
      await database.select().from(execution).where(eq(execution.id, ctx.input.executionId))
    ).at(0);
    if (!stored?.notification) raise("RetryNotAvailable", {});
    if (stored.result) return { executionId: ctx.input.executionId };
    const sent = await send.settle({ rawInput: stored.notification });
    const emailState: Bookings.Row["emailState"] = sent.status === "success" ? "Sent" : "Failed";
    const result: Sync.Result =
      sent.status === "success"
        ? { kind: "complete", action: "booking" }
        : {
            kind: "partial",
            action: "booking",
            bookingId: ctx.input.bookingId,
            notification: {
              kind: "failed",
              message: "Booking confirmed; email failed. Retry email.",
            },
          };
    await database.transaction(async (tx) => {
      await history.lock(tx, stored.stream);
      const latest = await history.find(tx, ctx.input.executionId, stored.stream);
      if (latest?.result) return;
      await tx.update(booking).set({ emailState }).where(eq(booking.id, ctx.input.bookingId));
      const rows = await tx
        .select()
        .from(booking)
        .where(eq(booking.ownerId, stored.stream))
        .orderBy(asc(booking.id));
      await history.append(tx, stored.stream, ctx.input.executionId, [
        { kind: "change", change: { kind: "bookings", rows } },
        { kind: "result", result },
      ]);
    });
    return { executionId: ctx.input.executionId };
  },
});
/** This process retains only unfinished send promises; operations own starting and removing them. */
const mailWork = resource({
  label: "unfinished flight confirmation sends",
  factory(_, ctx) {
    const pending = new Map<string, Promise<Sync.Receipt>>();
    ctx.defer(() => pending.clear());
    return pending;
  },
});
export const sendBookingMail = operation({
  label: "send flight booking mail",
  depends: {
    database,
    history: eventHistory,
    work: mailWork,
    deliver: deliverBookingMail.controller,
  },
  async run(
    { database, history, work, deliver },
    ctx: Operation.Ctx<{ executionId: string; bookingId: string; ownerId: string }>,
  ) {
    await database.transaction(async (tx) => {
      await history.lock(tx, ctx.input.ownerId);
      if (await history.find(tx, ctx.input.executionId, ctx.input.ownerId)) return;
      const row = (
        await tx
          .select()
          .from(booking)
          .where(and(eq(booking.id, ctx.input.bookingId), eq(booking.ownerId, ctx.input.ownerId)))
      ).at(0);
      if (!row) raise("BookingDenied", { id: ctx.input.bookingId });
      if (row.state !== "Confirmed") raise("RetryNotAvailable", {});
      const profile = (await tx.select().from(user).where(eq(user.id, row.ownerId))).at(0)!;
      const segment = row.offer.slices.at(0)!.segments.at(0)!;
      await tx.insert(execution).values({
        id: ctx.input.executionId,
        stream: row.ownerId,
        notification: {
          to: profile.email,
          subject: `Flight booking ${row.id}`,
          text: [
            `Booking: ${row.id}`,
            `Flight: ${row.offer.flight_id}`,
            `Order: ${row.orderId}`,
            `Supplier: ${row.offer.supplier}`,
            `Price: ${row.price} USD`,
            `Departure: ${segment.departing_at}`,
            `Arrival: ${segment.arriving_at}`,
          ].join("\n"),
        },
      });
      if (row.emailState === "Sent")
        await history.append(tx, row.ownerId, ctx.input.executionId, [
          { kind: "result", result: { kind: "complete", action: "booking" } },
        ]);
    });
    const existing = work.get(ctx.input.executionId);
    if (existing) return existing;
    const completed = deliver
      .run({ input: { executionId: ctx.input.executionId, bookingId: ctx.input.bookingId } })
      .finally(() => work.delete(ctx.input.executionId));
    work.set(ctx.input.executionId, completed);
    return completed;
  },
});
export const retryBookingMail = operation({
  label: "retry flight booking email",
  input: bookingCommand,
  depends: { currentUser, send: sendBookingMail.controller },
  run({ currentUser, send }, ctx) {
    return send.run({ input: { ...ctx.input, ownerId: currentUser.id } });
  },
});
