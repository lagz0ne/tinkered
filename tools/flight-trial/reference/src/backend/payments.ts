import { operation, type Operation } from "@tinker/core";
import { eq, asc, and } from "drizzle-orm";
import { database } from "./database";
import { currentUser } from "./auth";
import { booking } from "./bookings.schema";
import { bookingCommand, type Bookings } from "../contracts/bookings";
import { eventHistory } from "../scaffold/backend/events";
import { execution } from "../scaffold/backend/sync.schema";
import { readSupplierOrder, paySupplierOrder } from "./flight-http";
import { createPaymentIntent, confirmPaymentIntent, refundPayment } from "./payment-http";
import { sendBookingMail } from "./booking-mail";
import { raise } from "../errors";
export const payBooking = operation({
  label: "pay flight booking",
  input: bookingCommand,
  depends: {
    database,
    currentUser,
    history: eventHistory,
    supplier: readSupplierOrder.controller,
    payment: createPaymentIntent.controller,
    confirm: confirmPaymentIntent.controller,
  },
  async run({ database, currentUser, history, supplier, payment, confirm }, ctx) {
    const pending = await database.transaction(async (tx) => {
      await history.lock(tx, currentUser.id);
      if (await history.find(tx, ctx.input.executionId, currentUser.id)) return undefined;
      const row = (
        await tx
          .select()
          .from(booking)
          .where(and(eq(booking.id, ctx.input.bookingId), eq(booking.ownerId, currentUser.id)))
      ).at(0);
      if (!row) raise("BookingDenied", { id: ctx.input.bookingId });
      let paymentId: string | undefined;
      let message: string | undefined;
      if (row.state === "Held") {
        const order = await supplier.run({
          input: { supplier: row.offer.supplier, orderId: row.orderId },
        });
        if (!order.payment_status.awaiting_payment) {
          await tx.update(booking).set({ state: "Expired" }).where(eq(booking.id, row.id));
          message = "Hold expired";
        } else {
          const created = await payment.run({
            input: { bookingId: row.id, amount: Math.round(Number(row.price) * 100) },
          });
          paymentId = created.id;
          await tx
            .update(booking)
            .set({ state: "Processing", paymentId })
            .where(eq(booking.id, row.id));
        }
      } else if (row.state === "Expired") message = "Hold expired";
      await tx.insert(execution).values({ id: ctx.input.executionId, stream: currentUser.id });
      const rows = await tx
        .select()
        .from(booking)
        .where(eq(booking.ownerId, currentUser.id))
        .orderBy(asc(booking.id));
      await history.append(tx, currentUser.id, ctx.input.executionId, [
        { kind: "change", change: { kind: "bookings", rows } },
        {
          kind: "result",
          result: message
            ? { kind: "failed", action: "booking", message }
            : { kind: "complete", action: "booking" },
        },
      ]);
      return paymentId;
    });
    if (pending) {
      await confirm.run({ input: { bookingId: ctx.input.bookingId, paymentId: pending } });
    }
    return { executionId: ctx.input.executionId };
  },
});
export const refundBooking = operation({
  label: "refund expired flight payment",
  depends: { payment: refundPayment.controller },
  async run({ payment }, ctx: Operation.Ctx<Bookings.Row & { paymentId: string }>) {
    const refund = await payment.run({
      input: { bookingId: ctx.input.id, paymentId: ctx.input.paymentId },
    });
    if (refund.amount !== Math.round(Number(ctx.input.price) * 100))
      raise("BadInput", { reason: "Refund amount differs from the booking price" });
  },
});
/** The supplier hold decides whether a successful charge buys the seat or needs a full refund. */
const fulfillBooking = operation({
  label: "fulfill successful flight payment",
  depends: {
    supplier: readSupplierOrder.controller,
    pay: paySupplierOrder.controller,
    refund: refundBooking.controller,
  },
  async run({ supplier, pay, refund }, ctx: Operation.Ctx<Bookings.Row & { paymentId: string }>) {
    const order = await supplier.run({
      input: { supplier: ctx.input.offer.supplier, orderId: ctx.input.orderId },
    });
    let paid = order.payment_status.paid_at !== null;
    if (order.payment_status.awaiting_payment) {
      paid = await pay.run({
        input: {
          supplier: ctx.input.offer.supplier,
          orderId: ctx.input.orderId,
          price: ctx.input.price,
        },
      });
    }
    if (!paid) await refund.run({ input: ctx.input });
    return paid ? ("Confirmed" as const) : ("Refunded" as const);
  },
});
export const receivePayment = operation({
  label: "receive flight payment result",
  depends: {
    database,
    history: eventHistory,
    fulfill: fulfillBooking.controller,
    mail: sendBookingMail.controller,
  },
  async run(
    { database, history, fulfill, mail },
    ctx: Operation.Ctx<{ paymentId: string; amount: number; succeeded: boolean }>,
  ) {
    const matched = (
      await database.select().from(booking).where(eq(booking.paymentId, ctx.input.paymentId))
    ).at(0);
    if (!matched) return { accepted: true };
    if (ctx.input.amount !== Math.round(Number(matched.price) * 100)) return { accepted: false };
    const confirmed = await database.transaction(async (tx) => {
      await history.lock(tx, matched.ownerId);
      const row = (await tx.select().from(booking).where(eq(booking.id, matched.id))).at(0)!;
      if (row.state !== "Processing") return;
      let state: Bookings.Row["state"] = "Payment failed";
      if (ctx.input.succeeded) {
        state = await fulfill.run({ input: { ...row, paymentId: ctx.input.paymentId } });
      }
      await tx.update(booking).set({ state }).where(eq(booking.id, row.id));
      const executionId = ctx.random.uuid();
      await tx.insert(execution).values({ id: executionId, stream: row.ownerId });
      const rows = await tx
        .select()
        .from(booking)
        .where(eq(booking.ownerId, row.ownerId))
        .orderBy(asc(booking.id));
      await history.append(tx, row.ownerId, executionId, [
        { kind: "change", change: { kind: "bookings", rows } },
        { kind: "result", result: { kind: "complete", action: "booking" } },
      ]);
      return state === "Confirmed" ? { bookingId: row.id, ownerId: row.ownerId } : undefined;
    });
    if (confirmed) await mail.run({ input: { ...confirmed, executionId: ctx.random.uuid() } });
    return { accepted: true };
  },
});
