import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { startSupplier } from "../src/index.ts";

const offersSchema = z.object({
  data: z.object({
    offers: z.array(
      z.object({
        id: z.string().startsWith("off_"),
        flight_id: z.string().min(1),
        cabin_class: z.enum(["economy", "business"]),
        fare_class: z.enum(["saver", "standard", "flex"]),
        total_amount: z.string().regex(/^\d+\.\d{2}$/),
        total_currency: z.literal("USD"),
        available_seats: z.number().int().nonnegative(),
        slices: z.array(
          z.object({
            origin: z.object({ iata_code: z.string().length(3) }),
            destination: z.object({ iata_code: z.string().length(3) }),
            segments: z
              .array(
                z.object({
                  id: z.string().min(1),
                  departing_at: z.iso.datetime(),
                  arriving_at: z.iso.datetime(),
                  marketing_carrier: z.object({ id: z.string().min(1) }),
                  marketing_carrier_flight_number: z.string().regex(/^\d{1,4}$/),
                }),
              )
              .length(1),
          }),
        ),
      }),
    ),
  }),
});
const orderSchema = z.object({
  data: z.object({
    id: z.string().startsWith("ord_"),
    type: z.enum(["instant", "hold"]),
    selected_offers: z.array(z.string()).length(1),
    flight_id: z.string().min(1),
    cabin_class: z.enum(["economy", "business"]),
    passengers: z.number().int().positive(),
    total_currency: z.literal("USD"),
    total_amount: z.string().regex(/^\d+\.\d{2}$/),
    payment_status: z.object({
      awaiting_payment: z.boolean(),
      payment_required_by: z.string().nullable(),
      paid_at: z.string().nullable(),
      price_guarantee_expires_at: z.string().nullable(),
    }),
  }),
});
const logSchema = z.object({
  data: z.array(
    z.object({
      kind: z.enum(["service", "control", "webhook"]),
      route: z.string(),
      time: z.number(),
      status: z.number(),
    }),
  ),
});
const searchBody = {
  data: {
    slices: [{ origin: "LHR", destination: "AMS", departure_date: "2027-01-15" }],
    passengers: [{ type: "adult" }],
    cabin_class: "economy",
  },
};
const running: { stop: AbortController; closed: Promise<unknown> }[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) {
    app.stop.abort();
    await app.closed;
  }
});
async function start(supplier: "supplier-a" | "supplier-b" = "supplier-a", holdMs = 1000) {
  const stop = new AbortController();
  const app = await startSupplier({
    supplier,
    port: 0,
    host: "127.0.0.1",
    controlToken: "grader",
    signal: stop.signal,
    holdMs,
  });
  running.push({ stop, closed: app.closed });
  return app.url;
}
async function post(url: string, path: string, body: unknown) {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer grader" },
    body: JSON.stringify(body),
  });
}
async function search(url: string) {
  const response = await post(url, "/air/offer_requests", searchBody);
  const body = offersSchema.parse(await response.json());
  expect(response.status).toBe(201);
  return body.data.offers;
}

test("search returns data flights shared by suppliers A and B", async () => {
  const a = await start();
  const b = await start("supplier-b");
  const offers = await search(a);
  const other = await search(b);
  expect(offers.length).toBeGreaterThan(0);
  expect(offers.some((offer) => other.some((entry) => entry.flight_id === offer.flight_id))).toBe(
    true,
  );
  expect(
    offers.every(
      (offer) =>
        offer.slices.at(0)?.origin.iata_code === "LHR" &&
        offer.slices.at(0)?.destination.iata_code === "AMS",
    ),
  ).toBe(true);
});

test("only one of two parallel orders takes the last seat", async () => {
  const url = await start();
  await post(url, "/control/scenario", { name: "last-seat" });
  const offer = (await search(url)).at(0)!;
  const body = { data: { selected_offers: [offer.id], type: "instant" } };
  const responses = await Promise.all([
    post(url, "/air/orders", body),
    post(url, "/air/orders", body),
  ]);
  expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
  const lost = responses.find((response) => response.status === 409)!;
  expect(await lost.json()).toMatchObject({ errors: [{ code: "offer_sold_out" }] });
});

