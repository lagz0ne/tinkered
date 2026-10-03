import { data, extension, operation, resource, tag } from "@tinker/core";
import { z } from "zod";
import { readFlights, type Flights } from "../../src/flights.ts";
import {
  calls,
  clock,
  reject,
  reply,
  rules,
  httpRequests,
  controlRoutes,
  errorShape,
  listener,
} from "../http.ts";

export declare namespace Supplier {
  type Offer = {
    id: string;
    expires_at: string;
    flight_id: string;
    cabin_class: Flights.Cabin["cabin"];
    fare_class: string;
    total_amount: string;
    total_currency: "USD";
    available_seats: number;
    slices: {
      origin: { iata_code: string };
      destination: { iata_code: string };
      segments: {
        id: string;
        departing_at: string;
        arriving_at: string;
        marketing_carrier: { id: string };
        marketing_carrier_flight_number: string;
      }[];
    }[];
  };
  type Order = {
    id: string;
    type: "instant" | "hold";
    selected_offers: string[];
    total_amount: string;
    total_currency: "USD";
    payment_status: {
      awaiting_payment: boolean;
      payment_required_by: string | null;
      paid_at: string | null;
      price_guarantee_expires_at: string | null;
    };
    flight_id: string;
    cabin_class: Flights.Cabin["cabin"];
    passengers: number;
  };
  type Stock = { flight: Flights.Offer; cabins: Flights.Cabin[] };
  type State = {
    stock: Record<string, Stock>;
    offers: Record<string, Offer>;
    orders: Record<string, Order>;
  };
}

export const supplierId = tag<Flights.Supplier["id"]>({ label: "supplier ID" });
export const holdMs = tag({ label: "hold duration", default: 1000 });
const state = data<Supplier.State>({
  label: "supplier state",
  initial: createState([], "default"),
});
const reader = resource({ label: "flight fixture", factory: () => readFlights() });
const scenarioSchema = z.object({ name: z.enum(["default", "last-seat"]) });
const searchSchema = z.object({
  data: z.object({
    slices: z
      .array(z.object({ origin: z.string(), destination: z.string(), departure_date: z.string() }))
      .length(1),
    passengers: z
      .array(z.object({ type: z.enum(["adult", "child", "infant_without_seat"]) }))
      .min(1)
      .default([{ type: "adult" }]),
    cabin_class: z.enum(["economy", "business"]).default("economy"),
  }),
});
const orderSchema = z.object({
  data: z.object({
    selected_offers: z.array(z.string()).length(1),
    type: z.enum(["instant", "hold"]),
    passengers: z
      .array(z.object({ id: z.string().optional() }).passthrough())
      .min(1)
      .default([{}]),
  }),
});
const changeSchema = z.object({
  flight_id: z.string(),
  cabin_class: z.enum(["economy", "business"]),
  seats: z.number().int().nonnegative().optional(),
  amount_cents: z.number().int().nonnegative().optional(),
  fare_class: z.enum(["saver", "standard", "flex"]).default("saver"),
});
const paySchema = z.object({
  data: z.object({
    order_id: z.string(),
    payment: z.object({
      amount: z.string(),
      currency: z.literal("USD"),
      type: z.literal("balance"),
    }),
  }),
});

/**
 * Keeps the quoted wire fields while showing current price and seats.
 * @param offer - Stored quote from lookup or booking; needed for its wire fields.
 * @param amountCents - Matching stock fare from the operation; needed for the current price.
 * @param seatsAvailable - Matching stock cabin from the operation; needed for available seats.
 */
