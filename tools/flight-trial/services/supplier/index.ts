import {
  createScope,
  data,
  extension,
  operation,
  resource,
  tag,
  type Operation,
} from "@tinker/core";
import { preset } from "@tinker/core/testing";
import { z } from "zod";
import { readFlights, type Flights } from "../../src/flights.ts";
import {
  calls,
  clock,
  control,
  controlToken,
  createHttp,
  host,
  port,
  reject,
  reply,
  rules,
  stopSignal,
  sleepUntilStopped,
  type Service,
} from "../http.ts";

export declare namespace Supplier {
  type Options = Service.Options & { supplier: Flights.Supplier["id"]; holdMs?: number };
  type Offer = {
    id: string;
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
    status: "held" | "paid" | "expired";
    selected_offers: string[];
    total_amount: string;
    total_currency: "USD";
    payment_required_by?: string;
    flight_id: string;
    cabin_class: Flights.Cabin["cabin"];
    passengers: number;
  };
  type Stock = { flight: Flights.Offer; cabins: Flights.Cabin[] };
  type Change = {
    flight_id: string;
    cabin_class: Flights.Cabin["cabin"];
    seats?: number;
    amount_cents?: number;
    fare_class: "saver" | "standard" | "flex";
  };
  type State = {
    stock: Record<string, Stock>;
    offers: Record<string, Offer>;
    orders: Record<string, Order>;
  };
}

const supplierId = tag<Flights.Supplier["id"]>({ label: "supplier ID" });
const holdMs = tag({ label: "hold duration", default: 1000 });
const state = data<Supplier.State>({
  label: "supplier state",
  initial: { stock: {}, offers: {}, orders: {} },
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
    amount: z.string(),
    currency: z.literal("USD"),
    type: z.literal("balance").default("balance"),
  }),
});
const scenario = data({ label: "supplier scenario", initial: "default" });

/** A pure stock edit runs inside the controlling operation; it owns no work. */
function changeStock(stock: Supplier.Stock, change: Supplier.Change): void {
  const cabin = stock.cabins.find((entry) => entry.cabin === change.cabin_class);
  if (!cabin) return;
  if (change.seats !== undefined) cabin.seatsAvailable = change.seats;
  const fare = cabin.fares.find((entry) => entry.fareClass === change.fare_class);
  if (fare && change.amount_cents !== undefined) fare.amountCents = change.amount_cents;
}

/** The wire shape is a pure view of fixture data owned by the search operation. */
function createOffer(
  flight: Flights.Offer,
  cabin: Flights.Cabin,
  fare: Flights.Cabin["fares"][number],
  id: string,
): Supplier.Offer {
  return {
    id,
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
            marketing_carrier_flight_number: flight.flightNumber,
          },
        ],
      },
    ],
  };
}

/** A pure view keeps a quoted price separate from the current stock price. */
function readCurrent(current: Supplier.State, offer: Supplier.Offer): Supplier.Offer {
  const stock = current.stock[offer.flight_id];
  const cabin = stock.cabins.find((entry) => entry.cabin === offer.cabin_class)!;
  const fare = cabin.fares.find((entry) => entry.fareClass === offer.fare_class)!;
  return {
    ...offer,
    total_amount: (fare.amountCents / 100).toFixed(2),
    available_seats: cabin.seatsAvailable,
  };
}

/** A pure copy lets both the timer and a request release overdue seats once. */
function expireOrders(current: Supplier.State, now: number): Supplier.State {
  const next = structuredClone(current);
  for (const order of Object.values(next.orders)) {
    if (order.status !== "held" || Date.parse(order.payment_required_by!) > now) continue;
    order.status = "expired";
    const cabin = next.stock[order.flight_id].cabins.find(
      (entry) => entry.cabin === order.cabin_class,
    )!;
    cabin.seatsAvailable += order.passengers;
  }
  return next;
}

