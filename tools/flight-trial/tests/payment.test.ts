import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { startPayment } from "../src/index.ts";

const intentSchema = z.object({ id: z.string(), status: z.string() });
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
    type: "payment_intent.succeeded",
    data: { object: { id: intent.id, status: "succeeded" } },
  });
  const signature = createHmac("sha256", secret).update(`10.${event.body}`).digest("hex");
  expect(event.signature).toBe(`t=10,v1=${signature}`);
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
  expect(
    (await post(url, "/v1/payment_intents", { amount: 9, currency: "usd" }, "same")).status,
  ).toBe(409);
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
});

test("the failed scenario sends a payment failure webhook", async () => {
  const url = await start();
  await post(url, "/control/scenario", { name: "payment-failed" });
  await confirm(url);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(1);
  expect(JSON.parse(received.at(0)!.body)).toMatchObject({
    type: "payment_intent.payment_failed",
    data: { object: { status: "requires_payment_method" } },
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
    body: "amount=900&currency=usd",
  });
  expect(await response.json()).toMatchObject({
    object: "payment_intent",
    amount: 900,
    currency: "usd",
  });
});
