import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const moduleName = process.env.FLIGHT_PLAYWRIGHT_MODULE ?? "playwright";
const importName = moduleName.startsWith("/") ? pathToFileURL(moduleName).href : moduleName;
export const { chromium } = await import(importName);
const checks = await import(
  importName === "playwright" ? "playwright/test" : new URL("./test.mjs", importName).href
);
export const expect = checks.expect.configure({ timeout: 30000 });

export function settings() {
  const round = Number(process.argv[2]);
  assert.ok(Number.isInteger(round) && round >= 1 && round <= 5, "Choose round 1 through 5");
  for (const name of [
    "APP_URL",
    "SUPPLIER_A_URL",
    "SUPPLIER_B_URL",
    "SUPPLIER_C_URL",
    "PAYMENT_URL",
    "CONTROL_TOKEN",
  ])
    assert.ok(process.env[name], `Missing ${name}`);
  if (round >= 4) assert.ok(process.env.WEBHOOK_SECRET, "Missing WEBHOOK_SECRET");
  if (round >= 5) assert.ok(process.env.MAILPIT_URL, "Missing MAILPIT_URL");
  return {
    round,
    app: process.env.APP_URL,
    token: process.env.CONTROL_TOKEN,
    suppliers: ["A", "B", "C"].map((letter) => ({
      id: `supplier-${letter.toLowerCase()}`,
      url: process.env[`SUPPLIER_${letter}_URL`],
    })),
    payment: process.env.PAYMENT_URL,
    mailpit: process.env.MAILPIT_URL,
    webhookSecret: process.env.WEBHOOK_SECRET,
  };
}
export async function control(suite, url, path, body) {
  const response = await fetch(`${url}/control/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${suite.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const reply = await response.json();
  assert.ok(response.ok, `Control ${path} failed with HTTP ${response.status}`);
  return reply;
}
export async function reset(suite, scenario = "default") {
  suite.callOffsets = {};
  for (const { url } of suite.suppliers) {
    await control(suite, url, "clock", { now: Date.now() + 60000 });
    await control(suite, url, "scenario", { name: scenario });
    await control(suite, url, "routes", { route: "POST /air/offer_requests" });
    await control(suite, url, "routes", { route: "POST /air/orders" });
    suite.callOffsets[url] = (await control(suite, url, "calls")).data.length;
  }
  await control(suite, suite.payment, "clock", { now: Date.now() + 60000 });
  await control(suite, suite.payment, "scenario", { name: "default" });
  suite.callOffsets[suite.payment] = (await control(suite, suite.payment, "calls")).data.length;
}
export async function calls(suite, url, route) {
  const reply = await control(suite, url, "calls");
  return reply.data
    .slice(suite.callOffsets?.[url] ?? 0)
    .filter((entry) => (route instanceof RegExp ? route.test(entry.route) : entry.route === route));
}
export async function quote(
  suite,
  supplier,
  query = { origin: "LHR", destination: "AMS", date: "2027-01-15" },
) {
  const response = await fetch(`${supplier.url}/air/offer_requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: {
        slices: [
          { origin: query.origin, destination: query.destination, departure_date: query.date },
        ],
        passengers: [{ type: "adult" }],
        cabin_class: "economy",
      },
    }),
  });
  assert.ok(response.ok, `Supplier ${supplier.id} did not answer the teacher's quote`);
  const reply = await response.json();
  return reply.data.offers
    .filter((row) => row.fare_class === "saver")
    .map((row) => ({ ...row, supplier: supplier.id }));
}
export function cheapest(offers) {
  const rows = new Map();
  for (const row of offers) {
    const old = rows.get(row.flight_id);
    if (
      !old ||
      Number(row.total_amount) < Number(old.total_amount) ||
      (row.total_amount === old.total_amount && row.supplier < old.supplier)
    )
      rows.set(row.flight_id, row);
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(a.total_amount) - Number(b.total_amount) ||
      a.flight_id.localeCompare(b.flight_id) ||
      a.supplier.localeCompare(b.supplier),
  );
}
export async function search(page, app, destination = "AMS", date = "2027-01-15") {
  await page.goto(`${app}/flights`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await page.getByLabel("Origin", { exact: true }).fill("LHR");
  await page.getByLabel("Destination", { exact: true }).fill(destination);
  await page.getByLabel("Departure date", { exact: true }).fill(date);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}
export async function table(page, name) {
  return page.getByRole("table", { name, exact: true }).evaluateAll((grids) => {
    const grid = grids[0];
    if (!grid) return [];
    const headers = [...grid.querySelectorAll('th:not([scope="row"]), [role="columnheader"]')].map(
      (cell) => cell.textContent.trim(),
    );
    if (!headers.length) return [];
    return [...grid.querySelectorAll('tr, [role="row"]')].flatMap((row) => {
      const cells = [...row.querySelectorAll('td, [role="cell"]')].map((cell) =>
        cell.textContent.trim(),
      );
      return cells.length
        ? [Object.fromEntries(headers.map((header, index) => [header, cells[index]]))]
        : [];
    });
  });
}
export async function complete(page) {
  await expect(page.getByText("Search complete", { exact: true })).toBeVisible();
}
export function shownOffers(offers) {
  return offers.map((row) => ({
    Flight: row.flight_id,
    From: row.slices[0].origin.iata_code,
    To: row.slices[0].destination.iata_code,
    Departs: row.slices[0].segments[0].departing_at,
    Arrives: row.slices[0].segments[0].arriving_at,
    Price: `${row.total_amount} USD`,
    Supplier: row.supplier,
    Seats: String(row.available_seats),
  }));
}
export async function assertFlights(page, offers) {
  const rows = await table(page, "Flights");
  assert.deepEqual(
    rows.map(({ Flight, From, To, Departs, Arrives, Price, Supplier, Seats }) => ({
      Flight,
      From,
      To,
      Departs,
      Arrives,
      Price,
      Supplier,
      Seats,
    })),
    shownOffers(offers),
    "Flights must show the exact current fares, once each, in price order",
  );
}
export async function account(page, app, email) {
  await page.goto(`${app}/`);
  await page.getByRole("button", { name: "Make an account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Flight traveler");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("flight-trial-password");
  await page.getByRole("button", { name: "Make account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
}