function readCurrent(
  offer: Supplier.Offer,
  amountCents: number,
  seatsAvailable: number,
): Supplier.Offer {
  return {
    ...offer,
    total_amount: (amountCents / 100).toFixed(2),
    available_seats: seatsAvailable,
  };
}
/** HTTP is the state boundary; deadline cleanup precedes reads and grader edits alike. */
const expireHolds = operation({
  label: "release expired supplier quotes and holds",
  depends: { state: state.controller, clock },
  run({ state, clock }) {
    const now = clock.currentTimeMillis();
    state.update((current) => {
      let next = current;
      for (const offer of Object.values(current.offers)) {
        if (Date.parse(offer.expires_at) > now) continue;
        if (next === current) next = { ...current, offers: { ...current.offers } };
        delete next.offers[offer.id];
      }
      for (const order of Object.values(current.orders)) {
        if (
          !order.payment_status.awaiting_payment ||
          Date.parse(order.payment_status.payment_required_by!) > now
        )
          continue;
        const stock = structuredClone(next.stock[order.flight_id]);
        const cabin = stock.cabins.find((entry) => entry.cabin === order.cabin_class)!;
        cabin.seatsAvailable += order.passengers;
        next = {
          ...next,
          stock: { ...next.stock, [order.flight_id]: stock },
          orders: {
            ...next.orders,
            [order.id]: {
              ...order,
              payment_status: { ...order.payment_status, awaiting_payment: false },
            },
          },
        };
      }
      return next;
    });
  },
});

/**
 * Builds stock from plain fixture values without changing the reader's copies.
 * @param offers - Fixture offers from the reader or the empty initial value; needed for stock.
 * @param scenario - Parsed control choice or the initial default; needed for starting seats.
 */
function createState(offers: Flights.Offer[], scenario: string): Supplier.State {
  const stock: Record<string, Supplier.Stock> = {};
  for (const source of offers) {
    const flight =
      scenario === "last-seat"
        ? { ...source, cabins: source.cabins.map((cabin) => ({ ...cabin, seatsAvailable: 1 })) }
        : source;
    stock[flight.id] = { flight, cabins: flight.cabins };
  }
  return { stock, offers: {}, orders: {} };
}

const search = operation({
  label: "search supplier flights",
  input: (raw) => searchSchema.safeParse(raw),
  depends: { state: state.controller, clock },
  run({ state, clock }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_offer_request");
    const slice = parsed.data.data.slices.at(0)!;
    const current = state.get();
    const deadline = clock.currentTimeMillis() + 30 * 60 * 1000;
    const offers: Supplier.Offer[] = [];
    for (const stock of Object.values(current.stock).filter(
      (entry) =>
        entry.flight.origin === slice.origin &&
        entry.flight.destination === slice.destination &&
        entry.flight.date === slice.departure_date,
    )) {
      const flight = stock.flight;
      const cabin = stock.cabins.find((entry) => entry.cabin === parsed.data.data.cabin_class)!;
      if (cabin.seatsAvailable < parsed.data.data.passengers.length) continue;
      for (const fare of cabin.fares) {
        const offer: Supplier.Offer = {
          /** The opaque ID keeps its deadline so dropped quotes need no growing tombstone list. */
          id: `off_${deadline}_${ctx.random.uuid()}`,
          expires_at: new Date(deadline).toISOString(),
          flight_id: flight.id,
          cabin_class: cabin.cabin,
          fare_class: fare.fareClass,
          total_amount: (fare.amountCents / 100).toFixed(2),
          total_currency: "USD",
          available_seats: cabin.seatsAvailable,
          slices: [
            {
              origin: { iata_code: flight.origin },
              destination: { iata_code: flight.destination },
              segments: [
                {
                  id: flight.id,
                  departing_at: flight.departsAt,
                  arriving_at: flight.arrivesAt,
                  marketing_carrier: { id: String(flight.airlineId) },
                  marketing_carrier_flight_number: flight.flightNumber.slice(2),
                },
              ],
            },
          ],
        };
        offers.push(offer);
      }
    }
    const retained = [...Object.values(current.offers), ...offers];
    if (retained.length > 65536) return reject("offer_limit_reached", 429);
    state.set({
      ...current,
      offers: Object.fromEntries(retained.map((offer) => [offer.id, offer])),
    });
    return reply(201, { data: { id: `orq_${ctx.random.uuid()}`, offers } });
  },
});

