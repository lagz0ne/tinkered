import { operation, type Operation } from "@tinker/core";
import { eq, asc } from "drizzle-orm";
import { database } from "./database.ts";
import { currentUser } from "./auth.ts";
import { booking, flightQuote } from "./bookings.schema.ts";
import { eventHistory } from "../scaffold/backend/events.ts";
import { execution } from "../scaffold/backend/sync.schema.ts";
import { holdCommand, type Bookings } from "../contracts/bookings.ts";
import { readSupplierOffer, readSupplierOrder, holdSupplierOffer } from "./flight-http.ts";
import { raise, isError } from "../errors.ts";
export const listBookings = operation({
  label: "list flight bookings",
  depends: { database, currentUser },
  async run({ database, currentUser }) {
    return database
      .select()
      .from(booking)
      .where(eq(booking.ownerId, currentUser.id))
      .orderBy(asc(booking.id));
  },
});
export const holdFlight = operation({
  label: "hold flight",
  input: holdCommand,
  depends: {
    database,
    currentUser,
    history: eventHistory,
    offer: readSupplierOffer.controller,
    hold: holdSupplierOffer.controller,
  },
  async run({ database, currentUser, history, offer, hold }, ctx) {
    const selected = (
      await database.select().from(flightQuote).where(eq(flightQuote.id, ctx.input.offerId))
    ).at(0)?.offer;
    if (!selected) raise("BadInput", { reason: "Search again" });
    await database.transaction(async (tx) => {
      await history.lock(tx, currentUser.id);
      if (await history.find(tx, ctx.input.executionId, currentUser.id)) return;
      await history.lock(tx, "public");
      const current = await offer.run({
        input: { supplier: selected.supplier, offerId: selected.id },
      });
      let seats = current.available_seats;
      let message: string | undefined;
      if (current.total_amount !== selected.total_amount) message = "Price changed";
      else if (current.available_seats === 0) message = "Sold out";
      else {
        const ordered = await hold.settle({
          input: { supplier: selected.supplier, offerId: selected.id },
        });
        if (ordered.status === "cancelled") raise("Cancelled", {});
        if (ordered.status === "failed") {
          if (!isError(ordered.error, "OfferSoldOut")) throw ordered.error;
          message = "Sold out";
          seats = 0;
        } else {
          const saved = ordered.value;
          seats = Math.max(0, current.available_seats - 1);
          await tx.insert(booking).values({
            id: ctx.input.executionId,
            ownerId: currentUser.id,
            offer: selected,
            orderId: saved.id,
            price: saved.total_amount,
            expires: saved.payment_status.payment_required_by!,
            state: "Held",
          });
        }
      }
      if (message !== "Price changed") {
        const seatExecutionId = ctx.random.uuid();
        await tx.insert(execution).values({ id: seatExecutionId, stream: "public" });
        await history.append(tx, "public", seatExecutionId, [
          {
            kind: "change",
            change: {
              kind: "flightSeats",
              supplier: selected.supplier,
              flightId: selected.flight_id,
              cabin: selected.cabin_class,
              seats,
            },
          },
        ]);
      }
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
    });
    return { executionId: ctx.input.executionId };
  },
});
/** HTTP entry points guard ownership before this internal save; its transaction also publishes the new rows. */
export const saveBookingState = operation({
  label: "save flight booking state",
  depends: { database, history: eventHistory },
  async run(
    { database, history },
    ctx: Operation.Ctx<{ row: Bookings.Row; state: Bookings.Row["state"] }>,
  ) {
    await database.transaction(async (tx) => {
      await history.lock(tx, ctx.input.row.ownerId);
      const saved = (await tx.select().from(booking).where(eq(booking.id, ctx.input.row.id))).at(0);
      if (!saved || saved.state === ctx.input.state) return;
      await tx.update(booking).set({ state: ctx.input.state }).where(eq(booking.id, saved.id));
      const executionId = ctx.random.uuid();
      await tx.insert(execution).values({ id: executionId, stream: saved.ownerId });
      const rows = await tx
        .select()
        .from(booking)
        .where(eq(booking.ownerId, saved.ownerId))
        .orderBy(asc(booking.id));
      await history.append(tx, saved.ownerId, executionId, [
        { kind: "change", change: { kind: "bookings", rows } },
        { kind: "result", result: { kind: "complete", action: "booking" } },
      ]);
    });
  },
});
export const refreshBookings = operation({
  label: "refresh flight holds",
  depends: {
    list: listBookings,
    supplier: readSupplierOrder.controller,
    save: saveBookingState.controller,
  },
  async run({ list, supplier, save }) {
    for (const row of await list.run()) {
      if (row.state !== "Held" && row.state !== "Payment failed") continue;
      const reply = await supplier.settle({
        input: { supplier: row.offer.supplier, orderId: row.orderId },
      });
      if (reply.status === "cancelled") raise("Cancelled", {});
      if (reply.status === "failed") {
        if (!isError(reply.error, "ServiceRejected")) throw reply.error;
        continue;
      }
      const order = reply.value;
      if (!order.payment_status.awaiting_payment && order.payment_status.paid_at === null)
        await save.run({ input: { row, state: "Expired" } });
    }
    return { ok: true };
  },
});
