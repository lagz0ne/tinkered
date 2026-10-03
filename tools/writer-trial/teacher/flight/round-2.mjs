import assert from "node:assert/strict";
import {
  reset,
  quote,
  cheapest,
  search,
  complete,
  assertFlights,
  calls,
  control,
  table,
  expect,
} from "./common.mjs";
export async function round2(suite, test) {
  await test("r2 all suppliers start together and fast rows arrive before slow ones", async (page) => {
    await reset(suite);
    const a = await quote(suite, suite.suppliers[0]);
    await reset(suite);
    for (const supplier of suite.suppliers.slice(1))
      await control(suite, supplier.url, "routes", {
        route: "POST /air/offer_requests",
        delayMs: 1000,
      });
    await search(page, suite.app);
    for (const supplier of suite.suppliers)
      await expect
        .poll(async () => (await calls(suite, supplier.url, "POST /air/offer_requests")).length)
        .toBe(1);
    await expect(page.getByText("supplier-a: done", { exact: true })).toBeVisible();
    await assertFlights(page, cheapest(a));
    await expect(page.getByText("Searching", { exact: true })).toBeVisible();
    for (const supplier of suite.suppliers.slice(1)) {
      await expect(page.getByText(`${supplier.id}: pending`, { exact: true })).toBeVisible();
      assert.equal(
        (await calls(suite, supplier.url, "POST /air/offer_requests"))[0].status,
        0,
        "The slow supplier must still be waiting",
      );
      await control(suite, supplier.url, "clock", { advanceMs: 1000 });
      await expect(page.getByText(`${supplier.id}: done`, { exact: true })).toBeVisible();
    }
    await complete(page);
  });
  await test("r2 a cheaper late fare merges and a failed supplier keeps good rows", async (page) => {
    await reset(suite);
    const a = await quote(suite, suite.suppliers[0]);
    const b = await quote(suite, suite.suppliers[1]);
    const shared = b.find((row) => a.some((other) => other.flight_id === row.flight_id));
    assert.ok(shared, "A and B must share a flight on the known route");
    await reset(suite);
    await control(suite, suite.suppliers[1].url, "flights", {
      flight_id: shared.flight_id,
      cabin_class: "economy",
      fare_class: "saver",
      amount_cents: 1,
    });
    await control(suite, suite.suppliers[1].url, "routes", {
      route: "POST /air/offer_requests",
      delayMs: 1000,
    });
    await control(suite, suite.suppliers[2].url, "routes", {
      route: "POST /air/offer_requests",
      status: 503,
    });
    await search(page, suite.app);
    await expect(page.getByText("supplier-a: done", { exact: true })).toBeVisible();
    await expect(page.getByText("supplier-c: failed", { exact: true })).toBeVisible();
    await assertFlights(page, cheapest(a));
    await control(suite, suite.suppliers[1].url, "clock", { advanceMs: 1000 });
    await complete(page);
    await assertFlights(
      page,
      cheapest([
        ...a,
        ...b.map((row) =>
          row.flight_id === shared.flight_id ? { ...row, total_amount: "0.01" } : row,
        ),
      ]),
    );
    for (const supplier of suite.suppliers)
      assert.equal(
        (await calls(suite, supplier.url, "POST /air/offer_requests")).length,
        1,
        "Merging must not search again",
      );
  });
  await test("r2 a new search drops late rows from the old search", async (page) => {
    await reset(suite);
    const expected = cheapest(
      (
        await Promise.all(
          suite.suppliers.map((supplier) =>
            quote(suite, supplier, { origin: "LHR", destination: "JFK", date: "2027-01-16" }),
          ),
        )
      ).flat(),
    );
    assert.ok(expected.length > 0, "The second route must have flights");
    await reset(suite);
    await control(suite, suite.suppliers[1].url, "routes", {
      route: "POST /air/offer_requests",
      delayMs: 1000,
    });
    await search(page, suite.app);
    await expect(page.getByText("supplier-a: done", { exact: true })).toBeVisible();
    await expect
      .poll(
        async () => (await calls(suite, suite.suppliers[1].url, "POST /air/offer_requests")).length,
      )
      .toBe(1);
    await page.getByLabel("Destination", { exact: true }).fill("JFK");
    await page.getByLabel("Departure date", { exact: true }).fill("2027-01-16");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    for (const supplier of suite.suppliers)
      await expect
        .poll(async () => (await calls(suite, supplier.url, "POST /air/offer_requests")).length)
        .toBe(2);
    await expect
      .poll(async () => (await table(page, "Flights")).every((row) => row.To === "JFK"))
      .toBe(true);
    await control(suite, suite.suppliers[1].url, "clock", { advanceMs: 1000 });
    await complete(page);
    await assertFlights(page, expected);
    for (const supplier of suite.suppliers)
      assert.equal(
        (await calls(suite, supplier.url, "POST /air/offer_requests")).length,
        2,
        "New search must ask each supplier only once",
      );
  });
}