const expire = operation({
  label: "expire supplier hold",
  depends: { state: state.controller, clock, stop: stopSignal },
  async run({ state, clock, stop }, ctx: Operation.Ctx<Supplier.Order>) {
    if (
      !(await sleepUntilStopped(
        clock,
        Math.max(0, Date.parse(ctx.input.payment_required_by!) - clock.currentTimeMillis()),
        stop,
        ctx.signal,
      ))
    )
      return;
    state.update((current) => expireOrders(current, clock.currentTimeMillis()));
  },
});
const holds = resource({
  label: "watch supplier holds",
  depends: { state: state.controller, expire: expire.controller },
  factory({ state, expire }, ctx) {
    ctx.defer(
      state.watch((next, previous) => {
        const order = Object.values(next.orders).find(
          (entry) => entry.status === "held" && !previous.orders[entry.id],
        );
        if (order) return expire.run({ input: order });
      }),
    );
  },
});

/** The reader transfers deep copies; this pure builder gives the preset its own complete stock. */
function createState(offers: Flights.Offer[], scenario: string): Supplier.State {
  const stock: Record<string, Supplier.Stock> = {};
  for (const flight of offers) {
    if (scenario === "last-seat") for (const cabin of flight.cabins) cabin.seatsAvailable = 1;
    stock[flight.id] = { flight, cabins: flight.cabins };
  }
  return { stock, offers: {}, orders: {} };
}

const search = operation({
  label: "search supplier flights",
  depends: { state: state.controller },
  run({ state }, ctx: Operation.Ctx<Service.Request>) {
    const parsed = searchSchema.safeParse(ctx.input.body);
    if (!parsed.success) return reject("invalid_offer_request");
    const slice = parsed.data.data.slices.at(0)!;
    const current = structuredClone(state.get());
    const offers: Supplier.Offer[] = [];
    for (const stock of Object.values(current.stock)) {
      const flight = stock.flight;
      if (
        flight.origin !== slice.origin ||
        flight.destination !== slice.destination ||
        flight.date !== slice.departure_date
      )
        continue;
      const cabin = stock.cabins.find((entry) => entry.cabin === parsed.data.data.cabin_class)!;
      if (cabin.seatsAvailable < parsed.data.data.passengers.length) continue;
      for (const fare of cabin.fares) {
        const offer = createOffer(flight, cabin, fare, `off_${ctx.random.uuid()}`);
        current.offers[offer.id] = offer;
        offers.push(offer);
      }
    }
    state.set(current);
    return reply(201, { data: { id: `orq_${ctx.random.uuid()}`, offers } });
  },
});

const order = operation({
  label: "book supplier order",
  depends: { state: state.controller, holdMs, clock },
  run({ state, holdMs, clock }, ctx: Operation.Ctx<Service.Request>) {
    const parsed = orderSchema.safeParse(ctx.input.body);
    if (!parsed.success) return reject("invalid_order");
    const current = structuredClone(state.get());
    const offer = current.offers[parsed.data.data.selected_offers.at(0)!];
    if (!offer) return reject("offer_not_found", 404);
    const fresh = readCurrent(current, offer);
    if (fresh.total_amount !== offer.total_amount) return reject("offer_price_changed", 409);
    if (fresh.available_seats < parsed.data.data.passengers.length)
      return reject("offer_sold_out", 409);
    const cabin = current.stock[offer.flight_id].cabins.find(
      (entry) => entry.cabin === offer.cabin_class,
    )!;
    cabin.seatsAvailable -= parsed.data.data.passengers.length;
    const held = parsed.data.data.type === "hold";
    const booked: Supplier.Order = {
      id: `ord_${ctx.random.uuid()}`,
      type: parsed.data.data.type,
      status: held ? "held" : "paid",
      selected_offers: [offer.id],
      total_amount: (Number(offer.total_amount) * parsed.data.data.passengers.length).toFixed(2),
      total_currency: "USD",
      flight_id: offer.flight_id,
      cabin_class: offer.cabin_class,
      passengers: parsed.data.data.passengers.length,
      ...(held
        ? { payment_required_by: new Date(clock.currentTimeMillis() + holdMs).toISOString() }
        : {}),
    };
    current.orders[booked.id] = booked;
    state.set(current);
    return reply(201, { data: booked });
  },
});

