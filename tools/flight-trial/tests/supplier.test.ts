import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { startSupplier } from "../src/index.ts";

const offersSchema = z.object({
  data: z.object({
    offers: z.array(
      z.object({
        id: z.string(),
        flight_id: z.string(),
        slices: z.array(
          z.object({
            origin: z.object({ iata_code: z.string() }),
            destination: z.object({ iata_code: z.string() }),
          }),
        ),
      }),
    ),
  }),
});
const orderSchema = z.object({
  data: z.object({
    id: z.string(),
    total_amount: z.string(),
    payment_required_by: z.string().optional(),
    status: z.string(),
  }),
});
const logSchema = z.object({
  data: z.array(z.object({ route: z.string(), time: z.number(), status: z.number() })),
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
  expect(held.data.payment_required_by).toBe("1970-01-01T00:00:11.000Z");
  await post(url, "/control/clock", { advanceMs: 1001 });
  const expired = await (await fetch(`${url}/air/orders/${held.data.id}`)).json();
  expect(expired).toMatchObject({ data: { status: "expired" } });
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
    data: { order_id: held.data.id, amount: held.data.total_amount, currency: "USD" },
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
  expect(log.data).toContainEqual({ route: "POST /air/offer_requests", time: 10000, status: 503 });
});

test("control can repeat a route reply without taking another seat", async () => {
  const url = await start();
  await post(url, "/control/scenario", { name: "last-seat" });
  await post(url, "/control/routes", { route: "POST /air/orders", repeat: 1 });
  const offer = (await search(url)).at(0)!;
  const body = { data: { selected_offers: [offer.id], type: "instant" } };
  const first = await (await post(url, "/air/orders", body)).json();
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
      return current.data.status;
    })
    .toBe("expired");
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
