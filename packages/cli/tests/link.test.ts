import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

import { check, main } from "@/index";

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A fresh app folder that holds only these files. */
function appOf(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-link-"));
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }

  return folder;
}

/** Check one page that renders these lines; answer each link finding as text. */
function links(lines: string[]) {
  const page = ["export const View = () => (", "  <nav>", ...lines, "  </nav>", ");"];

  return check(appOf({ "src/view.tsx": page.join("\n") }))
    .findings.filter(({ rule }) => rule === "tinker/link")
    .map(({ path, line, rule, what }) => `${path}:${line} ${rule} ${what}`);
}

test("an <a> whose href is written out as a path in the app is a finding", () => {
  const hits = links([
    `    <a href="/issues">Issues</a>`,
    "    <a href={`/issues/${team}/${id}`}>{title}</a>",
    `    <a href={"./next"} />`,
    "    <a href={`?page=2`}>More</a>",
  ]);

  expect(hits).toEqual([
    "src/view.tsx:3 tinker/link a plain <a href> to an in-app path reloads the page",
    "src/view.tsx:4 tinker/link a plain <a href> to an in-app path reloads the page",
    "src/view.tsx:5 tinker/link a plain <a href> to an in-app path reloads the page",
    "src/view.tsx:6 tinker/link a plain <a href> to an in-app path reloads the page",
  ]);
});

test("a link to another site, a mail or phone link, or a link to a spot on the page passes", () => {
  const hits = links([
    `    <a href="https://example.com/issues">Docs</a>`,
    `    <a href="MAILTO:help@example.com">Mail</a>`,
    "    <a href={`tel:${phone}`}>Call</a>",
    `    <a href="//cdn.example.com/a.png">Image</a>`,
    `    <a href="#top">Top</a>`,
  ]);

  expect(hits).toEqual([]);
});

test("a link to a file the server sends passes: no route answers it", () => {
  const hits = links([
    `    <a href="/llms.txt">llms.txt</a>`,
    "    <a href={`/llms/${slug}.md`}>Markdown</a>",
    "    <a href={`/sea.html?room=${room}`}>Sea</a>",
  ]);

  expect(hits).toEqual([]);
});

test("an href the rule cannot read passes: it does not guess", () => {
  const hits = links([
    `    <a href={url}>Open</a>`,
    "    <a href={`${base}/issues`}>Issues</a>",
    `    <a href="">Here</a>`,
    `    <a>No href</a>`,
  ]);

  expect(hits).toEqual([]);
});

test("a download, a new tab, or rel=external passes; a link that stays is a finding", () => {
  const hits = links([
    `    <a href="/issues/export" download>Export</a>`,
    `    <a href="/issues" target="_blank">Open in a new tab</a>`,
    `    <a href="/issues" rel="noopener external">Away</a>`,
    `    <a href="/issues" target="_self" rel="noopener">Stay</a>`,
  ]);

  expect(hits).toEqual([
    "src/view.tsx:6 tinker/link a plain <a href> to an in-app path reloads the page",
  ]);
});

test("the finding prints the Right part of the skill section for tinker/link", () => {
  const skill = [
    "---",
    "name: react",
    "description: Use when a check prints tinker/link.",
    "---",
    "",
    "### HIGH: a plain `<a href>` to a page of the app [tinker/link]",
    "",
    "Right: the router's `Link`.",
    "",
  ];
  const folder = appOf({
    "src/view.tsx": `export const View = () => <a href="/issues">Issues</a>;\n`,
    "node_modules/@tinkered/react/package.json": JSON.stringify({
      name: "@tinkered/react",
      version: "1.0.0",
      keywords: ["tanstack-intent"],
      repository: { type: "git", url: "git+https://github.com/lagz0ne/tinkered.git" },
    }),
    "node_modules/@tinkered/react/skills/react/SKILL.md": skill.join("\n"),
    "package.json": JSON.stringify({
      dependencies: { "@tinkered/react": "1.0.0" },
      intent: { skills: ["@tinkered/*"] },
    }),
  });

  const { out } = main(["check", "."], folder);

  expect(out).toContain(
    [
      "src/view.tsx:1 tinker/link a plain <a href> to an in-app path reloads the page",
      "  Right: the router's `Link`.",
      "  more: tinker skill load @tinkered/react#react",
    ].join("\n"),
  );
});
