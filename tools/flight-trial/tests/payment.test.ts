import { createConnection } from "node:net";
import { createScope, resource, tag } from "@tinker/core";
import { createHmac } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterAll, afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

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
const running: { stop: AbortController; closed: Promise<unknown> }[] = [];
const inbox = resource({
  label: "test webhook inbox",
  async factory(_deps, ctx) {
    const received: { body: string; signature: string }[] = [];
    let holding = false;
    const waiting = new Set<ServerResponse>();
    const server = createServer(async (request, response) => {
      if (request.url === "/control/hold") {
        holding = true;
        response.end("ok");
        return;
      }
      if (request.url === "/control/release") {
        holding = false;
        for (const reply of waiting) reply.end("ok");
        waiting.clear();
        response.end("ok");
        return;
      }
      if (request.url === "/control/pending") {
        response.end(JSON.stringify({ pending: waiting.size }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      received.push({
        body: Buffer.concat(chunks).toString("utf8"),
        signature: String(request.headers["stripe-signature"]),
      });
      if (holding) {
        waiting.add(response);
        response.once("close", () => waiting.delete(response));
      } else response.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    ctx.defer(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    return {
      received,
      webhookUrl: `http://127.0.0.1:${typeof address === "object" ? address?.port : 0}`,
    };
  },
});
const pipeUrl = tag<string>({ label: "HTTP pipe URL" });
const pipeAmount = tag({ label: "second HTTP pipe amount", default: 900 });
const pipeKey = tag<string>({ label: "HTTP pipe key" });
/** Both requests share one real socket and arrive in one write; Node sends one JSON chunk per reply. */
const pipeClient = resource({
  label: "HTTP pipelined client",
  depends: { url: pipeUrl, amount: pipeAmount, key: pipeKey },
  async factory({ url, amount, key }, ctx) {
    const target = new URL(url);
    const socket = createConnection({ host: target.hostname, port: Number(target.port) });
    ctx.defer(() => {
      socket.destroy();
    });
    await once(socket, "connect");
    const first = JSON.stringify({ amount: 900, currency: "usd" });
    const second = JSON.stringify({ amount, currency: "usd" });
    socket.write(
      [
        `POST /v1/payment_intents HTTP/1.1\r\nHost: ${target.host}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(first)}\r\nIdempotency-Key: ${key}\r\nConnection: keep-alive\r\n\r\n${first}`,
        `POST /v1/payment_intents HTTP/1.1\r\nHost: ${target.host}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(second)}\r\nIdempotency-Key: ${key}\r\nConnection: close\r\n\r\n${second}`,
      ].join(""),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of socket) chunks.push(chunk);
    const bytes = Buffer.concat(chunks).toString("utf8");
    return [
      ...bytes.matchAll(
        /HTTP\/1\.1 (\d+)[^\r]+\r\n([\s\S]*?)\r\n\r\n[0-9a-f]+\r\n([\s\S]*?)\r\n0\r\n\r\n/g,
      ),
    ].map((match) => ({
      status: Number(match.at(1)),
      headers: Object.fromEntries(
        match
          .at(2)!
          .split("\r\n")
          .map((line) => {
            const colon = line.indexOf(":");
            return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
          }),
      ),
      body: z.unknown().parse(JSON.parse(match.at(3)!)),
    }));
  },
});
const inboxStop = new AbortController();
const inboxScope = createScope({ signal: inboxStop.signal });
const { received, webhookUrl } = await inboxScope.resolve(inbox);
afterAll(async () => {
  inboxStop.abort();
  await inboxScope.closed;
});
afterEach(async () => {
  for (const app of running.splice(0)) {
    app.stop.abort();
    await app.closed;
  }
  await fetch(`${webhookUrl}/control/release`);
  received.length = 0;
});
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  await post(url, "/control/payment", { mode: "twice" });
  await confirm(url);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(2);
  expect(received.at(0)).toEqual(received.at(1));
  expect(JSON.parse(received.at(0)!.body)).toMatchObject({ type: "payment_intent.succeeded" });
});

test("the failed scenario sends a payment failure webhook", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  await post(url, "/control/payment", { mode: "never" });
  const intent = await confirm(url);
  await post(url, "/control/clock", { advanceMs: 10000 });
  expect(
    intentSchema.parse(await (await fetch(`${url}/v1/payment_intents/${intent.id}`)).json()).status,
  ).toBe("processing");
  expect(received).toEqual([]);
  await post(url, "/control/webhooks", { intent_id: intent.id, mode: "now" });
  await expect.poll(() => received.length).toBe(1);
});

test("refund keys return the same refund and cannot refund more than paid", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  await post(url, "/control/routes", { route: "POST /v1/payment_intents", status: 503 });
  const response = await post(url, "/v1/payment_intents", { amount: 900, currency: "usd" });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: { type: "invalid_request_error", code: "injected_failure", message: "injected_failure" },
  });
});

