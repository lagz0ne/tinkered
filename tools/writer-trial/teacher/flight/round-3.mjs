import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  reset,
  quote,
  search,
  complete,
  control,
  table,
  account,
  calls,
  expect,
} from "./common.mjs";
export async function target(suite, scenario = "last-seat") {
  await reset(suite, scenario);
  const row = (await quote(suite, suite.suppliers[0]))[0];
  assert.ok(row, "The known route must have an A flight");
  await reset(suite, scenario);
  await control(suite, suite.suppliers[0].url, "flights", {
    flight_id: row.flight_id,
    cabin_class: "economy",
    fare_class: "saver",
    amount_cents: 1,
  });
  return row.flight_id;
}
export async function hold(page, suite, flight) {
  await search(page, suite.app);
  await complete(page);
  const shown = (await table(page, "Flights")).find((row) => row.Flight === flight);
  assert.ok(shown, "The selected flight must be shown before holding");
  await page.getByRole("button", { name: `Hold ${flight}`, exact: true }).click();
  return shown;
}
export async function history(page, app) {
  await page.goto(`${app}/bookings`, { waitUntil: "load" });
  await page.waitForFunction(() => document.readyState === "complete");
  return table(page, "Bookings");
}
export async function round3(suite, test) {
  await test("r3 idle results never reread supplier offers", async (page) => {
    await reset(suite);
    await search(page, suite.app);
    await complete(page);
    assert.ok((await table(page, "Flights")).length > 0, "Idle proof needs shown results");
    const started = Date.now();
    await expect.poll(async () => Date.now() - started).toBeGreaterThanOrEqual(3000);
    for (const supplier of suite.suppliers)
      assert.equal(
        (await calls(suite, supplier.url, /^GET \/air\/offers\//)).length,
        0,
        "An idle results page must not refresh shown quotes through the supplier",
      );
  });
  await test("r3 anonymous holds take no seat and bookings need sign in", async (page) => {
    const flight = await target(suite);
    await hold(page, suite, flight);
    await expect(page.getByText("Sign in required", { exact: true })).toBeVisible();
    for (const supplier of suite.suppliers)
      assert.equal(
        (await calls(suite, supplier.url, "POST /air/orders")).length,
        0,
        "Anonymous visitors must not place orders",
      );
    await page.goto(`${suite.app}/bookings`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Sign in required", { exact: true })).toBeVisible();
  });
  await test("r3 a changed price is refused before any hold order", async (page) => {
    const flight = await target(suite);
    await account(page, suite.app, `${randomUUID()}@example.test`);
    await search(page, suite.app);
    await complete(page);
    await control(suite, suite.suppliers[0].url, "flights", {
      flight_id: flight,
      cabin_class: "economy",
      fare_class: "saver",
      amount_cents: 12345,
    });
    await page.getByRole("button", { name: `Hold ${flight}`, exact: true }).click();
    await expect(page.getByText("Price changed", { exact: true })).toBeVisible();
    for (const supplier of suite.suppliers)
      assert.equal(
        (await calls(suite, supplier.url, "POST /air/orders")).length,
        0,
        "A stale quote must be refused before placing an order",
      );
    assert.equal(
      (await history(page, suite.app)).length,
      0,
      "A changed price must not save a hold",
    );
  });
  await test("r3 two travelers race for one seat and the losing view updates live", async (page, context, browser) => {
    const flight = await target(suite);
    const otherContext = await browser.newContext();
    const observerContext = await browser.newContext();
    try {
      const other = await otherContext.newPage();
      const observer = await observerContext.newPage();
      await account(page, suite.app, `${randomUUID()}@example.test`);
      await account(other, suite.app, `${randomUUID()}@example.test`);
      for (const tab of [page, other, observer]) {
        await search(tab, suite.app);
        await complete(tab);
      }
      await Promise.all(
        [page, other].map((tab) =>
          tab.getByRole("button", { name: `Hold ${flight}`, exact: true }).click(),
        ),
      );
      await expect(
        observer
          .getByRole("row")
          .filter({ has: observer.getByRole("cell", { name: flight, exact: true }) }),
      ).toContainText("Sold out", { timeout: 5000 });
      const historyPages = await Promise.all([context.newPage(), otherContext.newPage()]);
      for (const tab of historyPages) await history(tab, suite.app);
      await expect
        .poll(async () =>
          (await Promise.all(historyPages.map((tab) => table(tab, "Bookings"))))
            .map((rows) => rows.filter((row) => row.State === "Held").length)
            .sort((a, b) => a - b),
        )
        .toEqual([0, 1]);
      const histories = await Promise.all(historyPages.map((tab) => table(tab, "Bookings")));
      const losingPage = histories[0].length ? other : page;
      await expect(losingPage.getByText("Sold out", { exact: true }).first()).toBeVisible();
      assert.deepEqual(
        histories.map((rows) => rows.length).sort((a, b) => a - b),
        [0, 1],
        "Only the winner has a booking",
      );
      const saved = histories.flat()[0];
      assert.equal(saved.State, "Held");
      assert.equal(saved.Price, "0.01 USD");
      assert.equal(saved.Supplier, "supplier-a");
      const response = await fetch(`${suite.suppliers[0].url}/air/orders/${saved.Order}`);
      const order = (await response.json()).data;
      assert.equal(order.type, "hold", "Use a real hold order");
      assert.equal(order.payment_status.awaiting_payment, true);
      assert.equal(order.payment_status.paid_at, null);
      assert.equal(saved.Expires, order.payment_status.payment_required_by);
      const orders = await calls(suite, suite.suppliers[0].url, "POST /air/orders");
      assert.equal(
        orders.filter((entry) => entry.status === 201).length,
        1,
        "Exactly one order takes the last seat",
      );
      const winningContext = histories[0].length ? context : otherContext;
      const winningPage = historyPages[histories[0].length ? 0 : 1];
      const twin = await winningContext.newPage();
      await history(twin, suite.app);
      await expect.poll(() => table(twin, "Bookings")).toEqual([saved]);
      await winningPage.reload({ waitUntil: "domcontentloaded" });
      await expect.poll(() => table(winningPage, "Bookings")).toEqual([saved]);
      await control(suite, suite.suppliers[0].url, "clock", { advanceMs: 3600000 });
      await expect
        .poll(async () => {
          await twin.reload({ waitUntil: "load" });
          return (await table(twin, "Bookings"))[0]?.State;
        })
        .toBe("Expired");
      const expired = await fetch(`${suite.suppliers[0].url}/air/orders/${saved.Order}`);
      const status = (await expired.json()).data.payment_status;
      assert.equal(status.awaiting_payment, false);
      assert.equal(status.paid_at, null);
    } finally {
      await otherContext.close();
      await observerContext.close();
    }
  });
}
