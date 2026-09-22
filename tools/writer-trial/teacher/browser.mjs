import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5173");
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname),
  "Use a local evaluation server",
);
const round = Number(process.argv[2] ?? "1");
assert.ok(Number.isInteger(round) && round >= 1 && round <= 4, "round is 1-4");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(5000);
const cancel = (title) => page.getByRole("button", { name: `Cancel ${title}`, exact: true });

async function form(title, room, start, end) {
  await page.getByLabel("Title", { exact: true }).fill(title);
  const roomField = page.getByLabel("Room", { exact: true });
  const tag = await roomField.evaluate((el) => el.tagName);
  if (tag === "SELECT") await roomField.selectOption({ label: room });
  else await roomField.fill(room);
  await page.getByLabel("Start time", { exact: true }).fill(start);
  await page.getByLabel("End time", { exact: true }).fill(end);
}

async function firstRound() {
  await form("Browser A", "Cedar", "09:00", "10:00");
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await cancel("Browser A").waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "");
  await form("Browser clash", "Cedar", "09:30", "10:30");
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Clash" }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Browser clash");
  assert.equal(await cancel("Browser clash").count(), 0);
  await page.getByRole("button", { name: "Maple", exact: true }).click();
  await cancel("Browser A").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "All", exact: true }).click();
  await cancel("Browser A").waitFor();
  console.log("browser r1 pass: save, failed form, filter preserves data");
}

async function secondRound() {
  await page.getByRole("button", { name: "Edit Browser A", exact: true }).click();
  await page.getByLabel("Edit title", { exact: true }).fill("Discarded");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await cancel("Browser A").waitFor();
  assert.equal(await cancel("Discarded").count(), 0);
  await page.getByRole("button", { name: "Edit Browser A", exact: true }).click();
  await page.getByLabel("Edit title", { exact: true }).fill("Browser renamed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await cancel("Browser renamed").waitFor();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "hidden" });
  console.log("browser r2 pass: discard and save");
}

async function thirdRound() {
  await form("Browser series", "Maple", "11:00", "12:00");
  await page.getByLabel("Date", { exact: true }).fill("2026-10-06");
  await page.getByLabel("Weeks", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Book series", exact: true }).click();
  await cancel("Browser series").nth(2).waitFor();
  assert.equal(await cancel("Browser series").count(), 3);
  await page.getByRole("button", { name: "Cancel series", exact: true }).first().click();
  await cancel("Browser series").first().waitFor({ state: "hidden" });
  assert.equal(await cancel("Browser series").count(), 0);
  console.log("browser r3 pass: create and cancel whole series");
}

async function fourthRound() {
  await page.getByLabel("Title", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await cancel("Browser series").first().waitFor();
  assert.equal(await cancel("Browser series").count(), 3);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Keep this draft");
  await page.reload();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "EmptyUndo" }).waitFor();
  console.log("browser r4 pass: restore series, preserve draft, empty undo");
}

try {
  await page.goto(base.href);
  await firstRound();
  if (round >= 2) await secondRound();
  if (round >= 3) await thirdRound();
  if (round >= 4) await fourthRound();
  console.log(`teacher browser round ${round}: pass`);
} finally {
  await browser.close();
}
