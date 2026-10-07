import { createScope, extension, isError, operation, type Observe } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  supplierApp,
  paymentApp,
  supplierId,
  controlToken,
  stopSignal,
  webhookUrl,
  webhookSecret,
} from "../src/index";
import { errorShape, web, wireErrors } from "../services/http";

const sessionAudit = extension({
  label: "service session audit",
  hooks: {
    session(event) {
      event.log.info("service session configured", { shape: event.handle.resolve(errorShape) });
      return event.next();
    },
  },
});
/** An upstream Hono plugin owns its flag; the service must bind its own request role after it. */
const upstreamControl = extension({
  label: "upstream control middleware",
  hooks: {
    async start({ scope, next }) {
      scope.resolve(web).use("*", async (c, next) => {
        c.set("control", true);
        await next();
      });
      await next();
    },
  },
});
const services = [
  { name: "supplier", app: supplierApp, shape: "duffel" },
  { name: "payment", app: paymentApp, shape: "stripe" },
];
const requiredSettings = [
  { setting: wireErrors, label: "service wire errors" },
  { setting: errorShape, label: "service error shape" },
  { setting: stopSignal, label: "service stop signal" },
  { setting: controlToken, label: "control token" },
  { setting: webhookUrl, label: "webhook URL" },
  { setting: webhookSecret, label: "webhook secret" },
];
const sharedSpans = [
  "service Hono app",
  "shared HTTP requests",
  "shared HTTP middleware",
  "shared HTTP control routes",
  "service HTTP listener",
  "service clock",
  "set service time",
  "set route rule",
  "check control token",
  "start HTTP call",
  "save HTTP call status",
  "decode HTTP body",
  "wait for HTTP rule",
  "select HTTP rule",
  "save HTTP rule reply",
  "read HTTP calls",
];
const callLog = z.object({
  data: z.array(z.object({ kind: z.string(), route: z.string(), status: z.number() })),
});

async function post(url: string, path: string, body?: unknown, key?: string) {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer grader",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(key === undefined ? {} : { "idempotency-key": key }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test.each(services)(
  "$name binds its own request role and keeps named HTTP spans and session logs",
  async ({ app, shape }) => {
    const stop = new AbortController();
    const logs: Observe.Log[] = [];
    const scope = createScope({
      signal: stop.signal,
      extensions: [sessionAudit, upstreamControl, app],
      observe: { history: 300, log: (entry) => logs.push(entry) },
      tags: [
        supplierId("supplier-a"),
        controlToken("grader"),
        stopSignal(stop.signal),
        webhookUrl("http://127.0.0.1:1/webhooks/stripe"),
        webhookSecret("observation-test"),
      ],
    });
    try {
      await scope.ready;
      const { url } = scope.resolve(app);
      expect(new URL(url).hostname).toBe("127.0.0.1");
      await (await post(url, "/control/clock", { now: 10000 })).arrayBuffer();
      await (
        await post(url, "/control/routes", { route: "GET /missing", status: 503, repeat: 1 })
      ).arrayBuffer();
      const first = await fetch(`${url}/missing`);
      expect(first.status).toBe(503);
      const body = await first.json();
      const replay = await fetch(`${url}/missing`);
      expect(replay.status).toBe(503);
      expect(await replay.json()).toEqual(body);
      const log = callLog.parse(
        await (
          await fetch(`${url}/control/calls`, {
            headers: { authorization: "Bearer grader" },
          })
        ).json(),
      );
      expect(log.data.filter((call) => call.route === "GET /missing")).toEqual([
        { kind: "service", route: "GET /missing", status: 503 },
        { kind: "service", route: "GET /missing", status: 503 },
      ]);
      expect(logs.filter((entry) => entry.message === "service session configured")).toMatchObject([
        { attributes: { shape } },
      ]);
      expect(
        scope
          .spans()
          .filter((span) => span.status === "ok")
          .map((span) => span.name),
      ).toEqual(expect.arrayContaining(sharedSpans));
    } finally {
      stop.abort();
      await scope.closed;
    }
  },
);

test("payment spans name each step and its failed webhook log keeps the HTTP cause", async () => {
  const stop = new AbortController();
  const logs: Observe.Log[] = [];
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    observe: { history: 500, log: (entry) => logs.push(entry) },
    tags: [
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrl("http://127.0.0.1:1/webhooks/stripe"),
      webhookSecret("observation-test"),
    ],
  });
  try {
    await scope.ready;
    const { url } = scope.resolve(paymentApp);
    await (await post(url, "/control/clock", { now: 10000 })).arrayBuffer();
    const plan = await post(url, "/control/payment");
    expect(await plan.json()).toEqual({
      data: { outcome: "succeeded", mode: "now", delayMs: 1000 },
    });
    const created = await post(
      url,
      "/v1/payment_intents",
      { amount: 900, currency: "usd" },
      "span-key",
    );
    const intent = z.object({ id: z.string() }).parse(await created.json());
    await (await fetch(`${url}/v1/payment_intents/${intent.id}`)).arrayBuffer();
    await (await post(url, `/v1/payment_intents/${intent.id}/confirm`, {})).arrayBuffer();
    const sent = await post(url, "/control/webhooks", { intent_id: intent.id });
    expect(await sent.json()).toEqual({
      data: { intent_id: intent.id, mode: "now", delayMs: 1000 },
    });
    await expect
      .poll(() => logs.filter((entry) => entry.message === "webhook delivery failed").length)
      .toBe(1);
    const failure = logs.find((entry) => entry.message === "webhook delivery failed")!;
    expect(failure.attributes).toMatchObject({
      error: { kind: "HttpRequestFailed", payload: { method: "POST", path: "/webhooks/stripe" } },
    });
    const refunded = await post(url, "/v1/refunds", { payment_intent: intent.id, amount: 10 });
    expect(refunded.status).toBe(200);
    await refunded.arrayBuffer();
    await expect
      .poll(
        () =>
          scope
            .spans()
            .filter((span) => span.name === "wait for payment webhook" && span.status === "ok")
            .length,
      )
      .toBeGreaterThan(0);
    expect(scope.spans().map((span) => span.name)).toEqual(
      expect.arrayContaining([
        "start payment scenario",
        "watch payment intents",
        "choose payment plan",
        "create payment intent",
        "read payment intent",
        "confirm payment intent",
        "choose intent webhook delivery",
        "wait for payment webhook",
        "send payment webhook",
        "deliver signed webhook",
        "signed webhook client",
        "in-flight payment keys",
        "start payment key",
        "save payment key reply",
        "refund payment",
        "http",
        "http.request",
        "http POST /webhooks/stripe",
      ]),
    );
  } finally {
    stop.abort();
    await scope.closed;
  }
});

test.each(requiredSettings)(
  "missing $label names the setting in its public failure",
  async ({ setting, label }) => {
    const stop = new AbortController();
    const needed = operation({
      label: "service configuration consumer",
      depends: { setting },
      run: ({ setting }) => setting,
    });
    const scope = createScope({ signal: stop.signal });
    try {
      const result = scope.settle(needed);
      if (result.status !== "failed") expect.fail("missing configuration must fail");
      if (!isError(result.error, "MissingTag")) throw result.error;
      expect(result.error.payload).toEqual({ label });
    } finally {
      stop.abort();
      await scope.closed;
    }
  },
);
