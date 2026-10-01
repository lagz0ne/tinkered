import { expect, test } from "vite-plus/test";

test("the page entry still boots a plain HTML shell from the first sync snapshot", async () => {
  document.documentElement.dataset.serverPage = "false";
  document.body.innerHTML = '<div id="root"></div>';
  await import("../src/client/page-main.tsx");
  await expect
    .poll(() => document.querySelector('[aria-label="issues"]')?.textContent)
    .toContain("First HTML title");
});
