import { expect, test } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import css from "@/style.css?raw";

const names = [
  "main.tsx",
  "ocean.ts",
  "state.ts",
  "engine.ts",
  "draw.ts",
  "loop.ts",
  "App.tsx",
  "Scene.tsx",
  "style.ts",
];

test("a long row of file tabs scrolls by itself and leaves the page as wide as the phone", async () => {
  await page.viewport(390, 800);
  const tabs = names.map((name) => `<span class="tab"><button>${name}</button></span>`).join("");
  document.body.innerHTML = `<style>${css}</style><main class="play" data-view="code"><div class="panes">
    <section class="code"><div class="tabs" role="tablist">${tabs}</div></section>
  </div></main>`;

  const row = page.getByRole("tablist").element();

  expect(document.documentElement.scrollWidth).toBe(390);
  expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
});
