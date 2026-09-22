import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail });
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
  }
}
const vite = await createServer({
  root: "/work",
  configFile: false,
  cacheDir: "/tmp/review-core",
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
try {
  const app = await vite.ssrLoadModule("/src/index.ts");
  const { createScope } = await vite.ssrLoadModule("@tinker/core");
  await check("creation order after an edit ties start times", async () => {
    const s = createScope();
    try {
      const a = s.run(app.bookBooking, {
        input: { title: "Older", room: "Cedar", start: 600, end: 660 },
      });
      s.run(app.bookBooking, { input: { title: "Newer", room: "Maple", start: 540, end: 600 } });
      s.run(app.openEdit, { input: { id: a.id } });
      s.run(app.saveEdit, {
        input: { id: a.id, title: "Older", room: "Cedar", start: 540, end: 600 },
      });
      const got = s.resolve(app.bookings).map((b) => b.title);
      assert.deepEqual(got, ["Older", "Newer"]);
      return got;
    } finally {
      await s.close();
    }
  });
  await check("valid four-digit early year", async () => {
    const s = createScope();
    try {
      const b = s.run(app.bookBooking, {
        input: { title: "Ancient", room: "Cedar", date: "0099-10-01", start: 540, end: 600 },
      });
      assert.equal(b.date, "0099-10-01");
    } finally {
      await s.close();
    }
  });
} finally {
  await vite.close();
}
const server = await createServer({
  root: "/work",
  configFile: false,
  cacheDir: "/tmp/review-browser",
  optimizeDeps: {
    include: ["react", "react-dom/client", "react/jsx-runtime", "@tinker/core", "@tinker/react"],
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  logLevel: "silent",
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  async function book(title, room, start, end) {
    for (const [label, value] of [
      ["Title", title],
      ["Room", room],
      ["Start time", start],
      ["End time", end],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await page.getByRole("button", { name: `Cancel ${title}`, exact: true }).waitFor();
  }
  await check("switching drafts drops first unsaved text", async () => {
    await page.goto("http://127.0.0.1:5173");
    await book("Alpha", "Cedar", "09:00", "10:00");
    await book("Beta", "Maple", "11:00", "12:00");
    await page.getByRole("button", { name: "Edit Alpha", exact: true }).click();
    await page.getByLabel("Edit title", { exact: true }).fill("UNSAVED Alpha");
    await page.getByRole("button", { name: "Edit Beta", exact: true }).click();
    const actual = await page.getByLabel("Edit title", { exact: true }).inputValue();
    assert.equal(actual, "Beta");
  });
  await check("blank date reports BadDate and saves nothing", async () => {
    await page.goto("http://127.0.0.1:5173");
    for (const [label, value] of [
      ["Title", "BlankDate"],
      ["Room", "Cedar"],
      ["Start time", "09:00"],
      ["End time", "10:00"],
      ["Date", ""],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[role="alert"]')?.textContent?.includes("BadDate") ||
        Array.from(document.querySelectorAll("button")).some(
          (b) =>
            b.getAttribute("aria-label") === "Cancel BlankDate" ||
            b.textContent?.trim() === "Cancel BlankDate",
        ),
    );
    assert.equal(
      await page.getByRole("button", { name: "Cancel BlankDate", exact: true }).count(),
      0,
    );
    assert.match(await page.getByRole("alert").innerText(), /BadDate/);
  });
} finally {
  await browser?.close();
  await server.close();
}
console.log("REVIEW_RESULTS " + JSON.stringify(results));