test("repeated confirmation keeps one delivery and a key keeps its original reply", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stopUrl = new AbortController();
  const scopeUrl = createScope({
    signal: stopUrl.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stopUrl.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop: stopUrl, closed: scopeUrl.closed });
  await scopeUrl.ready;
  const { url } = scopeUrl.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
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

test("parallel delayed payment calls consume one saved route reply", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop, closed: scope.closed });
  await scope.ready;
  const { url } = scope.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  await post(url, "/control/routes", {
    route: "POST /v1/payment_intents",
    delayMs: 100,
    repeat: 1,
  });
  const logs = z.object({ data: z.array(z.object({ route: z.string(), status: z.number() })) });
  const firstCall = post(url, "/v1/payment_intents", { amount: 900, currency: "usd" });
  await expect
    .poll(async () => {
      const log = logs.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter(
        (call) => call.route === "POST /v1/payment_intents" && call.status === 0,
      ).length;
    })
    .toBe(1);
  await post(url, "/control/clock", { advanceMs: 100 });
  const original = intentSchema.parse(await (await firstCall).json());
  const parallel = Promise.all([
    post(url, "/v1/payment_intents", { amount: 901, currency: "usd" }),
    post(url, "/v1/payment_intents", { amount: 902, currency: "usd" }),
  ]);
  await expect
    .poll(async () => {
      const log = logs.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter(
        (call) => call.route === "POST /v1/payment_intents" && call.status === 0,
      ).length;
    })
    .toBe(2);
  await post(url, "/control/clock", { advanceMs: 100 });
  const responses = await parallel;
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const intents = await Promise.all(
    responses.map(async (response) => intentSchema.parse(await response.json())),
  );
  expect(intents.filter((intent) => intent.id === original.id)).toHaveLength(1);
  expect(intents.find((intent) => intent.id === original.id)).toEqual(original);
  expect([901, 902]).toContain(intents.find((intent) => intent.id !== original.id)!.amount);
  const afterRepeat = post(url, "/v1/payment_intents", { amount: 903, currency: "usd" });
  await expect
    .poll(async () => {
      const log = logs.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter(
        (call) => call.route === "POST /v1/payment_intents" && call.status === 0,
      ).length;
    })
    .toBe(1);
  await post(url, "/control/clock", { advanceMs: 100 });
  const fresh = intentSchema.parse(await (await afterRepeat).json());
  expect(fresh.amount).toBe(903);
  expect(intents.map((intent) => intent.id)).not.toContain(fresh.id);
});

