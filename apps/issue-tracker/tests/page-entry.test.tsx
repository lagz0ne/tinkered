import { expect, inject, test } from "vite-plus/test";

test("the real page entry keeps its first list, follows sync, and stops on pagehide", async () => {
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
  const before = document.querySelector('[aria-label="issues"]');
  const done = import("../src/client/page-main.tsx");
  try {
    const title = `Page entry ${crypto.randomUUID()}`;
    const saved = await fetch("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, description: "real entry" }),
    });
    expect(saved.status).toBe(201);
    await expect
      .poll(() => document.querySelector('[aria-label="issues"]')?.textContent)
      .toContain(title);
    expect(document.querySelector('[aria-label="issues"]')).toBe(before);
  } finally {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await done;
  }
  expect(document.querySelector("main")).toBeNull();
});