const order = operation({
  label: "book supplier order",
  input: (raw) => orderSchema.safeParse(raw),
  depends: { state: state.controller, holdMs, clock },
  run({ state, holdMs, clock }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_order");
    const current = state.get();
    const id = parsed.data.data.selected_offers.at(0)!;
    if (Number(id.split("_").at(1)) <= clock.currentTimeMillis())
      return reject("offer_expired", 409);
    const offer = current.offers[id];
    if (!offer) return reject("offer_not_found", 404);
    const stock = current.stock[offer.flight_id];
    const quotedCabin = stock.cabins.find((entry) => entry.cabin === offer.cabin_class)!;
    const fare = quotedCabin.fares.find((entry) => entry.fareClass === offer.fare_class)!;
    const fresh = readCurrent(offer, fare.amountCents, quotedCabin.seatsAvailable);
    if (fresh.total_amount !== offer.total_amount) return reject("offer_price_changed", 409);
    if (fresh.available_seats < parsed.data.data.passengers.length)
      return reject("offer_sold_out", 409);
    const next = {
      ...current,
      stock: { ...current.stock, [offer.flight_id]: structuredClone(stock) },
    };
    const cabin = next.stock[offer.flight_id].cabins.find(
      (entry) => entry.cabin === offer.cabin_class,
    )!;
    cabin.seatsAvailable -= parsed.data.data.passengers.length;
    const held = parsed.data.data.type === "hold";
    const paymentDeadline = held
      ? new Date(clock.currentTimeMillis() + holdMs).toISOString()
      : null;
    const booked: Supplier.Order = {
      id: `ord_${ctx.random.uuid()}`,
      type: parsed.data.data.type,
      payment_status: {
        awaiting_payment: held,
        payment_required_by: paymentDeadline,
        paid_at: held ? null : new Date(clock.currentTimeMillis()).toISOString(),
        price_guarantee_expires_at: paymentDeadline,
      },
      selected_offers: [offer.id],
      total_amount: (Number(offer.total_amount) * parsed.data.data.passengers.length).toFixed(2),
      total_currency: "USD",
      flight_id: offer.flight_id,
      cabin_class: offer.cabin_class,
      passengers: parsed.data.data.passengers.length,
    };
    state.set({ ...next, orders: { ...current.orders, [booked.id]: booked } });
    return reply(201, { data: booked });
  },
});

const pay = operation({
  label: "pay supplier hold",
  input: (raw) => paySchema.safeParse(raw),
  depends: { state: state.controller, clock },
  run({ state, clock }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_payment");
    const current = state.get();
    const order = current.orders[parsed.data.data.order_id];
    if (!order) return reject("order_not_found", 404);
    if (!order.payment_status.awaiting_payment && !order.payment_status.paid_at)
      return reject("order_expired", 409);
    if (!order.payment_status.awaiting_payment) return reject("order_not_awaiting_payment", 409);
    if (parsed.data.data.payment.amount !== order.total_amount) return reject("incorrect_amount");
    state.set({
      ...current,
      orders: {
        ...current.orders,
        [order.id]: {
          ...order,
          payment_status: {
            ...order.payment_status,
            awaiting_payment: false,
            paid_at: new Date(clock.currentTimeMillis()).toISOString(),
          },
        },
      },
    });
    return reply(201, {
      data: {
        id: `pay_${ctx.random.uuid()}`,
        order_id: order.id,
        amount: order.total_amount,
        currency: "USD",
      },
    });
  },
});

const resetScenario = operation({
  label: "start supplier scenario",
  input: (raw) => scenarioSchema.safeParse(raw),
  depends: {
    supplierState: state.controller,
    rules: rules.controller,
    calls: calls.controller,
    reader,
    supplierId,
  },
  async run({ supplierState, rules, calls, reader, supplierId }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_scenario");
    supplierState.set(createState(reader.offers(supplierId), parsed.data.name));
    rules.set({});
    calls.set([]);
    return reply(200, { data: { name: parsed.data.name } });
  },
});
const changeFlight = operation({
  label: "change supplier flight",
  input: (raw) => changeSchema.safeParse(raw),
  depends: { supplierState: state.controller },
  run({ supplierState }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_flight_change");
    const current = supplierState.get();
    if (!current.stock[parsed.data.flight_id]) return reject("flight_not_found", 404);
    const changed = structuredClone(current.stock[parsed.data.flight_id]);
    const cabin = changed.cabins.find((entry) => entry.cabin === parsed.data.cabin_class)!;
    if (parsed.data.seats !== undefined) cabin.seatsAvailable = parsed.data.seats;
    const fare = cabin.fares.find((entry) => entry.fareClass === parsed.data.fare_class)!;
    if (parsed.data.amount_cents !== undefined) fare.amountCents = parsed.data.amount_cents;
    const next = { ...current, stock: { ...current.stock, [parsed.data.flight_id]: changed } };
    supplierState.set(next);
    return reply(200, { data: parsed.data });
  },
});
const readState = operation({
  label: "read supplier state size",
  depends: { state },
  run({ state }) {
    return reply(200, {
      data: {
        offers: Object.keys(state.offers).length,
        bytes: Buffer.byteLength(JSON.stringify(state)),
      },
    });
  },
});

