import { expect, inject, test } from "vite-plus/test";
import { bootPage } from "@tinker-issue-tracker/pages";

/** Vitest's provided context is an open registry shared by setup and the browser. */
declare module "vite-plus/test" {
  interface ProvidedContext {
    tracker: string;
  }
}

function showPage(parsed: Document) {
  document.documentElement.innerHTML = parsed.documentElement.innerHTML;
  document.documentElement.dataset.serverPage = "true";
  document.documentElement.lang = "en";
  for (const script of document.querySelectorAll("script:not([src])")) {
    const boot = document.createElement("script");
    for (const attribute of script.attributes) boot.setAttribute(attribute.name, attribute.value);
    boot.textContent = script.textContent;
    script.replaceWith(boot);
  }
}

test("hydrate keeps the first list, accepts a live snapshot, and stops the browser root", async () => {
  const baseUrl = inject("tracker");
  const response = await fetch(baseUrl);
  const html = await response.text();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const list = parsed.querySelector('[aria-label="issues"]')!;
  expect(list.textContent).toContain("First HTML title");
  showPage(parsed);
  const before = document.querySelector('[aria-label="issues"]');
  const stop = new AbortController();
  const done = bootPage({ baseUrl }, stop.signal);
  try {
    await expect.poll(() => document.querySelector('[aria-label="issues"]')).toBe(before);
    await expect.poll(() => document.querySelector('[aria-live="polite"]')).toBeNull();
    const saved = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "After hydrate live title", description: "from SSE" }),
    });
    expect(saved.status).toBe(201);
    await expect
      .poll(() => document.querySelector('[aria-label="issues"]')?.textContent)
      .toContain("After hydrate live title");
    expect(document.querySelector('[aria-label="issues"]')).toBe(before);
  } finally {
    stop.abort();
    await done;
  }
  expect(document.querySelector("main")).toBeNull();
});

test("a missing page hydrates its 404 and stops the browser root", async () => {
  const baseUrl = inject("tracker");
  const response = await fetch(`${baseUrl}/missing`);
  expect(response.status).toBe(404);
  showPage(new DOMParser().parseFromString(await response.text(), "text/html"));
  const before = document.querySelector("h1");
  const stop = new AbortController();
  const done = bootPage({ baseUrl }, stop.signal);
  try {
    await expect.poll(() => document.querySelector("h1")?.textContent).toBe("Page not found");
    expect(document.querySelector("h1")).toBe(before);
  } finally {
    stop.abort();
    await done;
  }
  expect(document.querySelector("main")).toBeNull();
});