test("an expired hold frees its seat on the service clock", async () => {
  const url = await start();
  await post(url, "/control/scenario", { name: "last-seat" });
  await post(url, "/control/clock", { now: 10000 });
  const offer = (await search(url)).at(0)!;
  const held = orderSchema.parse(
    await (
      await post(url, "/air/orders", { data: { selected_offers: [offer.id], type: "hold" } })
    ).json(),
  );
  expect(held.data.payment_status.payment_required_by).toBe("1970-01-01T00:00:11.000Z");
  await post(url, "/control/clock", { advanceMs: 1000 });
  const expired = await (await fetch(`${url}/air/orders/${held.data.id}`)).json();
  expect(expired).toMatchObject({
    data: { payment_status: { awaiting_payment: false, paid_at: null } },
  });
  const payment = await post(url, "/air/payments", {
    data: {
      order_id: held.data.id,
      payment: { amount: held.data.total_amount, currency: "USD", type: "balance" },
    },
  });
  expect(payment.status).toBe(409);
  expect(await payment.json()).toEqual({
    errors: [{ type: "invalid_request_error", code: "order_expired", title: "order_expired" }],
  });
  expect(
    (await post(url, "/air/orders", { data: { selected_offers: [offer.id], type: "instant" } }))
      .status,
  ).toBe(201);
});

test("price changes make a searched offer stale", async () => {
  const url = await start();
  const offer = (await search(url)).at(0)!;
  await post(url, "/control/flights", {
    flight_id: offer.flight_id,
    cabin_class: "economy",
    amount_cents: 1,
  });
  expect(await (await fetch(`${url}/air/offers/${offer.id}`)).json()).toMatchObject({
    data: { total_amount: "0.01" },
  });
  const response = await post(url, "/air/orders", {
    data: { selected_offers: [offer.id], type: "instant" },
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ errors: [{ code: "offer_price_changed" }] });
});

test("a paid hold keeps its seat after the hold time", async () => {
  const url = await start();
  await post(url, "/control/scenario", { name: "last-seat" });
  await post(url, "/control/clock", { now: 10000 });
  const offer = (await search(url)).at(0)!;
  const held = orderSchema.parse(
    await (
      await post(url, "/air/orders", { data: { selected_offers: [offer.id], type: "hold" } })
    ).json(),
  );
  const payment = await post(url, "/air/payments", {
    data: {
      order_id: held.data.id,
      payment: { amount: held.data.total_amount, currency: "USD", type: "balance" },
    },
  });
  expect(payment.status).toBe(201);
  await post(url, "/control/clock", { advanceMs: 1001 });
  const response = await post(url, "/air/orders", {
    data: { selected_offers: [offer.id], type: "instant" },
  });
  expect(response.status).toBe(409);
});

test("the call log counts a delayed call before it ends and records its final status", async () => {
  const url = await start();
  await post(url, "/control/clock", { now: 10000 });
  await post(url, "/control/routes", {
    route: "POST /air/offer_requests",
    delayMs: 500,
    status: 503,
  });
  const pending = post(url, "/air/offer_requests", searchBody);
  await expect
    .poll(async () => {
      const log = logSchema.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.some(
        (call) => call.route === "POST /air/offer_requests" && call.status === 0,
      );
    })
    .toBe(true);
  await post(url, "/control/clock", { advanceMs: 500 });
  expect((await pending).status).toBe(503);
  const log = logSchema.parse(
    await (
      await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
    ).json(),
  );
  expect(log.data.filter((call) => call.route === "POST /air/offer_requests")).toEqual([
    { kind: "service", route: "POST /air/offer_requests", time: 10000, status: 503 },
  ]);
});

test("control can repeat a route reply without taking another seat", async () => {
  const url = await start();
  await post(url, "/control/scenario", { name: "last-seat" });
  const rule = await post(url, "/control/routes", { route: "POST /air/orders", repeat: 2 });
  expect(await rule.json()).toEqual({ data: { route: "POST /air/orders", delayMs: 0, repeat: 2 } });
  const offer = (await search(url)).at(0)!;
  const body = { data: { selected_offers: [offer.id], type: "instant" } };
  const first = await (await post(url, "/air/orders", body)).json();
  expect(await (await post(url, "/air/orders", body)).json()).toEqual(first);
  expect(await (await post(url, "/air/orders", body)).json()).toEqual(first);
  expect((await post(url, "/air/orders", body)).status).toBe(409);
});

