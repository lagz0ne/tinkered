import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createScope, extension, operation, resource, tag } from "@tinker/core";
import { makeTestClock, makeTestRandom } from "@tinker/core/testing";
import { createServer } from "vite-plus";

const base = "880f1c4f";
const root = resolve(import.meta.dirname, "../../..");
const packageRoot = resolve(import.meta.dirname, "..");
const logs = resolve(import.meta.dirname, "logs");
await mkdir(logs, { recursive: true });
const snapshot = await mkdtemp(`${logs}/wire-old-`);
const files = execFileSync(
  "git",
  [
    "ls-tree",
    "-r",
    "--name-only",
    base,
    "tools/flight-trial/services",
    "tools/flight-trial/src",
    "tools/flight-trial/data",
  ],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n");
for (const file of files) {
  const target = resolve(snapshot, file.replace("tools/flight-trial/", ""));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, execFileSync("git", ["show", `${base}:${file}`], { cwd: root }));
}
await writeFile(resolve(snapshot, "package.json"), '{"type":"module"}');
await symlink(resolve(packageRoot, "node_modules"), resolve(snapshot, "node_modules"));
const missing = tag({ label: "wire diff missing driver" });
const fail = operation({
  label: "wire diff handler throw",
  depends: { missing },
  run: ({ missing }) => missing,
});
const fault = resource({ label: "wire diff fault", factory: () => ({ remaining: 0 }) });
const failures = extension({
  label: "wire diff faults",
  hooks: {
    run(event) {
      if (["read supplier offer", "create payment intent"].includes(event.op.label)) {
        const state = event.resolve(fault);
        if (state.remaining) {
          state.remaining--;
          return event.run(fail);
        }
      }
      return event.next();
    },
  },
});
const services = [];
const seen = new Set();
let comparisons = 0;
async function start(directory, name) {
  const vite = await createServer({
    configFile: false,
    root: directory,
    server: { middlewareMode: true, watch: null },
    appType: "custom",
  });
  const api = await vite.ssrLoadModule("/src/index");
  await vite.close();
  const stop = new AbortController();
  const app = name === "supplier" ? api.supplierApp : api.paymentApp;
  const scope = createScope({
    signal: stop.signal,
    clock: makeTestClock({ now: 10000 }),
    random: makeTestRandom({ seed: 97 }),
    extensions: [failures, app],
    tags: [
      api.port(0),
      api.host("127.0.0.1"),
      api.controlToken("grader"),
      api.stopSignal(stop.signal),
      api.supplierId("supplier-a"),
      api.webhookUrl("http://127.0.0.1:1"),
      api.webhookSecret("wire-diff"),
    ],
  });
  services.push({ stop, scope });
  await scope.ready;
  return { url: scope.resolve(app).url, fault: scope.resolve(fault) };
}
async function request(url, body, options) {
  const bytes = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const method = options.method ?? (bytes === undefined ? "GET" : "POST");
  const response = await fetch(url, {
    method,
    headers: {
      authorization: "Bearer grader",
      ...(bytes === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    body: bytes,
  });
  const fields = Object.fromEntries(response.headers);
  /** Node supplies wall time independently of the service clock. Check its shape, then compare every other header exactly. */
  assert.ok(Number.isFinite(Date.parse(fields.date)));
  fields.date = "<Node wall time>";
  const text = await response.text();
  return { status: response.status, headers: fields, body: text };
}
function readCodes(body) {
  if (!body) return;
  if (body.error) seen.add(body.error.code);
  for (const error of body.errors ?? []) seen.add(error.code);
}
async function compare(pair, path, body, options = {}) {
  const replies = await Promise.all(pair.map(({ url }) => request(`${url}${path}`, body, options)));
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  assert.deepEqual(replies[1], replies[0], `${method} ${path}`);
  comparisons++;
  if (comparisons % 500 === 0) console.log(`Compared ${comparisons} calls.`);
  const decoded = replies[0].body ? JSON.parse(replies[0].body) : undefined;
  readCodes(decoded);
  return decoded;
}
async function waitForRoute(pair, path) {
  for (;;) {
    const logs = await Promise.all(
      pair.map(async ({ url }) => {
        const response = await request(`${url}/control/calls`, undefined, {});
        return JSON.parse(response.body).data;
      }),
    );
    if (logs.every((log) => log.some((call) => call.route === `GET ${path}`))) return;
  }
}
async function compareSupplierReplay(pair) {
  await compare(pair, "/control/scenario", { name: "last-seat" });
  const offer = (await compare(pair, "/air/offer_requests", searchBody)).data.offers[0];
  const body = { data: { selected_offers: [offer.id], type: "hold" } };
  await compare(pair, "/control/routes", { route: "POST /air/orders", repeat: 2 });
  const saved = await compare(pair, "/air/orders", body);
  for (let replay = 0; replay < 2; replay++)
    assert.deepEqual(await compare(pair, "/air/orders", body), saved);
  const fresh = await compare(pair, "/air/orders", body);
  assert.equal(fresh.errors[0].code, "offer_sold_out");
  await compare(pair, "/control/calls");
  console.log("Compared supplier saved order and both rule replays; repeat exhausted.");
}
async function comparePaymentReplay(pair) {
  await compare(pair, "/control/payment", { mode: "never" });
  await compare(pair, "/control/routes", { route: "POST /v1/payment_intents", repeat: 2 });
  const body = { amount: 900, currency: "usd" };
  const firstKey = { headers: { "idempotency-key": "rule-first" } };
  const nextKey = { headers: { "idempotency-key": "rule-next" } };
  const saved = await compare(pair, "/v1/payment_intents", body, firstKey);
  assert.deepEqual(await compare(pair, "/v1/payment_intents", body, firstKey), saved);
  assert.deepEqual(await compare(pair, "/v1/payment_intents", body, nextKey), saved);
  assert.deepEqual(await compare(pair, "/v1/payment_intents", body, firstKey), saved);
  const fresh = await compare(pair, "/v1/payment_intents", body, nextKey);
  assert.notEqual(fresh.id, saved.id);
  await compare(pair, "/control/calls");
  console.log("Compared payment rule replays with keys, then key replay and fresh key.");
}
async function compareClockWake(pair, name) {
  const path = name === "supplier" ? "/air/offers/clock-wake" : "/v1/payment_intents/clock-wake";
  await compare(pair, "/control/routes", { route: `GET ${path}`, delayMs: 100 });
  const waiting = compare(pair, path);
  await waitForRoute(pair, path);
  await compare(pair, "/control/calls");
  await compare(pair, "/control/clock", { advanceMs: 100 });
  await waiting;
  await compare(pair, "/control/calls");
  console.log(`Compared ${name} delayed rule woken by the control clock.`);
}
const searchBody = {
  data: { slices: [{ origin: "LHR", destination: "AMS", departure_date: "2027-01-15" }] },
};
try {
  for (const name of ["supplier", "payment"]) {
    const pair = await Promise.all([
      start(snapshot, name),
      start(process.argv.includes("--same") ? snapshot : packageRoot, name),
    ]);
    await compare(pair, "/control/clock", { now: 10000 });
    for (const path of [
      "/control/clock",
      "/control/routes",
      "/control/scenario",
      ...(name === "supplier"
        ? ["/control/flights", "/air/offer_requests", "/air/orders", "/air/payments"]
        : ["/control/payment", "/control/webhooks", "/v1/payment_intents", "/v1/refunds"]),
    ]) {
      for (const raw of ["{", "", "null", "[]"])
        await compare(pair, path, undefined, { method: "POST", raw });
    }
    await compare(pair, "/control/calls", undefined, { headers: { authorization: "bad" } });
    for (const path of [
      "/missing",
      "/control/missing",
      "/control/calls",
      ...(name === "supplier"
        ? [
            "/air/offers/",
            "/air/offers/a/b",
            "/air/offers/off%201_x",
            "/air/orders/missing",
            "/control/state",
          ]
        : ["/v1/payment_intents/pi%201_x"]),
    ]) {
      await compare(pair, path);
      await compare(pair, path, undefined, { method: "HEAD" });
    }
    const route = name === "supplier" ? "/air/offers/missing" : "/v1/payment_intents/missing";
    await compare(pair, "/control/routes", { route: `GET ${route}`, status: 503 });
    await compare(pair, route);
    await compare(pair, "/control/scenario", { name: "default" });
    if (name === "supplier") await compareSupplierReplay(pair);
    else await comparePaymentReplay(pair);
    await compareClockWake(pair, name);
    await compare(pair, "/control/scenario", { name: "default" });
    await compare(pair, "/control/clock", { now: 10000 });
    const throwPath = name === "supplier" ? "/air/offers/missing" : "/v1/payment_intents";
    for (const service of pair) service.fault.remaining = 1;
    await compare(
      pair,
      throwPath,
      name === "payment" ? { amount: 900, currency: "usd" } : undefined,
      { headers: { "idempotency-key": "throw" } },
    );
    await compare(
      pair,
      throwPath,
      name === "payment" ? { amount: 900, currency: "usd" } : undefined,
      { headers: { "idempotency-key": "throw" } },
    );
    if (name === "supplier") {
      await compare(pair, "/control/scenario", { name: "last-seat" });
      const offer = (await compare(pair, "/air/offer_requests", searchBody)).data.offers[0];
      await compare(pair, `/air/offers/${offer.id}`);
      await compare(pair, "/control/flights", { flight_id: "missing", cabin_class: "economy" });
      const orderBody = { data: { selected_offers: [offer.id], type: "hold" } };
      await compare(pair, "/air/orders", { data: { selected_offers: ["missing"], type: "hold" } });
      await compare(pair, "/control/flights", {
        flight_id: offer.flight_id,
        cabin_class: offer.cabin_class,
        amount_cents: 1,
        fare_class: offer.fare_class,
      });
      await compare(pair, "/air/orders", orderBody);
      await compare(pair, "/control/flights", {
        flight_id: offer.flight_id,
        cabin_class: offer.cabin_class,
        amount_cents: Math.round(Number(offer.total_amount) * 100),
        fare_class: offer.fare_class,
      });
      const held = (await compare(pair, "/air/orders", orderBody)).data;
      await compare(pair, `/air/orders/${held.id}`);
      await compare(pair, "/air/orders", orderBody);
      const payment = {
        data: { order_id: held.id, payment: { amount: "0", currency: "USD", type: "balance" } },
      };
      await compare(pair, "/air/payments", { data: { ...payment.data, order_id: "missing" } });
      await compare(pair, "/air/payments", payment);
      payment.data.payment.amount = held.total_amount;
      await compare(pair, "/air/payments", payment);
      await compare(pair, "/air/payments", payment);
      await compare(pair, "/control/flights", {
        flight_id: offer.flight_id,
        cabin_class: offer.cabin_class,
        seats: 1,
      });
      const expired = (await compare(pair, "/air/orders", orderBody)).data;
      await compare(pair, "/control/clock", { advanceMs: 1001 });
      await compare(pair, "/air/payments", { data: { ...payment.data, order_id: expired.id } });
      await compare(pair, "/control/clock", { advanceMs: 1800000 });
      await compare(pair, `/air/offers/${offer.id}`);
      await compare(pair, "/air/orders", orderBody);
      await compare(pair, "/control/scenario", { name: "default" });
      await compare(pair, "/air/offer_requests", undefined, {
        method: "POST",
        raw: "data[slices][origin]=LHR",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      let response;
      do {
        response = await compare(pair, "/air/offer_requests", {
          data: { slices: [{ origin: "ICN", destination: "NRT", departure_date: "2027-01-15" }] },
        });
      } while (!response.errors);
      assert.equal(response.errors[0].code, "offer_limit_reached");
      await compare(pair, "/control/state");
    } else {
      await compare(pair, "/control/payment", { mode: "never" });
      const form = await compare(pair, "/v1/payment_intents", undefined, {
        method: "POST",
        raw: "amount=900&currency=USD&metadata[x]=true&automatic_payment_methods[enabled]=true",
        headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": "form" },
      });
      await compare(pair, `/v1/payment_intents/${form.id}`);
      await compare(pair, "/v1/payment_intents/missing/confirm", {});
      await compare(pair, "/v1/refunds", { payment_intent: "missing" });
      await compare(pair, "/v1/refunds", { payment_intent: form.id });
      for (const amount of [900, 900, 901])
        await compare(
          pair,
          "/v1/payment_intents",
          { amount, currency: "usd" },
          { headers: { "idempotency-key": "reuse" } },
        );
      await compare(pair, `/v1/payment_intents/${form.id}/confirm`, {});
      await compare(pair, `/v1/payment_intents/${form.id}/confirm`, {});
      await compare(pair, "/control/webhooks", { intent_id: "missing" });
      await compare(pair, "/control/webhooks", { intent_id: form.id, mode: "late", delayMs: 10 });
      await compare(pair, "/control/clock", { advanceMs: 10 });
      /** Delivery's failed network call is owned by the graph. Poll through the public log. */
      let log;
      do {
        log = await compare(pair, "/control/calls");
      } while (!log.data.some((call) => call.kind === "webhook"));
      await compare(pair, "/v1/refunds", { payment_intent: form.id, amount: 1000 });
      await compare(pair, "/v1/refunds", { payment_intent: form.id });
      await compare(pair, "/v1/refunds", { payment_intent: form.id });
      await compare(pair, "/control/scenario", { name: "payment-failed" });
    }
    await compare(pair, "/control/calls");
    const delayed = name === "supplier" ? "/air/offers/stopped" : "/v1/payment_intents/stopped";
    await compare(pair, "/control/routes", { route: `GET ${delayed}`, delayMs: 100 });
    const waiting = compare(pair, delayed);
    await waitForRoute(pair, delayed);
    for (const service of services.slice(-2)) service.stop.abort();
    await waiting;
  }
  const expected = [
    "invalid_route_rule",
    "invalid_clock",
    "invalid_scenario",
    "unauthorized",
    "not_found",
    "injected_failure",
    "internal_error",
    "service_stopped",
    "invalid_flight_change",
    "invalid_offer_request",
    "invalid_order",
    "invalid_payment",
    "flight_not_found",
    "offer_not_found",
    "offer_expired",
    "offer_sold_out",
    "offer_price_changed",
    "offer_limit_reached",
    "order_not_found",
    "order_expired",
    "order_not_awaiting_payment",
    "incorrect_amount",
    "invalid_payment_plan",
    "invalid_webhook_plan",
    "invalid_payment_intent",
    "invalid_refund",
    "resource_missing",
    "payment_not_succeeded",
    "invalid_refund_amount",
    "idempotency_key_in_use",
  ];
  assert.deepEqual(
    [...seen].toSorted((a, b) => a.localeCompare(b)),
    expected.toSorted((a, b) => a.localeCompare(b)),
  );
  console.log(
    `Wire diff: zero differences; ${comparisons} calls; ${seen.size} error codes. Base ${base}${process.argv.includes("--same") ? " vs itself" : " vs current"}.`,
  );
} finally {
  for (const { stop } of services) stop.abort();
  await Promise.all(services.map(({ scope }) => scope.closed));
  await rm(snapshot, { recursive: true, force: true });
}
