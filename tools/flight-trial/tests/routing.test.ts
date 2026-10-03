import { createScope } from "@tinker/core";
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

const running: { stop: AbortController; closed: Promise<unknown>; url: string; name: string }[] =
  [];
beforeEach(async () => {
  for (const app of [supplierApp, paymentApp]) {
    const stop = new AbortController();
    const scope = createScope({
      signal: stop.signal,
      extensions: app,
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