const pay = operation({
  label: "pay supplier hold",
  depends: { state: state.controller },
  run({ state }, ctx: Operation.Ctx<Service.Request>) {
    const parsed = paySchema.safeParse(ctx.input.body);
    if (!parsed.success) return reject("invalid_payment");
    const current = structuredClone(state.get());
    const order = current.orders[parsed.data.data.order_id];
    if (!order) return reject("order_not_found", 404);
    if (order.status === "expired") return reject("order_expired", 409);
    if (parsed.data.data.amount !== order.total_amount) return reject("incorrect_amount");
    order.status = "paid";
    state.set(current);
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

const supplierControl = operation({
  label: "control supplier",
  depends: {
    supplierState: state.controller,
    supplierScenario: scenario.controller,
    rules: rules.controller,
    calls: calls.controller,
    common: control.controller,
    reader,
    supplierId,
  },
  async run(
    { supplierState, supplierScenario, rules, calls, common, reader, supplierId },
    ctx: Operation.Ctx<Service.Request>,
  ) {
    if (ctx.input.route === "POST /control/scenario") {
      const parsed = scenarioSchema.safeParse(ctx.input.body);
      if (!parsed.success) return reject("invalid_scenario");
      /** Core applies presets at scope creation; this short scope transfers the new scenario data. */
      const seed = createScope({
        presets: [
          preset(state, createState(reader.offers(supplierId), parsed.data.name)),
          preset(scenario, parsed.data.name),
        ],
      });
      supplierState.set(seed.resolve(state));
      supplierScenario.set(seed.resolve(scenario));
      const ended = await seed.close();
      if (ended.status !== "success") return reject("scenario_failed", 500);
      rules.set({});
      calls.set([]);
      return reply(200, { data: { name: parsed.data.name } });
    }
    if (ctx.input.route === "POST /control/flights") {
      const parsed = changeSchema.safeParse(ctx.input.body);
      if (!parsed.success) return reject("invalid_flight_change");
      const current = structuredClone(supplierState.get());
      const stock = current.stock[parsed.data.flight_id];
      if (!stock) return reject("flight_not_found", 404);
      changeStock(stock, parsed.data);
      supplierState.set(current);
      return reply(200, { data: parsed.data });
    }
    return common.run({ input: ctx.input });
  },
});

const lookup = operation({
  label: "read supplier offer or order",
  depends: { state: state.controller },
  run({ state }, ctx: Operation.Ctx<Service.Request>) {
    if (ctx.input.route.startsWith("GET /air/offers/")) {
      const offer = state.get().offers[ctx.input.path.split("/").at(-1)!];
      return offer
        ? reply(200, { data: readCurrent(state.get(), offer) })
        : reject("offer_not_found", 404);
    }
    const booked = state.get().orders[ctx.input.path.split("/").at(-1)!];
    return ctx.input.route.startsWith("GET /air/orders/") && booked
      ? reply(200, { data: booked })
      : reject("not_found", 404);
  },
});
const action = operation({
  label: "supplier API",
  depends: {
    state: state.controller,
    clock,
    search: search.controller,
    order: order.controller,
    pay: pay.controller,
    control: supplierControl.controller,
    lookup: lookup.controller,
  },
  async run(
    { state, clock, search, order, pay, control, lookup },
    ctx: Operation.Ctx<Service.Request>,
  ) {
    if (ctx.input.path.startsWith("/control/")) return control.run({ input: ctx.input });
    state.update((current) => expireOrders(current, clock.currentTimeMillis()));
    if (ctx.input.route === "POST /air/offer_requests") return search.run({ input: ctx.input });
    if (ctx.input.route === "POST /air/orders") return order.run({ input: ctx.input });
    if (ctx.input.route === "POST /air/payments") return pay.run({ input: ctx.input });
    return lookup.run({ input: ctx.input });
  },
});
const http = createHttp(action);

/** Startup belongs to Core so a failed listener closes its root and all built resources. */
const app = extension({
  label: "start supplier app",
  hooks: {
    async start({ scope, next }) {
      await next();
      await scope.run(supplierControl, {
        input: {
          route: "POST /control/scenario",
          path: "/control/scenario",
          body: { name: "default" },
        },
      });
      scope.resolve(holds);
      return scope.resolve(http);
    },
  },
});

/** The caller owns the stop signal; Core owns the scope and listener until closed. */
export async function startSupplier(options: Supplier.Options) {
  const scope = createScope({
    signal: options.signal,
    extensions: app,
    tags: [
      port(options.port),
      host(options.host),
      controlToken(options.controlToken),
      stopSignal(options.signal),
      supplierId(options.supplier),
      holdMs(options.holdMs ?? 1000),
    ],
  });
  await scope.ready;
  const listening = scope.resolve(app);
  return { ...listening, closed: scope.closed };
}
