import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { startPayment } from "../src/index.ts";

const intentSchema = z.object({
  id: z.string().startsWith("pi_"),
  object: z.literal("payment_intent"),
  amount: z.number().int().positive(),
  currency: z.string().regex(/^[a-z]{3}$/),
  status: z.enum(["requires_confirmation", "processing", "succeeded", "requires_payment_method"]),
  metadata: z.record(z.string(), z.string()),
  client_secret: z.string().min(1),
  latest_charge: z.string().nullable(),
});
const secret = "trial-webhook-secret";
const received: { body: string; signature: string }[] = [];
const running: { stop: AbortController; closed: Promise<unknown> }[] = [];
const inbox = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  received.push({ body, signature: String(request.headers["stripe-signature"]) });
  response.end("ok");
});
inbox.listen(0, "127.0.0.1");
await once(inbox, "listening");
const address = inbox.address();
const webhookUrl = `http://127.0.0.1:${typeof address === "object" ? address?.port : 0}`;
afterAll(async () => {
  inbox.closeAllConnections();
  await new Promise<void>((resolve) => inbox.close(() => resolve()));
});
afterEach(async () => {
  for (const app of running.splice(0)) {
    app.stop.abort();
    await app.closed;
  }
  received.length = 0;
});
async function start() {
  const stop = new AbortController();
  const app = await startPayment({
    port: 0,
    host: "127.0.0.1",
    controlToken: "grader",
    signal: stop.signal,
    webhookUrl,
    secret,
  });
  running.push({ stop, closed: app.closed });
  await post(app.url, "/control/clock", { now: 10000 });
  return app.url;
}
async function post(url: string, path: string, body: unknown, key?: string) {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer grader",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function confirm(url: string) {
  const intent = intentSchema.parse(
    await (await post(url, "/v1/payment_intents", { amount: 12300, currency: "usd" })).json(),
  );
  const response = await post(url, `/v1/payment_intents/${intent.id}/confirm`, {});
  const processing = intentSchema.parse(await response.json());
  expect(processing.status).toBe("processing");
  return processing;
}

