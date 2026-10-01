import { expect, inject, test } from "vite-plus/test";
import { commands, page } from "vite-plus/test/browser";

/** Browser commands select a real listener at the HTTP boundary. */
declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    selectPageServer(down: boolean): Promise<void>;
  }
}

test("a failed page entry keeps its style and reconnects through the existing dead page", async () => {
  const response = await fetch(inject("tracker"));
  const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
  document.documentElement.innerHTML = parsed.documentElement.innerHTML;
  document.documentElement.dataset.serverPage = "true";
  document.documentElement.lang = "en";
  for (const script of document.querySelectorAll("script:not([src])")) {
    const boot = document.createElement("script");
    for (const attribute of script.attributes) boot.setAttribute(attribute.name, attribute.value);
    boot.textContent = script.textContent;
    script.replaceWith(boot);
  }
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  await commands.selectPageServer(true);
  try {
    await import("../src/client/page-main.tsx");
    await expect.element(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
    expect(document.querySelector("#root")).not.toBeNull();
    for (const style of styles) expect(document.head.contains(style)).toBe(true);
    await commands.selectPageServer(false);
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expect
      .poll(() => document.querySelector('[aria-label="issues"]')?.textContent)
      .toContain("First HTML title");
  } finally {
    await commands.selectPageServer(false);
  }
});
