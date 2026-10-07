import { createScope, extension, operation, resource, tag, type Observe } from "@tinker/core";
import { z } from "zod";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  supplierApp,
  paymentApp,
  supplierId,
  port,
  host,
  controlToken,
  stopSignal,
  webhookUrl,
  webhookSecret,
} from "../src/index";

/** The real graph rejects a missing driver; no HTTP code or globals are patched. */
const unavailable = tag<string>({ label: "unavailable routing driver" });
const failedDriver = operation({
  label: "failed routing driver",
  depends: { unavailable },
  run({ unavailable }) {
    return unavailable;
  },
});
const failures = resource({
  label: "routing failure fixture",
  factory: () => ({ remaining: 0 }),
});
const failingCalls = extension({
  label: "routing failure driver",
  hooks: {
    run(event) {
      if (event.op.label === "create payment intent" || event.op.label === "read supplier offer") {
        const fault = event.resolve(failures);
        if (fault.remaining > 0) {
          fault.remaining--;
          return event.run(failedDriver);
        }
      }
      return event.next();
    },
  },
});

const logSchema = z.object({
  data: z.array(z.object({ route: z.string(), status: z.number() })),
});
const offersSchema = z.object({
  data: z.object({ offers: z.array(z.object({ id: z.string() })).nonempty() }),
});

async function post(url: string, path: string, body: unknown) {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { authorization: "Bearer grader", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const running: {
  stop: AbortController;
  closed: Promise<unknown>;
  url: string;
  name: string;
  fault: { remaining: number };
  logs: Observe.Log[];
}[] = [];
beforeEach(async () => {
  for (const app of [supplierApp, paymentApp]) {
    const stop = new AbortController();
    const logs: Observe.Log[] = [];
    const scope = createScope({
      signal: stop.signal,
      extensions: [failingCalls, app],
      observe: { log: (entry) => logs.push(entry) },
      tags: [
        supplierId("supplier-a"),
        port(0),
        host("127.0.0.1"),
        controlToken("grader"),
        stopSignal(stop.signal),
        webhookUrl("http://127.0.0.1:1"),
        webhookSecret("routing-test"),
      ],
    });
    await scope.ready;
    const { url } = scope.resolve(app);
    running.push({
      stop,
      closed: scope.closed,
      url,
      name: app === supplierApp ? "supplier" : "payment",
      fault: scope.resolve(failures),
      logs,
    });
  }
});
afterEach(async () => {
  for (const service of running.splice(0)) {
    service.stop.abort();
    await service.closed;
  }
});

test("route rules reject a missing route even when the body has a name", async () => {
  for (const { url } of running) {
    const response = await fetch(`${url}/control/routes`, {
      method: "POST",
      headers: { authorization: "Bearer grader", "content-type": "application/json" },
      body: JSON.stringify({ name: "POST /air/orders", status: 503 }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      errors: [
        { type: "invalid_request_error", code: "invalid_route_rule", title: "invalid_route_rule" },
      ],
    });
  }
});

test("both services return a Duffel error for a missing control route", async () => {
  for (const { url } of running) {
    const response = await fetch(`${url}/control/missing`, {
      headers: { authorization: "Bearer grader" },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      errors: [{ type: "invalid_request_error", code: "not_found", title: "not_found" }],
    });
  }
});

test("HEAD calls keep the missing-route reply", async () => {
  for (const { url } of running) {
    const response = await fetch(`${url}/control/calls`, {
      method: "HEAD",
      headers: { authorization: "Bearer grader" },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("transfer-encoding")).toBeNull();
  }
});

test("a control clock rewind cannot restore an expired offer", async () => {
  const { url } = running.find((service) => service.name === "supplier")!;
  const start = await post(url, "/control/clock", { now: 1_000_000 });
  expect(start.status).toBe(200);
  await start.arrayBuffer();
  const search = await post(url, "/air/offer_requests", {
    data: {
      slices: [{ origin: "LHR", destination: "AMS", departure_date: "2027-01-15" }],
    },
  });
  expect(search.status).toBe(201);
  const { data } = offersSchema.parse(await search.json());
  for (const now of [1_000_000 + 31 * 60_000, 1_000_000]) {
    const clock = await post(url, "/control/clock", { now });
    expect(clock.status).toBe(200);
    await clock.arrayBuffer();
  }
  const response = await fetch(`${url}/air/offers/${data.offers[0].id}`);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    errors: [{ type: "invalid_request_error", code: "offer_not_found", title: "offer_not_found" }],
  });
});

test("a thrown payment handler lets the same key retry", async () => {
  const service = running.find((service) => service.name === "payment")!;
  service.fault.remaining = 1;
  const params = {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "retry-failed-handler" },
    body: JSON.stringify({ amount: 900, currency: "usd" }),
  };
  const failed = await fetch(`${service.url}/v1/payment_intents`, params);
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({
    error: { type: "invalid_request_error", code: "internal_error", message: "internal_error" },
  });
  expect(service.logs.find((entry) => entry.message === "HTTP request failed")).toMatchObject({
    attributes: { error: { kind: "MissingTag", payload: { label: "unavailable routing driver" } } },
  });
  const retried = await fetch(`${service.url}/v1/payment_intents`, params);
  expect(retried.status).toBe(200);
  expect(retried.headers.get("Idempotent-Replayed")).toBeNull();
  expect(await retried.json()).toMatchObject({ amount: 900, currency: "usd" });
});

test("an empty offer ID keeps the offer_not_found reply", async () => {
  const { url } = running.find((service) => service.name === "supplier")!;
  const response = await fetch(`${url}/air/offers/`);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    errors: [{ type: "invalid_request_error", code: "offer_not_found", title: "offer_not_found" }],
  });
});

