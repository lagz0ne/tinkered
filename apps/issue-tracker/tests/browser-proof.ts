import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4311";

/** Two-tab proof: create in tab A, observe in tab B without refresh, reload A.
 * The title is unique per run, so a stale row can never fake a pass. */
async function main(): Promise<void> {
  const title = `Two-tab proof ${Date.now()}`;
  const browser = await chromium.launch();
  try {
    const first = await browser.newPage();
    const second = await browser.newPage();
    await first.goto(BASE);
    await second.goto(BASE);
    await first.getByRole("heading", { name: "Issues" }).waitFor();
    await second.getByRole("heading", { name: "Issues" }).waitFor();

    await first.getByLabel("Title").fill(title);
    await first.getByLabel("Description").fill("saved once, seen twice");
    await first.getByRole("button", { name: "Create issue" }).click();

    await first.getByText(title).waitFor();
    await second.getByText(title).waitFor();

    await first.reload();
    await first.getByRole("heading", { name: "Issues" }).waitFor();
    await first.getByText(title).waitFor();

    await first.close();
    await second.close();
  } finally {
    await browser.close();
  }
}

await main();