test("a delayed payment call cannot overwrite its replacement rule", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop, closed: scope.closed });
  await scope.ready;
  const { url } = scope.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  const logs = z.object({
    data: z.array(
      z.object({
        route: z.string(),
        kind: z.enum(["service", "control", "webhook"]),
        time: z.number(),
        status: z.number(),
      }),
    ),
  });
  await post(url, "/control/routes", {
    route: "POST /v1/payment_intents",
    delayMs: 100,
    status: 503,
  });
  const pending = post(url, "/v1/payment_intents", { amount: 900, currency: "usd" });
  await expect
    .poll(async () => {
      const log = logs.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter(
        (call) => call.route === "POST /v1/payment_intents" && call.status === 0,
      ).length;
    })
    .toBe(1);
  await post(url, "/control/routes", { route: "POST /v1/payment_intents", status: 502 });
  await post(url, "/control/clock", { advanceMs: 100 });
  const response = await pending;
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(intentSchema.parse(await response.json()).amount).toBe(900);
  const next = await post(url, "/v1/payment_intents", { amount: 901, currency: "usd" });
  expect(next.status).toBe(502);
  expect(await next.json()).toEqual({
    error: { type: "invalid_request_error", code: "injected_failure", message: "injected_failure" },
  });
  const log = logs.parse(
    await (
      await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
    ).json(),
  );
  expect(log.data.filter((call) => call.route === "POST /v1/payment_intents")).toEqual([
    { kind: "service", route: "POST /v1/payment_intents", time: 10000, status: 200 },
    { kind: "service", route: "POST /v1/payment_intents", time: 10100, status: 502 },
  ]);
  expect(
    log.data
      .filter((call) => call.route.startsWith("POST /control/"))
      .every((call) => call.kind === "control"),
  ).toBe(true);
});

test("resetting payment while a call waits clears its fault and old log entry", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop, closed: scope.closed });
  await scope.ready;
  const { url } = scope.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  const logs = z.object({
    data: z.array(
      z.object({
        route: z.string(),
        kind: z.enum(["service", "control", "webhook"]),
        time: z.number(),
        status: z.number(),
      }),
    ),
  });
  await post(url, "/control/routes", {
    route: "POST /v1/payment_intents",
    delayMs: 100,
    status: 503,
  });
  const pending = post(url, "/v1/payment_intents", { amount: 900, currency: "usd" });
  await expect
    .poll(async () => {
      const log = logs.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter(
        (call) => call.route === "POST /v1/payment_intents" && call.status === 0,
      ).length;
    })
    .toBe(1);
  await post(url, "/control/scenario", { name: "default" });
  await post(url, "/control/clock", { advanceMs: 100 });
  const response = await pending;
  expect(response.status).toBe(200);
  intentSchema.parse(await response.json());
  const log = logs.parse(
    await (
      await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
    ).json(),
  );
  expect(log.data.filter((call) => call.route === "POST /v1/payment_intents")).toEqual([]);
  const next = await post(url, "/v1/payment_intents", { amount: 901, currency: "usd" });
  expect(next.status).toBe(200);
});

test("stopping payment ends a delayed call with a Stripe service-stopped error", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop, closed: scope.closed });
  await scope.ready;
  const { url } = scope.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  const logs = z.object({
    data: z.array(
      z.object({
        route: z.string(),
        kind: z.enum(["service", "control", "webhook"]),
        time: z.number(),
        status: z.number(),
      }),
    ),
  });
  await post(url, "/control/routes", { route: "POST /v1/payment_intents", delayMs: 100 });
  const pending = post(url, "/v1/payment_intents", { amount: 900, currency: "usd" });
  await expect
    .poll(async () => {
      const log = logs.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      return log.data.filter(
        (call) => call.route === "POST /v1/payment_intents" && call.status === 0,
      ).length;
    })
    .toBe(1);
  stop.abort();
  const response = await pending;
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: { type: "invalid_request_error", code: "service_stopped", message: "service_stopped" },
  });
  await scope.closed;
  await expect(fetch(`${url}/v1/payment_intents/missing`)).rejects.toBeDefined();
});

test("Stripe form metadata keeps plain values and drops unsafe nested keys", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop, closed: scope.closed });
  await scope.ready;
  const { url } = scope.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  const response = await fetch(`${url}/v1/payment_intents`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: "amount=900&currency=usd&metadata[order_id]=constructor&metadata[note]=toString&metadata[__proto__][bad]=yes&metadata[constructor][bad]=yes&metadata[prototype][bad]=yes&automatic_payment_methods[enabled]=false",
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json");
  const parsed = intentSchema
    .extend({ automatic_payment_methods: z.object({ enabled: z.boolean() }) })
    .parse(await response.json());
  expect(parsed.metadata).toEqual({ order_id: "constructor", note: "toString" });
  expect(parsed.automatic_payment_methods.enabled).toBe(false);
  const unsafe = await fetch(`${url}/v1/payment_intents`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "amount=901&currency=usd&__proto__[metadata][inherited]=bad",
  });
  expect(intentSchema.parse(await unsafe.json()).metadata).toEqual({});
  const log = await fetch(`${url}/control/calls`);
  expect(log.status).toBe(401);
  expect(await log.json()).toEqual({
    errors: [{ type: "invalid_request_error", code: "unauthorized", title: "unauthorized" }],
  });
});