test("a deep offer path keeps the offer_not_found reply", async () => {
  const { url } = running.find((service) => service.name === "supplier")!;
  const response = await fetch(`${url}/air/offers/a/b`);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    errors: [{ type: "invalid_request_error", code: "offer_not_found", title: "offer_not_found" }],
  });
});

test("call logs keep percent encoded paths", async () => {
  for (const { url, name } of running) {
    const path = name === "supplier" ? "/air/offers/off%201_x" : "/v1/payment_intents/pi%201_x";
    await (await fetch(`${url}${path}`)).arrayBuffer();
    const log = logSchema.parse(
      await (
        await fetch(`${url}/control/calls`, {
          headers: { authorization: "Bearer grader" },
        })
      ).json(),
    );
    expect(log.data.some((call) => call.route === `GET ${path}`)).toBe(true);
  }
});

test("route rules keep percent encoded keys", async () => {
  for (const { url, name } of running) {
    const path = name === "supplier" ? "/air/offers/off%201_x" : "/v1/payment_intents/pi%201_x";
    await (
      await fetch(`${url}/control/routes`, {
        method: "POST",
        headers: { authorization: "Bearer grader", "content-type": "application/json" },
        body: JSON.stringify({ route: `GET ${path}`, status: 503 }),
      })
    ).arrayBuffer();
    const response = await fetch(`${url}${path}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(
      name === "supplier"
        ? {
            errors: [
              {
                type: "invalid_request_error",
                code: "injected_failure",
                title: "injected_failure",
              },
            ],
          }
        : {
            error: {
              type: "invalid_request_error",
              code: "injected_failure",
              message: "injected_failure",
            },
          },
    );
  }
});

test("a thrown handler leaves the call log status at zero", async () => {
  for (const service of running) {
    service.fault.remaining = 1;
    const path = service.name === "supplier" ? "/air/offers/missing" : "/v1/payment_intents";
    const method = service.name === "supplier" ? "GET" : "POST";
    const response = await fetch(`${service.url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ amount: 900, currency: "usd" }) } : {}),
    });
    expect(response.status).toBe(500);
    await response.arrayBuffer();
    const log = logSchema.parse(
      await (
        await fetch(`${service.url}/control/calls`, {
          headers: { authorization: "Bearer grader" },
        })
      ).json(),
    );
    expect(log.data.find((call) => call.route === `${method} ${path}`)?.status).toBe(0);
  }
});