test("a confirmed intent sends a signed success webhook", async () => {
  const url = await start();
  const intent = await confirm(url);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(1);
  const event = received.at(0)!;
  expect(JSON.parse(event.body)).toMatchObject({
    id: expect.stringMatching(/^evt_/),
    object: "event",
    created: 10,
    type: "payment_intent.succeeded",
    data: { object: { ...intent, status: "succeeded", latest_charge: `ch_${intent.id}` } },
  });
  const timestamp = Number(event.signature.split(",").at(0)!.slice(2));
  expect(Math.abs(Date.now() / 1000 - timestamp)).toBeLessThan(300);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${event.body}`).digest("hex");
  expect(event.signature).toBe(`t=${timestamp},v1=${signature}`);
  expect(await (await fetch(`${url}/v1/payment_intents/${intent.id}`)).json()).toMatchObject({
    status: "succeeded",
  });
});

test("parallel calls with one key return the same intent", async () => {
  const url = await start();
  const body = { amount: 12300, currency: "usd" };
  const responses = await Promise.all([
    post(url, "/v1/payment_intents", body, "same"),
    post(url, "/v1/payment_intents", body, "same"),
  ]);
  expect(await responses.at(0)!.json()).toEqual(await responses.at(1)!.json());
  const replay = await post(url, "/v1/payment_intents", body, "same");
  expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
  const changed = await post(url, "/v1/payment_intents", { amount: 9, currency: "usd" }, "same");
  expect(changed.status).toBe(400);
  expect(await changed.json()).toEqual({
    error: {
      type: "idempotency_error",
      code: "idempotency_key_in_use",
      message: "idempotency_key_in_use",
    },
  });
});

test("a late webhook waits for the chosen time", async () => {
  const url = await start();
  await post(url, "/control/payment", { mode: "late", delayMs: 1000 });
  const intent = await confirm(url);
  await post(url, "/control/clock", { advanceMs: 999 });
  expect(received).toEqual([]);
  expect(await (await fetch(`${url}/v1/payment_intents/${intent.id}`)).json()).toMatchObject({
    status: "processing",
  });
  await post(url, "/control/clock", { advanceMs: 1 });
  await expect.poll(() => received.length).toBe(1);
});

test("twice sends the same signed event twice", async () => {
  const url = await start();
  await post(url, "/control/payment", { mode: "twice" });
  await confirm(url);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(2);
  expect(received.at(0)).toEqual(received.at(1));
  expect(JSON.parse(received.at(0)!.body)).toMatchObject({ type: "payment_intent.succeeded" });
});

test("the failed scenario sends a payment failure webhook", async () => {
  const url = await start();
  await post(url, "/control/scenario", { name: "payment-failed" });
  await confirm(url);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(1);
  expect(JSON.parse(received.at(0)!.body)).toMatchObject({
    type: "payment_intent.payment_failed",
    data: { object: { status: "requires_payment_method", latest_charge: null } },
  });
});

test("never sends nothing until the grader asks for a webhook now", async () => {
  const url = await start();
  await post(url, "/control/payment", { mode: "never" });
  const intent = await confirm(url);
  await post(url, "/control/clock", { advanceMs: 10000 });
  expect(received).toEqual([]);
  await post(url, "/control/webhooks", { intent_id: intent.id, mode: "now" });
  await expect.poll(() => received.length).toBe(1);
});

test("refund keys return the same refund and cannot refund more than paid", async () => {
  const url = await start();
  const intent = await confirm(url);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(1);
  const body = { payment_intent: intent.id };
  const first = await (await post(url, "/v1/refunds", body, "refund-once")).json();
  expect(first).toMatchObject({ object: "refund", amount: 12300, status: "succeeded" });
  expect(await (await post(url, "/v1/refunds", body, "refund-once")).json()).toEqual(first);
  expect((await post(url, "/v1/refunds", body)).status).toBe(400);
});

test("payment accepts Stripe form bodies", async () => {
  const url = await start();
  const response = await fetch(`${url}/v1/payment_intents`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "amount=900&currency=usd&metadata[order_id]=ord_1&metadata[note]=%E2%9C%88&automatic_payment_methods[enabled]=true",
  });
  expect(await response.json()).toMatchObject({
    object: "payment_intent",
    amount: 900,
    currency: "usd",
    metadata: { order_id: "ord_1", note: "✈" },
    automatic_payment_methods: { enabled: true },
  });
});

test("the grader can cancel a pending webhook and send it now", async () => {
  const url = await start();
  const intent = await confirm(url);
  await post(url, "/control/webhooks", { intent_id: intent.id, mode: "never" });
  await post(url, "/control/clock", { advanceMs: 10000 });
  expect(received).toEqual([]);
  expect(await (await fetch(`${url}/v1/payment_intents/${intent.id}`)).json()).toMatchObject({
    status: "processing",
  });
  await post(url, "/control/webhooks", { intent_id: intent.id, mode: "now" });
  await expect.poll(() => received.length).toBe(1);
});

test("an injected payment failure uses Stripe's error shape", async () => {
  const url = await start();
  await post(url, "/control/routes", { route: "POST /v1/payment_intents", status: 503 });
  const response = await post(url, "/v1/payment_intents", { amount: 900, currency: "usd" });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: { type: "invalid_request_error", code: "injected_failure", message: "injected_failure" },
  });
});

test("repeated confirmation keeps one delivery and a key keeps its original reply", async () => {
  const url = await start();
  const body = { amount: 1200, currency: "USD" };
  const first = intentSchema.parse(
    await (await post(url, "/v1/payment_intents", body, "create-once")).json(),
  );
  expect(first).toMatchObject({
    amount: 1200,
    currency: "usd",
    status: "requires_confirmation",
    latest_charge: null,
    client_secret: `${first.id}_secret_trial`,
  });
  const path = `/v1/payment_intents/${first.id}/confirm`;
  const processing = intentSchema.parse(await (await post(url, path, {})).json());
  expect(processing.status).toBe("processing");
  expect(await (await post(url, path, {})).json()).toEqual(processing);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(1);
  const terminal = intentSchema.parse(await (await post(url, path, {})).json());
  expect(terminal.status).toBe("succeeded");
  expect(await (await post(url, "/v1/payment_intents", body, "create-once")).json()).toEqual(first);
  const changedRoute = await post(url, path, body, "create-once");
  expect(changedRoute.status).toBe(400);
  expect(await changedRoute.json()).toEqual({
    error: {
      type: "idempotency_error",
      code: "idempotency_key_in_use",
      message: "idempotency_key_in_use",
    },
  });
  const log = z
    .object({
      data: z.array(
        z.object({
          kind: z.enum(["service", "control", "webhook"]),
          route: z.string(),
          time: z.number(),
          status: z.number(),
        }),
      ),
    })
    .parse(
      await (
        await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
      ).json(),
    );
  expect(log.data.filter((call) => call.route === "POST webhook")).toEqual([
    { kind: "webhook", route: "POST webhook", time: 10020, status: 200 },
  ]);
});

test("partial refunds share the paid limit only with the same intent", async () => {
  const url = await start();
  const first = await confirm(url);
  const other = await confirm(url);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(2);
  const partial = await post(url, "/v1/refunds", { payment_intent: first.id, amount: 300 });
  expect(partial.status).toBe(200);
  expect(await partial.json()).toMatchObject({
    id: expect.stringMatching(/^re_/),
    object: "refund",
    payment_intent: first.id,
    amount: 300,
    currency: "usd",
    status: "succeeded",
  });
  const tooMuch = await post(url, "/v1/refunds", { payment_intent: first.id, amount: 12001 });
  expect(tooMuch.status).toBe(400);
  expect(await tooMuch.json()).toEqual({
    error: {
      type: "invalid_request_error",
      code: "invalid_refund_amount",
      message: "invalid_refund_amount",
    },
  });
  expect(await (await post(url, "/v1/refunds", { payment_intent: other.id })).json()).toMatchObject(
    { payment_intent: other.id, amount: 12300 },
  );
  expect(await (await post(url, "/v1/refunds", { payment_intent: first.id })).json()).toMatchObject(
    { payment_intent: first.id, amount: 12000 },
  );
});

test("bad payment input and missing resources return Stripe errors", async () => {
  const url = await start();
  const cases = [
    { path: "/v1/payment_intents", body: {}, status: 400, code: "invalid_payment_intent" },
    {
      path: "/v1/payment_intents",
      body: { amount: 0, currency: "usd" },
      status: 400,
      code: "invalid_payment_intent",
    },
    {
      path: "/v1/payment_intents",
      body: { amount: 1, currency: "xUSDx" },
      status: 400,
      code: "invalid_payment_intent",
    },
    {
      path: "/v1/payment_intents/missing/confirm",
      body: {},
      status: 404,
      code: "resource_missing",
    },
    { path: "/v1/refunds", body: {}, status: 400, code: "invalid_refund" },
    {
      path: "/v1/refunds",
      body: { payment_intent: "missing" },
      status: 404,
      code: "resource_missing",
    },
    {
      path: "/v1/payment_intents/missing/confirm/extra",
      body: {},
      status: 404,
      code: "resource_missing",
    },
  ];
  for (const entry of cases) {
    const response = await post(url, entry.path, entry.body);
    expect(response.status).toBe(entry.status);
    expect(await response.json()).toEqual({
      error: { type: "invalid_request_error", code: entry.code, message: entry.code },
    });
  }
  const intent = intentSchema.parse(
    await (await post(url, "/v1/payment_intents", { amount: 900, currency: "usd" })).json(),
  );
  const unconfirmed = await post(url, "/v1/refunds", { payment_intent: intent.id });
  expect(unconfirmed.status).toBe(409);
  expect(await unconfirmed.json()).toEqual({
    error: {
      type: "invalid_request_error",
      code: "payment_not_succeeded",
      message: "payment_not_succeeded",
    },
  });
  expect((await fetch(`${url}/v1/payment_intents/missing`)).status).toBe(404);
  expect((await fetch(`${url}/v1/payment_intents/${intent.id}/extra`)).status).toBe(404);
  expect((await post(url, `/v1/payment_intents/${intent.id}`, {})).status).toBe(404);
  expect((await post(url, `/prefix/v1/payment_intents/${intent.id}/confirm`, {})).status).toBe(404);
  expect((await fetch(`${url}/prefix/v1/payment_intents/${intent.id}`)).status).toBe(404);
  expect((await fetch(`${url}/v1/payment_intents/extra/${intent.id}`)).status).toBe(404);
});

test("a payment scenario reset clears intents, keys, route faults and old deliveries", async () => {
  const url = await start();
  const body = { amount: 900, currency: "usd" };
  const first = intentSchema.parse(
    await (await post(url, "/v1/payment_intents", body, "reset-key")).json(),
  );
  await post(url, `/v1/payment_intents/${first.id}/confirm`, {});
  await post(url, "/control/routes", { route: "POST /v1/payment_intents", status: 503 });
  expect(await (await post(url, "/control/scenario", { name: "default" })).json()).toEqual({
    data: { name: "default" },
  });
  await post(url, "/control/clock", { advanceMs: 20 });
  expect((await fetch(`${url}/v1/payment_intents/${first.id}`)).status).toBe(404);
  expect(received).toEqual([]);
  const fresh = await post(url, "/v1/payment_intents", body, "reset-key");
  expect(fresh.status).toBe(200);
  const renewed = intentSchema.parse(await fresh.json());
  expect(renewed.id).not.toBe(first.id);
  await post(url, `/v1/payment_intents/${renewed.id}/confirm`, {});
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(1);
  expect(JSON.parse(received.at(0)!.body)).toMatchObject({
    type: "payment_intent.succeeded",
    data: { object: { id: renewed.id } },
  });
});

test("the grader rejects an unknown intent and invalid webhook plans", async () => {
  const url = await start();
  const missing = await post(url, "/control/webhooks", { intent_id: "missing", mode: "now" });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    error: { type: "invalid_request_error", code: "resource_missing", message: "resource_missing" },
  });
  const cases = [
    { path: "/control/scenario", body: { name: "missing" }, code: "invalid_scenario" },
    { path: "/control/payment", body: { mode: "missing" }, code: "invalid_payment_plan" },
    {
      path: "/control/webhooks",
      body: { intent_id: "missing", delayMs: -1 },
      code: "invalid_webhook_plan",
    },
  ];
  for (const entry of cases) {
    const response = await post(url, entry.path, entry.body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      errors: [{ type: "invalid_request_error", code: entry.code, title: entry.code }],
    });
  }
});

test("manual late and twice plans change only the chosen intent", async () => {
  const url = await start();
  await post(url, "/control/payment", { mode: "late", delayMs: 100 });
  const first = await confirm(url);
  const other = await confirm(url);
  const late = await post(url, "/control/webhooks", {
    intent_id: first.id,
    mode: "late",
    delayMs: 7,
  });
  expect(await late.json()).toEqual({ data: { intent_id: first.id, mode: "late", delayMs: 7 } });
  const twice = await post(url, "/control/webhooks", { intent_id: other.id, mode: "twice" });
  expect(await twice.json()).toEqual({
    data: { intent_id: other.id, mode: "twice", delayMs: 1000 },
  });
  await expect.poll(() => received.length).toBe(2);
  expect(received.every((event) => JSON.parse(event.body).data.object.id === other.id)).toBe(true);
  await post(url, "/control/clock", { advanceMs: 6 });
  expect(await (await fetch(`${url}/v1/payment_intents/${first.id}`)).json()).toMatchObject({
    status: "processing",
  });
  await post(url, "/control/clock", { advanceMs: 1 });
  await expect.poll(() => received.length).toBe(3);
  expect(JSON.parse(received.at(2)!.body)).toMatchObject({
    type: "payment_intent.succeeded",
    data: { object: { id: first.id } },
  });
  await post(url, "/control/clock", { advanceMs: 100 });
  expect(await (await fetch(`${url}/v1/payment_intents/${other.id}`)).json()).toMatchObject({
    status: "succeeded",
  });
  expect(received.length).toBe(3);
});

test("a failed outcome uses the default confirmation plan", async () => {
  const url = await start();
  const plan = await post(url, "/control/payment", { outcome: "failed" });
  expect(await plan.json()).toEqual({ data: { outcome: "failed", mode: "now", delayMs: 1000 } });
  const intent = await confirm(url);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(1);
  expect(JSON.parse(received.at(0)!.body)).toMatchObject({
    type: "payment_intent.payment_failed",
    data: { object: { id: intent.id, status: "requires_payment_method", latest_charge: null } },
  });
});