test("payment paths require the complete Stripe route", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop, closed: scope.closed });
  await scope.ready;
  const { url } = scope.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  const intent = intentSchema.parse(
    await (await post(url, "/v1/payment_intents", { amount: 900, currency: "usd" })).json(),
  );
  for (const path of [
    `/v1/payment_intents/${intent.id}/confirm/extra`,
    `/prefix/v1/payment_intents/${intent.id}/confirm`,
  ]) {
    const response = await post(url, path, {});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        type: "invalid_request_error",
        code: "resource_missing",
        message: "resource_missing",
      },
    });
  }
  const response = await fetch(`${url}/prefix/v1/payment_intents/${intent.id}`);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: { type: "invalid_request_error", code: "resource_missing", message: "resource_missing" },
  });
});

test("pipelined payment calls protect a key while its first call is still pending", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop, closed: scope.closed });
  await scope.ready;
  const { url } = scope.resolve(paymentApp);
  for (const amount of [900, 901]) {
    const clientStop = new AbortController();
    const client = createScope({
      signal: clientStop.signal,
      tags: [pipeUrl(url), pipeAmount(amount), pipeKey(`pipe-${amount}`)],
    });
    running.push({ stop: clientStop, closed: client.closed });
    const replies = await client.resolve(pipeClient);
    expect(replies).toHaveLength(2);
    const first = replies.at(0)!;
    const second = replies.at(1)!;
    expect(first.status).toBe(200);
    intentSchema.parse(first.body);
    if (amount === 900) {
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(second.headers["idempotent-replayed"]).toBe("true");
    } else {
      expect(second.status).toBe(400);
      expect(second.body).toEqual({
        error: {
          type: "idempotency_error",
          code: "idempotency_key_in_use",
          message: "idempotency_key_in_use",
        },
      });
    }
  }
});

test("a confirmation sends its webhook before the grader sets a clock", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop, closed: scope.closed });
  await scope.ready;
  const { url } = scope.resolve(paymentApp);
  const intent = await confirm(url);
  await expect.poll(() => received.length).toBe(1);
  expect(JSON.parse(received.at(0)!.body)).toMatchObject({
    type: "payment_intent.succeeded",
    data: { object: { id: intent.id, status: "succeeded" } },
  });
  const response = await fetch(`${url}/v1/payment_intents/${intent.id}`);
  expect(intentSchema.parse(await response.json()).status).toBe("succeeded");
});

test("stopping payment aborts an outgoing webhook and closes its HTTP port", async () => {
  const {
    paymentApp,
    webhookUrl: webhookUrlTag,
    webhookSecret,
    webhookDelayMs,
    port,
    host,
    controlToken,
    stopSignal,
  } = await import("../src/index.ts");
  await fetch(`${webhookUrl}/control/hold`);
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrlTag(webhookUrl),
      webhookSecret(secret),
      webhookDelayMs(20),
    ],
  });
  running.push({ stop, closed: scope.closed });
  await scope.ready;
  const { url } = scope.resolve(paymentApp);
  await post(url, "/control/clock", { now: 10000 });
  await confirm(url);
  await post(url, "/control/clock", { advanceMs: 20 });
  await expect.poll(() => received.length).toBe(1);
  stop.abort();
  await scope.closed;
  const pending = z.object({ pending: z.number() });
  await expect
    .poll(
      async () =>
        pending.parse(await (await fetch(`${webhookUrl}/control/pending`)).json()).pending,
    )
    .toBe(0);
  await expect(fetch(`${url}/v1/payment_intents/missing`)).rejects.toBeDefined();
});