test("control needs the grader token", async () => {
  const url = await start();
  const response = await fetch(`${url}/control/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "last-seat" }),
  });
  expect(response.status).toBe(401);
});

test("holds expire on real time before the grader sets a clock", async () => {
  const url = await start("supplier-a", 5);
  const offer = (await search(url)).at(0)!;
  const held = orderSchema.parse(
    await (
      await post(url, "/air/orders", { data: { selected_offers: [offer.id], type: "hold" } })
    ).json(),
  );
  await expect
    .poll(async () => {
      const current = orderSchema.parse(
        await (await fetch(`${url}/air/orders/${held.data.id}`)).json(),
      );
      return current.data.payment_status.awaiting_payment;
    })
    .toBe(false);
});

test("the grader can change a loaded flight before its first search", async () => {
  const url = await start();
  const flightId = "1756-LHR-AMS-2027-01-15-1";
  const changed = await post(url, "/control/flights", {
    flight_id: flightId,
    cabin_class: "economy",
    seats: 0,
  });
  expect(changed.status).toBe(200);
  expect((await search(url)).some((offer) => offer.flight_id === flightId)).toBe(false);
  expect(
    (
      await post(url, "/control/flights", {
        flight_id: "missing-flight",
        cabin_class: "economy",
        seats: 1,
      })
    ).status,
  ).toBe(404);
});

test("a business group pays its fare for each passenger and uses only that cabin", async () => {
  const url = await start();
  const economy = (await search(url)).at(0)!;
  await post(url, "/control/flights", {
    flight_id: economy.flight_id,
    cabin_class: "business",
    fare_class: "flex",
    seats: 2,
    amount_cents: 12345,
  });
  const response = await post(url, "/air/offer_requests", {
    data: {
      ...searchBody.data,
      cabin_class: "business",
      passengers: [{ type: "adult" }, { type: "child" }],
    },
  });
  const offers = offersSchema.parse(await response.json()).data.offers;
  const offer = offers.find(
    (entry) => entry.flight_id === economy.flight_id && entry.fare_class === "flex",
  )!;
  expect(offer).toMatchObject({
    cabin_class: "business",
    available_seats: 2,
    total_amount: "123.45",
  });
  const booked = await post(url, "/air/orders", {
    data: {
      selected_offers: [offer.id],
      type: "instant",
      passengers: [{ id: "adult" }, { id: "child" }],
    },
  });
  expect(booked.status).toBe(201);
  const order = orderSchema.parse(await booked.json()).data;
  expect(order).toMatchObject({
    type: "instant",
    payment_status: { awaiting_payment: false, paid_at: expect.any(String) },
    selected_offers: [offer.id],
    flight_id: economy.flight_id,
    cabin_class: "business",
    passengers: 2,
    total_amount: "246.90",
    total_currency: "USD",
  });
  expect(order.payment_status.payment_required_by).toBeNull();
  expect(await (await fetch(`${url}/air/offers/${offer.id}`)).json()).toMatchObject({
    data: { available_seats: 0 },
  });
  expect(await (await fetch(`${url}/air/offers/${economy.id}`)).json()).toMatchObject({
    data: { available_seats: economy.available_seats, total_amount: economy.total_amount },
  });
  expect(await (await fetch(`${url}/air/orders/${order.id}`)).json()).toEqual({ data: order });
});

test("search filters the date and the whole group's seat count", async () => {
  const url = await start();
  const first = (await search(url)).at(0)!;
  await post(url, "/control/flights", {
    flight_id: first.flight_id,
    cabin_class: "economy",
    seats: 2,
  });
  const group = await post(url, "/air/offer_requests", {
    data: {
      ...searchBody.data,
      passengers: [{ type: "adult" }, { type: "adult" }, { type: "adult" }],
    },
  });
  expect(
    offersSchema
      .parse(await group.json())
      .data.offers.some((offer) => offer.flight_id === first.flight_id),
  ).toBe(false);
  const nextDay = await post(url, "/air/offer_requests", {
    data: {
      ...searchBody.data,
      slices: [{ origin: "LHR", destination: "AMS", departure_date: "2027-01-16" }],
    },
  });
  const offers = offersSchema.parse(await nextDay.json()).data.offers;
  expect(offers.length).toBeGreaterThan(0);
  expect(
    offers.every((offer) =>
      offer.slices.every((slice) =>
        slice.segments.every((segment) => segment.departing_at.startsWith("2027-01-16")),
      ),
    ),
  ).toBe(true);
  expect(
    offers.every((offer) =>
      offer.slices.every((slice) =>
        slice.segments.every(
          (segment) => Date.parse(segment.arriving_at) > Date.parse(segment.departing_at),
        ),
      ),
    ),
  ).toBe(true);
  const missing = await post(url, "/air/offer_requests", {
    data: { slices: [{ origin: "ZZZ", destination: "AMS", departure_date: "2027-01-15" }] },
  });
  expect(offersSchema.parse(await missing.json()).data.offers).toEqual([]);
});

test("bad supplier requests return a named Duffel error", async () => {
  const url = await start();
  const cases = [
    { path: "/air/offer_requests", body: {}, status: 400, code: "invalid_offer_request" },
    {
      path: "/air/offer_requests",
      body: { data: { ...searchBody.data, slices: [] } },
      status: 400,
      code: "invalid_offer_request",
    },
    { path: "/air/orders", body: {}, status: 400, code: "invalid_order" },
    {
      path: "/air/orders",
      body: { data: { selected_offers: ["missing"], type: "instant" } },
      status: 404,
      code: "offer_not_found",
    },
    { path: "/air/payments", body: {}, status: 400, code: "invalid_payment" },
    {
      path: "/air/payments",
      body: {
        data: {
          order_id: "missing",
          payment: { amount: "1.00", currency: "USD", type: "balance" },
        },
      },
      status: 404,
      code: "order_not_found",
    },
  ];
  for (const entry of cases) {
    const response = await post(url, entry.path, entry.body);
    expect(response.status).toBe(entry.status);
    expect(await response.json()).toEqual({
      errors: [{ type: "invalid_request_error", code: entry.code, title: entry.code }],
    });
  }
  const broken = await fetch(`${url}/air/offer_requests`, { method: "POST", body: "{" });
  expect(broken.status).toBe(400);
  expect(await broken.json()).toEqual({
    errors: [
      {
        type: "invalid_request_error",
        code: "invalid_offer_request",
        title: "invalid_offer_request",
      },
    ],
  });
  expect((await fetch(`${url}/air/offers/missing`)).status).toBe(404);
  expect((await fetch(`${url}/air/orders/missing`)).status).toBe(404);
  expect((await fetch(`${url}/unknown`)).status).toBe(404);
});

test("a hold accepts only its exact amount and keeps its payment fields", async () => {
  const url = await start();
  await post(url, "/control/clock", { now: 10000 });
  const offer = (await search(url)).at(0)!;
  const held = orderSchema.parse(
    await (
      await post(url, "/air/orders", { data: { selected_offers: [offer.id], type: "hold" } })
    ).json(),
  ).data;
  const wrong = await post(url, "/air/payments", {
    data: { order_id: held.id, payment: { amount: "0.01", currency: "USD", type: "balance" } },
  });
  expect(wrong.status).toBe(400);
  expect(await wrong.json()).toEqual({
    errors: [
      { type: "invalid_request_error", code: "incorrect_amount", title: "incorrect_amount" },
    ],
  });
  const paid = await post(url, "/air/payments", {
    data: {
      order_id: held.id,
      payment: { amount: held.total_amount, currency: "USD", type: "balance" },
    },
  });
  expect(paid.status).toBe(201);
  expect(await paid.json()).toMatchObject({
    data: {
      id: expect.stringMatching(/^pay_/),
      order_id: held.id,
      amount: held.total_amount,
      currency: "USD",
    },
  });
  expect(await (await fetch(`${url}/air/orders/${held.id}`)).json()).toMatchObject({
    data: { payment_status: { awaiting_payment: false, paid_at: "1970-01-01T00:00:10.000Z" } },
  });
});

test("a scenario reset restores stock and clears quotes, orders, route rules and calls", async () => {
  const url = await start();
  await post(url, "/control/clock", { now: 10000 });
  const offer = (await search(url)).at(0)!;
  const booked = orderSchema.parse(
    await (
      await post(url, "/air/orders", { data: { selected_offers: [offer.id], type: "instant" } })
    ).json(),
  ).data;
  await post(url, "/control/flights", {
    flight_id: offer.flight_id,
    cabin_class: "economy",
    seats: 0,
    amount_cents: 1,
  });
  await post(url, "/control/routes", { route: "POST /air/offer_requests", status: 503 });
  const reset = await post(url, "/control/scenario", { name: "default" });
  expect(reset.status).toBe(200);
  expect(await reset.json()).toEqual({ data: { name: "default" } });
  const log = logSchema.parse(
    await (
      await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
    ).json(),
  );
  expect(log.data.filter((call) => call.status !== 0)).toEqual([]);
  expect(log.data.every((call) => call.kind === "control")).toBe(true);
  expect((await fetch(`${url}/air/offers/${offer.id}`)).status).toBe(404);
  expect((await fetch(`${url}/air/orders/${booked.id}`)).status).toBe(404);
  expect(
    (await search(url)).find(
      (entry) => entry.flight_id === offer.flight_id && entry.fare_class === offer.fare_class,
    ),
  ).toMatchObject({ total_amount: offer.total_amount, available_seats: offer.available_seats });
});

test("the grader rejects bad flight, route, scenario and clock changes", async () => {
  const url = await start();
  const cases = [
    { path: "/control/flights", body: { seats: -1 }, code: "invalid_flight_change" },
    { path: "/control/scenario", body: { name: "missing" }, code: "invalid_scenario" },
    {
      path: "/control/routes",
      body: { route: "POST /air/orders", status: 399 },
      code: "invalid_route_rule",
    },
    {
      path: "/control/routes",
      body: { route: "POST /air/orders", status: 600 },
      code: "invalid_route_rule",
    },
    { path: "/control/clock", body: { advanceMs: -1 }, code: "invalid_clock" },
  ];
  for (const entry of cases) {
    const response = await post(url, entry.path, entry.body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      errors: [{ type: "invalid_request_error", code: entry.code, title: entry.code }],
    });
  }
  const unknown = await post(url, "/control/missing", {});
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({
    errors: [{ type: "invalid_request_error", code: "not_found", title: "not_found" }],
  });
  const clock = await post(url, "/control/clock", { now: 10000 });
  expect(await clock.json()).toEqual({ data: { now: 10000 } });
  expect(await (await post(url, "/control/clock", { advanceMs: 500 })).json()).toEqual({
    data: { now: 10500 },
  });
});

test("an expired hold does not undo a later grader seat edit", async () => {
  const url = await start();
  await post(url, "/control/clock", { now: 10000 });
  const offer = (await search(url)).at(0)!;
  await post(url, "/air/orders", { data: { selected_offers: [offer.id], type: "hold" } });
  await post(url, "/control/clock", { advanceMs: 1000 });
  const changed = await post(url, "/control/flights", {
    flight_id: offer.flight_id,
    cabin_class: "economy",
    seats: 0,
  });
  expect(changed.status).toBe(200);
  expect((await search(url)).some((entry) => entry.flight_id === offer.flight_id)).toBe(false);
});

test("stopping a service ends its virtual waits and closes its HTTP port", async () => {
  const url = await start();
  await post(url, "/control/clock", { now: 10000 });
  await post(url, "/control/routes", { route: "POST /air/offer_requests", delayMs: 1000 });
  const pending = post(url, "/air/offer_requests", searchBody).then(
    (response) => response.status,
    () => 0,
  );
  await expect
    .poll(async () => {
      const log = logSchema.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.some(
        (call) => call.route === "POST /air/offer_requests" && call.status === 0,
      );
    })
    .toBe(true);
  const app = running.at(-1)!;
  app.stop.abort();
  expect(await app.closed).toMatchObject({ status: "success" });
  await pending;
  await expect(fetch(`${url}/air/offers/missing`)).rejects.toThrow();
});

test("advancing before setting a clock starts a test clock from real time", async () => {
  const url = await start();
  const before = Date.now();
  const first = z
    .object({ data: z.object({ now: z.number() }) })
    .parse(await (await post(url, "/control/clock", { advanceMs: 1000 })).json()).data.now;
  expect(first).toBeGreaterThanOrEqual(before + 1000);
  expect(first).toBeLessThanOrEqual(Date.now() + 1000);
  expect(await (await post(url, "/control/clock", { advanceMs: 1000 })).json()).toEqual({
    data: { now: first + 1000 },
  });
  await post(url, "/control/clock", { now: first + 5000 });
  expect(await (await post(url, "/control/clock", { advanceMs: 1 })).json()).toEqual({
    data: { now: first + 5001 },
  });
});

test("a delayed call cannot restore a replaced route rule", async () => {
  const url = await start();
  await post(url, "/control/clock", { now: 10000 });
  await post(url, "/control/routes", {
    route: "POST /air/offer_requests",
    delayMs: 100,
    status: 503,
  });
  const pending = post(url, "/air/offer_requests", searchBody);
  await expect
    .poll(async () => {
      const log = logSchema.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter(
        (call) => call.route === "POST /air/offer_requests" && call.status === 0,
      ).length;
    })
    .toBe(1);
  await post(url, "/control/routes", { route: "POST /air/offer_requests", status: 502 });
  await post(url, "/control/clock", { advanceMs: 100 });
  await pending;
  const next = post(url, "/air/offer_requests", searchBody);
  await expect
    .poll(async () => {
      const log = logSchema.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter((call) => call.route === "POST /air/offer_requests").length;
    })
    .toBe(2);
  await post(url, "/control/clock", { advanceMs: 100 });
  expect((await next).status).toBe(502);
});

test("parallel delayed calls consume only the chosen number of repeats", async () => {
  const url = await start();
  await post(url, "/control/scenario", { name: "last-seat" });
  await post(url, "/control/clock", { now: 10000 });
  const offer = (await search(url)).at(0)!;
  await post(url, "/control/routes", { route: "POST /air/orders", delayMs: 100, repeat: 1 });
  const body = { data: { selected_offers: [offer.id], type: "instant" } };
  const first = post(url, "/air/orders", body);
  await expect
    .poll(async () => {
      const log = logSchema.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter((call) => call.route === "POST /air/orders" && call.status === 0)
        .length;
    })
    .toBe(1);
  await post(url, "/control/clock", { advanceMs: 100 });
  expect((await first).status).toBe(201);
  const a = post(url, "/air/orders", body);
  const b = post(url, "/air/orders", body);
  await expect
    .poll(async () => {
      const log = logSchema.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter((call) => call.route === "POST /air/orders" && call.status === 0)
        .length;
    })
    .toBe(2);
  await post(url, "/control/clock", { advanceMs: 100 });
  expect(
    (await Promise.all([a, b])).map((response) => response.status).sort((a, b) => a - b),
  ).toEqual([201, 409]);
});

test("a call finishing after reset cannot return to the new call log", async () => {
  const url = await start();
  await post(url, "/control/clock", { now: 10000 });
  await post(url, "/control/routes", {
    route: "POST /air/offer_requests",
    delayMs: 100,
    status: 503,
  });
  const pending = post(url, "/air/offer_requests", searchBody);
  await expect
    .poll(async () => {
      const log = logSchema.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.some((call) => call.route === "POST /air/offer_requests");
    })
    .toBe(true);
  await post(url, "/control/scenario", { name: "default" });
  await post(url, "/control/clock", { advanceMs: 100 });
  await pending;
  const log = logSchema.parse(
    await (
      await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
    ).json(),
  );
  expect(log.data.filter((call) => call.route === "POST /air/offer_requests")).toEqual([]);
});

test("only an unpaid hold can accept a payment", async () => {
  const url = await start();
  await post(url, "/control/clock", { now: 10000 });
  const offer = (await search(url)).at(0)!;
  for (const type of ["hold", "instant"]) {
    const booked = orderSchema.parse(
      await (
        await post(url, "/air/orders", { data: { selected_offers: [offer.id], type } })
      ).json(),
    ).data;
    const body = {
      data: {
        order_id: booked.id,
        payment: { type: "balance", amount: booked.total_amount, currency: "USD" },
      },
    };
    if (type === "hold") expect((await post(url, "/air/payments", body)).status).toBe(201);
    const response = await post(url, "/air/payments", body);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      errors: [
        {
          type: "invalid_request_error",
          code: "order_not_awaiting_payment",
          title: "order_not_awaiting_payment",
        },
      ],
    });
  }
});

test("stored offer count and state bytes stay bounded after many searches", async () => {
  const url = await start();
  const count = (await search(url)).length;
  for (let i = 0; i < Math.ceil(1024 / count); i++) await search(url);
  const schema = z.object({ data: z.object({ offers: z.number(), bytes: z.number() }) });
  const before = schema.parse(
    await (
      await fetch(`${url}/control/state`, { headers: { authorization: "Bearer grader" } })
    ).json(),
  ).data;
  for (let i = 0; i < 200; i++) await search(url);
  const after = schema.parse(
    await (
      await fetch(`${url}/control/state`, { headers: { authorization: "Bearer grader" } })
    ).json(),
  ).data;
  expect(after).toEqual({ offers: 1024, bytes: before.bytes });
});
