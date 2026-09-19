import { strict as assert } from "node:assert";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4311";

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

    const row = first.getByRole("button", { name: new RegExp(title) }).first();
    await row.click();
    await first.getByRole("heading", { name: title }).waitFor();
    const detail = first.getByRole("region", { name: "issue detail" });
    const editForm = first.getByRole("form", { name: "edit issue" });
    await editForm.getByLabel("Status").selectOption("in_progress");
    await editForm.getByLabel("Assignee").selectOption("Ada");
    await first.getByRole("button", { name: /Save \(rev/ }).click();
    await detail.getByText("In progress · Ada").waitFor();

    const otherRow = second.getByRole("button", { name: new RegExp(title) }).first();
    await otherRow.click();
    await second.getByRole("heading", { name: title }).waitFor();
    const secondDetail = second.getByRole("region", { name: "issue detail" });
    const secondEdit = second.getByRole("form", { name: "edit issue" });
    await second.getByRole("textbox", { name: "Comment" }).fill("seen across tabs");
    await second.getByRole("button", { name: "Add comment" }).click();
    await secondDetail.getByText("seen across tabs").waitFor();
    await detail.getByText("seen across tabs").waitFor();

    await first.getByRole("textbox", { name: "Comment" }).fill("draft stays local");
    await secondEdit.getByLabel("Status").selectOption("done");
    await second.getByRole("button", { name: /Save \(rev/ }).click();
    await secondDetail.getByText("Done · Ada").waitFor();
    const kept = await first.getByRole("textbox", { name: "Comment" }).inputValue();
    assert.equal(kept, "draft stays local", "draft was overwritten by sync");

    await first.close();
    await second.close();
  } finally {
    await browser.close();
  }
}

async function conflict(): Promise<void> {
  const title = `Conflict proof ${Date.now()}`;
  const browser = await chromium.launch();
  try {
    const left = await browser.newPage();
    const right = await browser.newPage();
    await left.goto(BASE);
    await right.goto(BASE);
    await left.getByRole("heading", { name: "Issues" }).waitFor();
    await right.getByRole("heading", { name: "Issues" }).waitFor();

    await left.getByLabel("Title").fill(title);
    await left.getByLabel("Description").fill("stale save loses nothing");
    await left.getByRole("button", { name: "Create issue" }).click();
    await left.getByText(title).waitFor();
    await right.getByText(title).waitFor();

    await left
      .getByRole("button", { name: new RegExp(title) })
      .first()
      .click();
    await left.getByRole("heading", { name: title }).waitFor();
    await right
      .getByRole("button", { name: new RegExp(title) })
      .first()
      .click();
    await right.getByRole("heading", { name: title }).waitFor();

    const leftDetail = left.getByRole("region", { name: "issue detail" });
    const leftEdit = left.getByRole("form", { name: "edit issue" });
    const rightDetail = right.getByRole("region", { name: "issue detail" });
    const rightEdit = right.getByRole("form", { name: "edit issue" });
    await leftEdit.getByRole("textbox", { name: "Title" }).waitFor();
    await rightEdit.getByRole("textbox", { name: "Title" }).waitFor();

    await rightEdit.getByRole("textbox", { name: "Title" }).fill(`${title} loser draft`);
    await leftEdit.getByRole("textbox", { name: "Title" }).fill(`${title} winner`);
    await left.getByRole("button", { name: /Save \(rev 0\)/ }).click();
    await leftDetail.getByText(`${title} winner`).waitFor();

    await rightDetail.getByText(`${title} winner`).waitFor();
    await right.getByRole("button", { name: /Save \(rev 0\)/ }).click();
    await right.getByText("Someone else saved first").waitFor();
    const retained = await rightEdit.getByRole("textbox", { name: "Title" }).inputValue();
    assert.equal(retained, `${title} loser draft`, "edit draft was lost on conflict");
    await right.getByRole("button", { name: "Reload their change" }).click();
    await rightDetail.getByText(`${title} winner`).waitFor();
    const reloaded = await rightEdit.getByRole("textbox", { name: "Title" }).inputValue();
    assert.equal(reloaded, `${title} winner`, "reload did not take their change");

    await left.close();
    await right.close();
  } finally {
    await browser.close();
  }
}

await main();
await conflict();
