import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { control, calls, expect, table, account } from "./common.mjs";
import { history } from "./round-3.mjs";
import { heldBooking, pay, state } from "./round-4.mjs";
export async function chaos(suite, body = {}) {
  const response = await fetch(`${suite.mailpit}/api/v1/chaos`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, "Mailpit Chaos must be enabled with MP_ENABLE_CHAOS=true");
  await response.arrayBuffer();
}
export async function messages(suite, email, booking) {
  const query = new URLSearchParams({ query: `to:${email} subject:"Flight booking ${booking}"` });
  const response = await fetch(`${suite.mailpit}/api/v1/search?${query}`);
  assert.ok(response.ok, "Mailpit must answer inbox search");
  const result = await response.json();
  return result.messages.filter(
    (message) =>
      message.Subject === `Flight booking ${booking}` &&
      message.To.some((to) => to.Address === email),
  );
}
async function assertConfirmation(suite, email, row) {
  await expect.poll(async () => (await messages(suite, email, row.Booking)).length).toBe(1);
  const [summary] = await messages(suite, email, row.Booking);
  const response = await fetch(`${suite.mailpit}/api/v1/message/${summary.ID}`);
  assert.ok(response.ok, "Mailpit must return the stored confirmation");
  const message = await response.json();
  for (const text of [row.Booking, row.Flight, row.Order, row.Supplier, row.Price])
    assert.ok(message.Text.includes(text), `Confirmation must include ${text}`);
  for (const time of [row.Departs, row.Arrives])
    assert.ok(message.Text.includes(time), "Confirmation must match the Flights display times");
}
export async function round5(suite, test) {
  await chaos(suite);
  await test("r5 the email route repeats one execution without extra sends", async (page, context) => {
    const email = `${randomUUID()}@example.test`;
    const row = await heldBooking(page, suite, "default", email);
    await control(suite, suite.payment, "payment", { mode: "never" });
    await pay(page, suite, row);
    const pending = await state(page, "Processing");
    try {
      await chaos(suite, { Sender: { ErrorCode: 451, Probability: 100 } });
      await control(suite, suite.payment, "webhooks", { intent_id: pending.Payment, mode: "now" });
      await expect.poll(async () => (await table(page, "Bookings"))[0]?.Email).toBe("Failed");
      assert.equal((await table(page, "Bookings"))[0].State, "Confirmed");
    } finally {
      await chaos(suite);
    }
    const data = { executionId: randomUUID(), bookingId: row.Booking };
    const repeated = await Promise.all(
      [1, 2].map(() => context.request.post(`${suite.app}/api/flights/email`, { data })),
    );
    for (const response of repeated) {
      assert.equal(response.status(), 200, "An allowed email route returns HTTP 200");
      assert.deepEqual(await response.json(), { executionId: data.executionId });
    }
    await expect.poll(async () => (await table(page, "Bookings"))[0]?.Email).toBe("Sent");
    await expect(
      page.getByRole("button", { name: `Retry email ${row.Booking}`, exact: true }),
    ).toHaveCount(0);
    const later = await context.request.post(`${suite.app}/api/flights/email`, { data });
    assert.equal(later.status(), 200);
    assert.deepEqual(await later.json(), { executionId: data.executionId });
    await assertConfirmation(suite, email, row);
    assert.equal((await calls(suite, suite.payment, "POST /v1/payment_intents")).length, 1);
    assert.equal((await calls(suite, suite.suppliers[0].url, "POST /air/orders")).length, 1);
    assert.equal((await calls(suite, suite.suppliers[0].url, "POST /air/payments")).length, 1);
    assert.equal((await calls(suite, suite.payment, "POST /v1/refunds")).length, 0);
  });
  await test("r5 a confirmed booking sends one real confirmation", async (page, context) => {
    const email = `${randomUUID()}@example.test`;
    const row = await heldBooking(page, suite, "default", email);
    await control(suite, suite.payment, "payment", { mode: "never" });
    await pay(page, suite, row);
    const pending = await state(page, "Processing");
    assert.equal(
      (await messages(suite, email, row.Booking)).length,
      0,
      "Processing bookings must not send confirmation",
    );
    const twin = await context.newPage();
    await history(twin, suite.app);
    await control(suite, suite.payment, "webhooks", { intent_id: pending.Payment, mode: "twice" });
    await state(page, "Confirmed");
    await expect.poll(async () => (await table(twin, "Bookings"))[0]?.Email).toBe("Sent");
    await expect
      .poll(async () => (await calls(suite, suite.payment, "POST webhook")).map((c) => c.status))
      .toEqual([200, 200]);
    await assertConfirmation(suite, email, row);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await table(page, "Bookings"))[0]?.Email).toBe("Sent");
    assert.equal((await table(page, "Bookings"))[0].State, "Confirmed");
  });
  await test("r5 failed mail keeps the booking valid and retry sends once", async (page, context, browser) => {
    const email = `${randomUUID()}@example.test`;
    const row = await heldBooking(page, suite, "default", email);
    const twin = await context.newPage();
    await history(twin, suite.app);
    await control(suite, suite.payment, "payment", { mode: "never" });
    await pay(page, suite, row);
    const pending = await state(page, "Processing");
    try {
      await chaos(suite, { Sender: { ErrorCode: 451, Probability: 100 } });
      await control(suite, suite.payment, "webhooks", {
        intent_id: pending.Payment,
        mode: "twice",
      });
      await expect.poll(async () => (await table(twin, "Bookings"))[0]?.Email).toBe("Failed");
      assert.equal(
        (await table(twin, "Bookings"))[0].State,
        "Confirmed",
        "Mail failure must keep the booking valid",
      );
      await expect(
        page.getByText("Booking confirmed; email failed. Retry email.", { exact: true }),
      ).toBeVisible();
      assert.equal(
        (await messages(suite, email, row.Booking)).length,
        0,
        "Rejected SMTP must not create a message",
      );
      await expect
        .poll(async () => (await calls(suite, suite.payment, "POST webhook")).map((c) => c.status))
        .toEqual([200, 200]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("button", { name: `Retry email ${row.Booking}`, exact: true }),
      ).toBeVisible();
      const anonymous = await fetch(`${suite.app}/api/flights/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ executionId: randomUUID(), bookingId: row.Booking }),
      });
      assert.equal(anonymous.status, 401);
      await chaos(suite);
      const otherContext = await browser.newContext();
      try {
        const other = await otherContext.newPage();
        await account(other, suite.app, `${randomUUID()}@example.test`);
        const denied = await otherContext.request.post(`${suite.app}/api/flights/email`, {
          data: { executionId: randomUUID(), bookingId: row.Booking },
        });
        assert.equal(denied.status(), 403, "Another traveler cannot retry this mail");
      } finally {
        await otherContext.close();
      }
      await page.getByRole("button", { name: `Retry email ${row.Booking}`, exact: true }).click();
      await expect.poll(async () => (await table(twin, "Bookings"))[0]?.Email).toBe("Sent");
      const final = (await table(twin, "Bookings"))[0];
      assert.equal(final.State, "Confirmed");
      assert.equal(final.Booking, row.Booking);
      assert.equal(final.Order, row.Order);
      await expect(
        page.getByRole("button", { name: `Retry email ${row.Booking}`, exact: true }),
      ).toHaveCount(0);
      await assertConfirmation(suite, email, row);
      assert.equal(
        (await calls(suite, suite.payment, "POST /v1/payment_intents")).length,
        1,
        "Mail retry cannot create another payment",
      );
      assert.equal(
        (await calls(suite, suite.suppliers[0].url, "POST /air/orders")).length,
        1,
        "Mail retry cannot create another hold",
      );
      assert.equal(
        (await calls(suite, suite.suppliers[0].url, "POST /air/payments")).length,
        1,
        "Mail retry cannot pay the supplier twice",
      );
      assert.equal(
        (await calls(suite, suite.payment, "POST /v1/refunds")).length,
        0,
        "Mail failure cannot refund a valid booking",
      );
    } finally {
      await chaos(suite);
    }
  });
  await test("r5 late refunded payments send no confirmation", async (page) => {
    const email = `${randomUUID()}@example.test`;
    const row = await heldBooking(page, suite, "default", email);
    await control(suite, suite.payment, "payment", { mode: "never" });
    await pay(page, suite, row);
    const pending = await state(page, "Processing");
    await control(suite, suite.suppliers[0].url, "clock", { advanceMs: 3600000 });
    await control(suite, suite.payment, "webhooks", { intent_id: pending.Payment, mode: "twice" });
    await state(page, "Refunded");
    await expect
      .poll(async () => (await calls(suite, suite.payment, "POST webhook")).map((c) => c.status))
      .toEqual([200, 200]);
    assert.equal(
      (await messages(suite, email, row.Booking)).length,
      0,
      "A refunded booking must not send confirmation",
    );
    assert.equal((await table(page, "Bookings"))[0].Email, "Not sent");
  });
}
