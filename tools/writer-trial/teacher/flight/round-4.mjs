import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { account, table, control, calls, expect } from "./common.mjs";
import { target, hold, history } from "./round-3.mjs";
export async function heldBooking(
  page,
  suite,
  scenario = "default",
  email = `${randomUUID()}@example.test`,
) {
  const flight = await target(suite, scenario);
  await account(page, suite.app, email);
  const shown = await hold(page, suite, flight);
  const savedPage = await page.context().newPage();
  try {
    await expect
      .poll(
        async () =>
          (await history(savedPage, suite.app)).filter((row) => row.State === "Held").length,
      )
      .toBe(1);
  } finally {
    await savedPage.close();
  }
  await history(page, suite.app);
  await expect
    .poll(async () => (await table(page, "Bookings")).filter((row) => row.State === "Held").length)
    .toBe(1);
  const rows = await table(page, "Bookings");
  assert.equal(rows.length, 1, "The traveler must have one saved hold");
  return { ...rows[0], Departs: shown.Departs, Arrives: shown.Arrives };
}
export async function pay(page, suite, row) {
  await page.getByRole("button", { name: `Pay ${row.Booking}`, exact: true }).click();
  await expect.poll(async () => (await table(page, "Bookings"))[0]?.State).toBe("Processing");
}
export async function state(page, value) {
  await expect.poll(async () => (await table(page, "Bookings"))[0]?.State).toBe(value);
  return (await table(page, "Bookings"))[0];
}
async function signedWebhook(suite, body, options = {}) {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", suite.webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return fetch(`${suite.app}/webhooks/stripe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Stripe-Signature": `t=${timestamp},v1=${digest}`,
    },
    body: options.sentBody ?? body,
  });
}
async function successEvent(suite, paymentId) {
  const intent = await (await fetch(`${suite.payment}/v1/payment_intents/${paymentId}`)).json();
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: "event",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.succeeded",
    data: { object: { ...intent, status: "succeeded" } },
  });
}
export async function round4(suite, test) {
  await test("r4 the payment route repeats one execution without extra charges", async (page, context) => {
    const row = await heldBooking(page, suite);
    await control(suite, suite.payment, "payment", { mode: "never" });
    const data = { executionId: randomUUID(), bookingId: row.Booking };
    const repeated = await Promise.all(
      [1, 2].map(() => context.request.post(`${suite.app}/api/flights/pay`, { data })),
    );
    for (const response of repeated) {
      assert.equal(response.status(), 200, "An allowed payment route returns HTTP 200");
      assert.equal((await response.json()).executionId, data.executionId);
    }
    const pending = await state(page, "Processing");
    await control(suite, suite.payment, "webhooks", { intent_id: pending.Payment, mode: "now" });
    await state(page, "Confirmed");
    const later = await context.request.post(`${suite.app}/api/flights/pay`, { data });
    assert.equal(later.status(), 200);
    assert.equal((await later.json()).executionId, data.executionId);
    assert.equal((await calls(suite, suite.payment, "POST /v1/payment_intents")).length, 1);
    assert.equal(
      (await calls(suite, suite.payment, /^POST \/v1\/payment_intents\/[^/]+\/confirm$/)).length,
      1,
    );
    assert.equal((await calls(suite, suite.suppliers[0].url, "POST /air/payments")).length, 1);
    assert.equal((await calls(suite, suite.payment, "POST /v1/refunds")).length, 0);
  });
  await test("r4 an old signed webhook changes nothing", async (page) => {
    const row = await heldBooking(page, suite);
    await control(suite, suite.payment, "payment", { mode: "never" });
    await pay(page, suite, row);
    const pending = await state(page, "Processing");
    const body = await successEvent(suite, pending.Payment);
    const response = await signedWebhook(suite, body, {
      timestamp: Math.floor(Date.now() / 1000) - 600,
    });
    assert.equal(response.status, 400, "A correct signature with an old timestamp must be refused");
    assert.equal((await table(page, "Bookings"))[0].State, "Processing");
    assert.equal((await calls(suite, suite.suppliers[0].url, "POST /air/payments")).length, 0);
    assert.equal((await calls(suite, suite.payment, "POST /v1/refunds")).length, 0);
    await page.reload({ waitUntil: "load" });
    await state(page, "Processing");
  });
  await test("r4 signatures use exact bytes and fresh event replays add no effects", async (page) => {
    const row = await heldBooking(page, suite);
    await control(suite, suite.payment, "payment", { mode: "never" });
    await pay(page, suite, row);
    const pending = await state(page, "Processing");
    const body = await successEvent(suite, pending.Payment);
    const changed = await signedWebhook(suite, body, { sentBody: `${body} ` });
    assert.equal(changed.status, 400, "A signature over different bytes must be refused");
    assert.equal((await table(page, "Bookings"))[0].State, "Processing");
    assert.equal((await calls(suite, suite.suppliers[0].url, "POST /air/payments")).length, 0);
    assert.equal((await calls(suite, suite.payment, "POST /v1/refunds")).length, 0);
    const first = await signedWebhook(suite, body);
    assert.equal(
      first.status,
      200,
      "The real intent's correctly signed fresh result must be accepted",
    );
    await state(page, "Confirmed");
    const replay = await signedWebhook(suite, body, {
      timestamp: Math.floor(Date.now() / 1000) + 1,
    });
    assert.equal(replay.status, 200, "A fresh signature may replay the same saved event");
    assert.equal((await calls(suite, suite.suppliers[0].url, "POST /air/payments")).length, 1);
    assert.equal((await calls(suite, suite.payment, "POST /v1/payment_intents")).length, 1);
    assert.equal((await calls(suite, suite.payment, "POST /v1/refunds")).length, 0);
    await page.reload({ waitUntil: "load" });
    await state(page, "Confirmed");
  });
  await test("r4 payment waits for a valid signed webhook and syncs across tabs", async (page, context) => {
    const row = await heldBooking(page, suite);
    const twin = await context.newPage();
    await history(twin, suite.app);
    await control(suite, suite.payment, "payment", { mode: "never" });
    await pay(page, suite, row);
    const pending = await state(twin, "Processing");
    assert.match(pending.Payment, /^pi_/, "Save the real payment intent ID");
    const intent = await (
      await fetch(`${suite.payment}/v1/payment_intents/${pending.Payment}`)
    ).json();
    assert.equal(
      intent.amount,
      Math.round(Number(row.Price.split(" ")[0]) * 100),
      "Charge the held price in cents",
    );
    assert.equal(intent.currency, "usd");
    const forged = await fetch(`${suite.app}/webhooks/stripe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Stripe-Signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
      },
      body: JSON.stringify({
        id: `evt_${randomUUID()}`,
        type: "payment_intent.succeeded",
        data: { object: { ...intent, status: "succeeded" } },
      }),
    });
    assert.equal(forged.status, 400, "A forged payment event must be refused");
    assert.equal(
      (await table(twin, "Bookings"))[0].State,
      "Processing",
      "An invalid signature must leave the booking processing",
    );
    assert.equal(
      (await calls(suite, suite.payment, /^GET \/v1\/payment_intents\//)).length,
      1,
      "Only the teacher reads the intent; the app must not poll results",
    );
    await control(suite, suite.payment, "webhooks", { intent_id: pending.Payment, mode: "twice" });
    await state(page, "Confirmed");
    await state(twin, "Confirmed");
    await expect
      .poll(async () => (await calls(suite, suite.payment, "POST webhook")).map((c) => c.status))
      .toEqual([200, 200]);
    const order = (await (await fetch(`${suite.suppliers[0].url}/air/orders/${row.Order}`)).json())
      .data;
    assert.equal(order.payment_status.awaiting_payment, false);
    assert.ok(order.payment_status.paid_at, "A confirmed booking must have a paid supplier order");
    assert.equal(
      (await calls(suite, suite.suppliers[0].url, "POST /air/payments")).length,
      1,
      "A repeated webhook must pay the supplier only once",
    );
    assert.equal(
      (await calls(suite, suite.payment, "POST /v1/payment_intents")).length,
      1,
      "The pay action creates one intent",
    );
    assert.equal(
      (await calls(suite, suite.payment, /^POST \/v1\/payment_intents\/[^/]+\/confirm$/)).length,
      1,
      "The pay action confirms only once",
    );
    assert.equal((await calls(suite, suite.payment, "POST /v1/refunds")).length, 0);
    await page.reload({ waitUntil: "domcontentloaded" });
    const saved = await state(page, "Confirmed");
    assert.equal(saved.Booking, row.Booking);
    assert.equal(saved.Payment, pending.Payment);
  });
  await test("r4 a failed payment never pays the supplier", async (page) => {
    const row = await heldBooking(page, suite);
    await control(suite, suite.payment, "payment", { mode: "never", outcome: "failed" });
    await pay(page, suite, row);
    const pending = await state(page, "Processing");
    await control(suite, suite.payment, "webhooks", { intent_id: pending.Payment, mode: "now" });
    await state(page, "Payment failed");
    const order = (await (await fetch(`${suite.suppliers[0].url}/air/orders/${row.Order}`)).json())
      .data;
    assert.equal(
      order.payment_status.awaiting_payment,
      true,
      "A failed payment must leave the hold usable until expiry",
    );
    assert.equal(order.payment_status.paid_at, null);
    assert.equal((await calls(suite, suite.suppliers[0].url, "POST /air/payments")).length, 0);
    assert.equal((await calls(suite, suite.payment, "POST /v1/refunds")).length, 0);
  });
  await test("r4 late success after hold expiry refunds once", async (page, context) => {
    const row = await heldBooking(page, suite);
    const twin = await context.newPage();
    await history(twin, suite.app);
    await control(suite, suite.payment, "payment", { mode: "never" });
    await pay(page, suite, row);
    const pending = await state(page, "Processing");
    await control(suite, suite.suppliers[0].url, "clock", { advanceMs: 3600000 });
    await control(suite, suite.payment, "webhooks", { intent_id: pending.Payment, mode: "twice" });
    await state(page, "Refunded");
    await state(twin, "Refunded");
    await expect
      .poll(async () => (await calls(suite, suite.payment, "POST webhook")).map((c) => c.status))
      .toEqual([200, 200]);
    const refunds = await calls(suite, suite.payment, "POST /v1/refunds");
    assert.equal(refunds.length, 1, "Repeated late events must make one real refund");
    assert.equal(refunds[0].status, 200, "The payment service must accept the full refund");
    assert.equal(
      (await calls(suite, suite.suppliers[0].url, "POST /air/payments")).length,
      0,
      "An expired hold cannot receive supplier payment",
    );
  });
  await test("r4 expired holds and other travelers take no payment", async (page, context, browser) => {
    const row = await heldBooking(page, suite);
    const anonymous = await fetch(`${suite.app}/api/flights/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionId: randomUUID(), bookingId: row.Booking }),
    });
    assert.equal(anonymous.status, 401);
    const otherContext = await browser.newContext();
    try {
      const other = await otherContext.newPage();
      await account(other, suite.app, `${randomUUID()}@example.test`);
      assert.equal((await history(other, suite.app)).length, 0, "Booking history is private");
      const denied = await otherContext.request.post(`${suite.app}/api/flights/pay`, {
        data: { executionId: randomUUID(), bookingId: row.Booking },
      });
      assert.equal(denied.status(), 403, "Another traveler cannot pay this booking");
    } finally {
      await otherContext.close();
    }
    await control(suite, suite.suppliers[0].url, "clock", { advanceMs: 3600000 });
    await expect
      .poll(async () => {
        await page.reload({ waitUntil: "load" });
        return (await table(page, "Bookings"))[0]?.State;
      })
      .toBe("Expired");
    await expect(page.getByRole("button", { name: `Pay ${row.Booking}`, exact: true })).toHaveCount(
      0,
    );
    const expired = await context.request.post(`${suite.app}/api/flights/pay`, {
      data: { executionId: randomUUID(), bookingId: row.Booking },
    });
    assert.equal(expired.status(), 200);
    assert.equal(
      (await calls(suite, suite.payment, "POST /v1/payment_intents")).length,
      0,
      "Expired and forbidden holds must take no payment",
    );
  });
}
