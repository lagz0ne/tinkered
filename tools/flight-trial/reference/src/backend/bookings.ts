import { operation, type Operation } from "@tinker/core";
import { eq, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { database } from "./database.ts";
import { currentUser } from "./auth.ts";
import { booking, flightQuote } from "./bookings.schema.ts";
import { eventHistory } from "../scaffold/backend/events.ts";
import { execution } from "../scaffold/backend/sync.schema.ts";
import { holdCommand, supplierOrder, type Bookings } from "../contracts/bookings.ts";
import { offer } from "../contracts/flights.ts";
import { callSupplier } from "./flight-http.ts";
import { raise } from "../errors.ts";
const orderReply = z.object({ data: supplierOrder });
const offerReply = z.object({ data: offer });
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
    supplier: callSupplier.controller,
  },
  async run({ database, currentUser, history, supplier }, ctx) {
    const selected = (
      await database.select().from(flightQuote).where(eq(flightQuote.id, ctx.input.offerId))
    ).at(0)?.offer;
    if (!selected) raise("BadInput", { reason: "Search again" });
    await database.transaction(async (tx) => {
      await history.lock(tx, currentUser.id);
      if (await history.find(tx, ctx.input.executionId, currentUser.id)) return;
      const response = await supplier.run({
        input: { supplier: selected.supplier, path: `/air/offers/${selected.id}` },
      });
      const current = offerReply.parse(response.body).data;
      let message: string | undefined;
      if (current.total_amount !== selected.total_amount) message = "Price changed";
      else if (current.available_seats === 0) message = "Sold out";
      else {
        const ordered = await supplier.run({
          input: {
            supplier: selected.supplier,
            path: "/air/orders",
            body: { data: { selected_offers: [selected.id], type: "hold" } },
          },
        });
        if (!ordered.ok) message = "Sold out";
        else {
          const saved = orderReply.parse(ordered.body).data;
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
    supplier: callSupplier.controller,
    save: saveBookingState.controller,
  },
  async run({ list, supplier, save }) {
    for (const row of await list.run()) {
      if (row.state !== "Held") continue;
      const response = await supplier.run({
        input: { supplier: row.offer.supplier, path: `/air/orders/${row.orderId}` },
      });
      if (!response.ok) continue;
      const order = orderReply.parse(response.body).data;
      if (!order.payment_status.awaiting_payment && order.payment_status.paid_at === null)
        await save.run({ input: { row, state: "Expired" } });
    }
    return { ok: true };
  },
});
export const readFlightSeats = operation({
  label: "read current flight seats",
  input: z.array(z.string()),
  depends: { database, supplier: callSupplier.controller },
  async run({ database, supplier }, ctx) {
    const quotes = await database
      .select()
      .from(flightQuote)
      .where(inArray(flightQuote.id, ctx.input));
    return Promise.all(
      quotes.map(async ({ id, offer: selected }) => {
        const response = await supplier.run({
          input: { supplier: selected.supplier, path: `/air/offers/${id}` },
        });
        if (!response.ok) return { id, seats: selected.available_seats };
        return { id, seats: offerReply.parse(response.body).data.available_seats };
      }),
    );
  },
});