const readOffer = operation({
  label: "read supplier offer",
  input: z.object({ id: z.string() }),
  depends: { state, clock },
  run({ state, clock }, ctx) {
    const { id } = ctx.input;
    if (Number(id.split("_").at(1)) <= clock.currentTimeMillis())
      return reject("offer_expired", 409);
    const offer = state.offers[id];
    if (!offer) return reject("offer_not_found", 404);
    const cabin = state.stock[offer.flight_id].cabins.find(
      (entry) => entry.cabin === offer.cabin_class,
    )!;
    const fare = cabin.fares.find((entry) => entry.fareClass === offer.fare_class)!;
    return reply(200, { data: readCurrent(offer, fare.amountCents, cabin.seatsAvailable) });
  },
});
const readOrder = operation({
  label: "read supplier order",
  input: z.object({ id: z.string() }),
  depends: { state },
  run({ state }, ctx) {
    const booked = state.orders[ctx.input.id];
    return booked ? reply(200, { data: booked }) : reject("not_found", 404);
  },
});

/** Startup supplies the scope to middleware; the resource owns the listener. */
export const app = extension({
  label: "start supplier app",
  hooks: {
    async start(event) {
      const scope = event.scope.createSession({ tags: [errorShape("duffel")] });
      const http = await httpRequests.hooks!.start!({ ...event, scope });
      await scope.run(resetScenario, { rawInput: { name: "default" } });
      http.use("*", async (c, next) => {
        c.var.scope.run(expireHolds);
        await next();
      });
      scope.resolve(controlRoutes);
      http.post("/control/scenario", async (c) => {
        const result = await c.var.scope.run(resetScenario, { rawInput: c.var.body });
        return c.var.json(result);
      });
      http.post("/air/offer_requests", (c) => {
        const result = c.var.scope.run(search, { rawInput: c.var.body });
        return c.var.json(result);
      });
      http.post("/air/orders", (c) => {
        const result = c.var.scope.run(order, { rawInput: c.var.body });
        return c.var.json(result);
      });
      http.post("/air/payments", (c) => {
        const result = c.var.scope.run(pay, { rawInput: c.var.body });
        return c.var.json(result);
      });
      http.get("/air/offers/:id{.*}", (c) => {
        /** The raw path keeps percent-encoding exact on the wire; c.req.param decodes it. */
        const result = c.var.scope.run(readOffer, {
          rawInput: { id: new URL(c.req.url).pathname.split("/").at(-1)! },
        });
        return c.var.json(result);
      });
      http.get("/air/orders/:id{.*}", (c) => {
        /** The raw path keeps percent-encoding exact on the wire; c.req.param decodes it. */
        const result = c.var.scope.run(readOrder, {
          rawInput: { id: new URL(c.req.url).pathname.split("/").at(-1)! },
        });
        return c.var.json(result);
      });
      http.post("/control/flights", (c) => {
        const result = c.var.scope.run(changeFlight, { rawInput: c.var.body });
        return c.var.json(result);
      });
      http.get("/control/state", (c) => {
        const result = c.var.scope.run(readState);
        return c.var.json(result);
      });
      http.notFound((c) => c.var.json(reject("not_found", 404)));
      return scope.resolve(listener);
    },
  },
});
