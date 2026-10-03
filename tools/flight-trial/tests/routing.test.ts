import { createScope, extension, operation, resource, tag } from "@tinker/core";
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
