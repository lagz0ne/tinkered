import { createScope, extension, operation, resource, tag } from "@tinker/core";
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
} from "../src/index.ts";

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

const running: {
  stop: AbortController;
  closed: Promise<unknown>;
  url: string;
  name: string;
  fault: { remaining: number };
}[] = [];
beforeEach(async () => {
  for (const app of [supplierApp, paymentApp]) {
    const stop = new AbortController();
    const scope = createScope({
      signal: stop.signal,
      extensions: [failingCalls, app],
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
