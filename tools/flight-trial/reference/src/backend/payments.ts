import { operation, type Operation } from "@tinker/core";
import { eq, asc, and } from "drizzle-orm";
import { z } from "zod";
import { database } from "./database.ts";
import { currentUser } from "./auth.ts";
import { booking } from "./bookings.schema.ts";
import { bookingCommand, supplierOrder, type Bookings } from "../contracts/bookings.ts";
import { eventHistory } from "../scaffold/backend/events.ts";
import { execution } from "../scaffold/backend/sync.schema.ts";
import { callSupplier } from "./flight-http.ts";
import { callPayment, paymentSettings } from "./payment-http.ts";
import { verifyPaymentSignature } from "./payment-signature.ts";
import { raise } from "../errors.ts";
const orderReply = z.object({ data: supplierOrder });
const intent = z.object({
  id: z.string(),
  amount: z.number().int().positive(),
  currency: z.literal("usd"),
});
const event = z.object({
  id: z.string(),
  type: z.enum(["payment_intent.succeeded", "payment_intent.payment_failed"]),
  data: z.object({ object: intent }),
});
/** Wire JSON is read once after its signature was checked; malformed input gets HTTP 400. */
function readPaymentEvent(bytes: Uint8Array) {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
  const parsed = event.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
export const payBooking = operation({
  label: "pay flight booking",
  input: bookingCommand,
  depends: {
    database,
    currentUser,
    history: eventHistory,
    supplier: callSupplier.controller,
    payment: callPayment.controller,
  },
  async run({ database, currentUser, history, supplier, payment }, ctx) {
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
        const response = await supplier.run({
          input: { supplier: row.offer.supplier, path: `/air/orders/${row.orderId}` },
        });
        const order = orderReply.parse(response.body).data;
        if (!order.payment_status.awaiting_payment) {
          await tx.update(booking).set({ state: "Expired" }).where(eq(booking.id, row.id));
          message = "Hold expired";
        } else {
          const created = await payment.run({
            input: {
              path: "/v1/payment_intents",
              body: { amount: Math.round(Number(row.price) * 100), currency: "usd" },
              key: `create-${row.id}`,
            },
          });
          if (!created.ok) raise("ServiceRejected", { service: "payment", status: created.status });
          paymentId = intent.parse(created.body).id;
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
      const response = await payment.run({
        input: {
          path: `/v1/payment_intents/${pending}/confirm`,
          body: {},
          key: `confirm-${ctx.input.bookingId}`,
        },
      });
      if (!response.ok) raise("ServiceRejected", { service: "payment", status: response.status });
    }
    return { executionId: ctx.input.executionId };
  },
});
export const refundBooking = operation({
  label: "refund expired flight payment",
  depends: { payment: callPayment.controller },
  async run({ payment }, ctx: Operation.Ctx<Bookings.Row & { paymentId: string }>) {
    const response = await payment.run({
      input: {
        path: "/v1/refunds",
        body: { payment_intent: ctx.input.paymentId },
        key: `refund-${ctx.input.id}`,
      },
    });
    if (!response.ok) raise("ServiceRejected", { service: "refund", status: response.status });
    const refund = z
      .object({ amount: z.number(), status: z.literal("succeeded") })
      .parse(response.body);
    if (refund.amount !== Math.round(Number(ctx.input.price) * 100))
      raise("BadInput", { reason: "Refund amount differs from the booking price" });
  },
});
export const receivePayment = operation({
  label: "receive flight payment result",
  depends: {
    database,
    settings: paymentSettings,
    history: eventHistory,
    supplier: callSupplier.controller,
    refund: refundBooking.controller,
  },
  async run(
    { database, settings, history, supplier, refund },
    ctx: Operation.Ctx<{ body: Uint8Array; signature: string | null }>,
  ) {
    if (
      !verifyPaymentSignature(
        ctx.input.body,
        ctx.input.signature,
        settings.WEBHOOK_SECRET,
        ctx.clock.currentTimeMillis(),
      )
    )
      return { status: 400, accepted: false };
    const received = readPaymentEvent(ctx.input.body);
    if (!received) return { status: 400, accepted: false };
    const matched = (
      await database.select().from(booking).where(eq(booking.paymentId, received.data.object.id))
    ).at(0);
    if (!matched) return { status: 200, accepted: true };
    if (received.data.object.amount !== Math.round(Number(matched.price) * 100))
      return { status: 400, accepted: false };
    await database.transaction(async (tx) => {
      await history.lock(tx, matched.ownerId);
      const row = (await tx.select().from(booking).where(eq(booking.id, matched.id))).at(0)!;
      if (row.state !== "Processing") return;
      let state: Bookings.Row["state"] = "Payment failed";
      if (received.type === "payment_intent.succeeded") {
        const response = await supplier.run({
          input: { supplier: row.offer.supplier, path: `/air/orders/${row.orderId}` },
        });
        const order = orderReply.parse(response.body).data;
        let paid = order.payment_status.paid_at !== null;
        if (order.payment_status.awaiting_payment) {
          const payment = await supplier.run({
            input: {
              supplier: row.offer.supplier,
              path: "/air/payments",
              body: {
                data: {
                  order_id: row.orderId,
                  payment: { type: "balance", amount: row.price, currency: "USD" },
                },
              },
            },
          });
          if (!payment.ok && payment.status !== 409)
            raise("ServiceRejected", { service: "supplier payment", status: payment.status });
          paid = payment.ok;
        }
        if (!paid) await refund.run({ input: { ...row, paymentId: received.data.object.id } });
        state = paid ? "Confirmed" : "Refunded";
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
    });
    return { status: 200, accepted: true };
  },
});
