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
  expect,
} from "./common.mjs";
export async function round1(suite, test) {
  await test("r1 public search shows real fares and asks each active supplier once", async (page) => {
    await reset(suite);
    const active = suite.round === 1 ? suite.suppliers.slice(0, 1) : suite.suppliers;
    const expected = cheapest(
      (await Promise.all(active.map((supplier) => quote(suite, supplier)))).flat(),
    );
    assert.ok(expected.length > 0, "The known route must have fares");
    await reset(suite);
    await search(page, suite.app);
    await complete(page);
    await assertFlights(page, expected);
    for (const supplier of suite.suppliers)
      assert.equal(
        (await calls(suite, supplier.url, "POST /air/offer_requests")).length,
        active.includes(supplier) ? 1 : 0,
        `${supplier.id} search call count is wrong`,
      );
  });
  await test("r1 empty route replaces old rows", async (page) => {
    await reset(suite);
    await search(page, suite.app);
    await complete(page);
    await page.getByLabel("Destination", { exact: true }).fill("ZZZ");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await complete(page);
    await expect(page.getByText("No flights", { exact: true })).toBeVisible();
    await assertFlights(page, []);
  });
  await test("r1 a supplier failure is shown and the form works again", async (page) => {
    await reset(suite);
    await control(suite, suite.suppliers[0].url, "routes", {
      route: "POST /air/offer_requests",
      status: 503,
    });
    await search(page, suite.app);
    await complete(page);
    await expect(page.getByText("supplier-a: failed", { exact: true })).toBeVisible();
    await control(suite, suite.suppliers[0].url, "routes", { route: "POST /air/offer_requests" });
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await complete(page);
    await expect(page.getByText("supplier-a: failed", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Flights" }).getByRole("row")).not.toHaveCount(1);
  });
}