test("a thrown handler cannot seed a route replay", async () => {
  const service = running.find((service) => service.name === "supplier")!;
  await (
    await fetch(`${service.url}/control/routes`, {
      method: "POST",
      headers: { authorization: "Bearer grader", "content-type": "application/json" },
      body: JSON.stringify({ route: "GET /air/offers/missing", repeat: 1 }),
    })
  ).arrayBuffer();
  service.fault.remaining = 1;
  const failed = await fetch(`${service.url}/air/offers/missing`);
  expect(failed.status).toBe(500);
  await failed.arrayBuffer();
  const retried = await fetch(`${service.url}/air/offers/missing`);
  expect(retried.status).toBe(404);
  expect(await retried.json()).toEqual({
    errors: [{ type: "invalid_request_error", code: "offer_not_found", title: "offer_not_found" }],
  });
});

test.each([{ now: -1 }, { advanceMs: -1 }, { now: 1.5 }, { advanceMs: "10" }, {}])(
  "both services reject invalid clock settings %j with a Duffel body",
  async (body) => {
    for (const { url } of running) {
      const response = await post(url, "/control/clock", body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        errors: [{ type: "invalid_request_error", code: "invalid_clock", title: "invalid_clock" }],
      });
    }
  },
);

test("route faults cannot intercept the control clock", async () => {
  for (const { url } of running) {
    await (
      await post(url, "/control/routes", {
        route: "POST /control/clock",
        status: 503,
        repeat: 1,
      })
    ).arrayBuffer();
    const response = await post(url, "/control/clock", { now: 10000 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { now: 10000 } });
  }
});

test("HEAD on an existing public route still returns 404 without a body", async () => {
  for (const { url, name } of running) {
    let path: string;
    if (name === "payment") {
      const response = await post(url, "/v1/payment_intents", { amount: 900, currency: "usd" });
      const intent = z.object({ id: z.string() }).parse(await response.json());
      path = `/v1/payment_intents/${intent.id}`;
    } else {
      const response = await post(url, "/air/offer_requests", {
        data: { slices: [{ origin: "LHR", destination: "AMS", departure_date: "2027-01-15" }] },
      });
      const { data } = offersSchema.parse(await response.json());
      path = `/air/offers/${data.offers[0].id}`;
    }
    const response = await fetch(`${url}${path}`, { method: "HEAD" });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    const read = await fetch(`${url}${path}`);
    expect(read.status).toBe(200);
    await read.arrayBuffer();
  }
});

test("JSON without a content type still reaches the payment operation", async () => {
  const { url } = running.find((service) => service.name === "payment")!;
  const response = await fetch(`${url}/v1/payment_intents`, {
    method: "POST",
    body: JSON.stringify({ amount: 901, currency: "usd" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ amount: 901, currency: "usd" });
});

test("the payment-failed scenario finishes its confirmation and sends a valid webhook", async () => {
  const service = running.find((service) => service.name === "payment")!;
  const { url } = service;
  await (await post(url, "/control/clock", { now: 10000 })).arrayBuffer();
  await (await post(url, "/control/scenario", { name: "payment-failed" })).arrayBuffer();
  const created = await post(url, "/v1/payment_intents", { amount: 901, currency: "usd" });
  const intent = z.object({ id: z.string() }).parse(await created.json());
  await (await post(url, `/v1/payment_intents/${intent.id}/confirm`, {})).arrayBuffer();
  await (await post(url, "/control/clock", { advanceMs: 20 })).arrayBuffer();
  await expect
    .poll(async () => {
      const response = await fetch(`${url}/v1/payment_intents/${intent.id}`);
      return z.object({ status: z.string() }).parse(await response.json()).status;
    })
    .toBe("requires_payment_method");
  await expect
    .poll(() => service.logs.filter((entry) => entry.message === "webhook delivery failed").length)
    .toBe(1);
});
