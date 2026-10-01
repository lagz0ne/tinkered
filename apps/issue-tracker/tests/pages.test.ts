import { createElement } from "react";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScope, extension } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { fail, isError, issueList, issueServer, parseIssue } from "../src/index.ts";

import { createIssuePages, readPageAssets } from "@tinker-issue-tracker/server-pages";
import { createPageRouter } from "@tinker-issue-tracker/pages";

const assets = { script: "/assets/client.js", styles: ["/assets/style.css"], dev: false };

test("a page keeps one cell snapshot while the parent publishes", async () => {
  const before = [
    parseIssue({
      id: "before",
      title: "Before publish",
      description: "first",
      status: "open",
      assignee: null,
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
    }),
  ];
  const after = [parseIssue({ ...before[0], id: "after", title: "After publish" })];
  const page = createIssuePages(assets);
  const web = issueServer({ mount: page.mount });
  const change = extension({
    label: "publish-during-page",
    hooks: {
      async run(event) {
        const result = await event.next();
        if (event.op.label === "issues.pageCells") scope.controller(issueList).set(after);
        return result;
      },
    },
  });
  const scope = createScope({ extensions: [web, page.extension, change] });
  try {
    await scope.ready;
    scope.controller(issueList).set(before);
    const response = await scope.resolve(web).request("/");
    const html = await response.text();
    expect(html).toContain("<strong>Before publish</strong>");
    expect(html).not.toContain("<strong>After publish</strong>");
    expect(scope.resolve(issueList)).toEqual(after);
  } finally {
    await scope.close();
  }
});

test("a page carries its cells and assets through Router's public payload", async () => {
  const content = createElement("main");
  const from = createPageRouter({ issues: [], content, assets });
  const values: unknown[] = [];
  const into = createPageRouter({
    issues: [],
    content,
    assets: { script: "old.js", styles: [], dev: true },
    hydrate: (issues) => values.push(issues),
  });
  const payload = await from.options.dehydrate?.();
  expect(payload).toEqual({ issues: [], assets });
  if (payload === undefined) return expect.unreachable();
  await into.options.hydrate?.(payload);
  expect(values).toEqual([[]]);
  expect(into.options.context?.assets).toEqual(assets);
  await from.options.hydrate?.(payload);
});

test("a server page names its style, client entry, and dev refresh scripts", async () => {
  const page = createIssuePages({ ...assets, dev: true });
  const web = issueServer({ mount: page.mount });
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('href="/assets/style.css"');
    expect(html).toContain('src="/assets/client.js"');
    expect(html).toContain('src="/@vite/client"');
    expect(html).toContain('import refresh from "/@react-refresh"');
    expect(html).toContain("__vite_plugin_react_preamble_installed__ = true");
  } finally {
    await scope.close();
  }
});

test("a page error guard accepts its own error and rejects other values", () => {
  const error = fail("BadPage", {});
  if (!isError(error, "BadPage")) throw error;
  expect(error.payload).toEqual({});
  for (const value of [
    null,
    undefined,
    {},
    { kind: "BadPage" },
    new Error("BadPage"),
    fail("DraftOff", {}),
  ]) {
    if (isError(value, "BadPage")) expect.unreachable();
  }
});

test("the page uses TanStack's 404 for an unknown page path", async () => {
  const page = createIssuePages(assets);
  const web = issueServer({ mount: page.mount });
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/missing");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("<h1>Page not found</h1>");
  } finally {
    await scope.close();
  }
});

test.each([
  {
    name: "styles",
    entry: { file: "assets/client.js", css: ["assets/style.css"] },
    styles: ["/assets/style.css"],
  },
  { name: "no styles", entry: { file: "assets/client.js" }, styles: [] },
])(
  "the built page gets its client script and $name from Vite's manifest",
  async ({ entry, styles }) => {
    const directory = await mkdtemp(join(tmpdir(), "tracker-page-"));
    try {
      await mkdir(join(directory, ".vite"));
      await writeFile(
        join(directory, ".vite/manifest.json"),
        JSON.stringify({ "index.html": entry }),
      );
      expect(await readPageAssets(directory)).toEqual({
        script: "/assets/client.js",
        styles,
        dev: false,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.each([
  null,
  {},
  { "index.html": null },
  { "index.html": { file: 1 } },
  { "index.html": { file: "client.js", css: "style.css" } },
  { "index.html": { file: "client.js", css: [1] } },
])("a bad client manifest refuses page boot: %j", async (manifest) => {
  const directory = await mkdtemp(join(tmpdir(), "tracker-page-bad-"));
  try {
    await mkdir(join(directory, ".vite"));
    await writeFile(join(directory, ".vite/manifest.json"), JSON.stringify(manifest));
    const error = await readPageAssets(directory).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!isError(error, "BadPage")) throw error;
    expect(error.payload).toEqual({});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each([
  null,
  { issues: [], assets: null },
  { issues: [], assets: { ...assets, script: 1 } },
  { issues: [], assets: { ...assets, dev: "true" } },
  { issues: [], assets: { ...assets, styles: "style.css" } },
  { issues: [], assets: { ...assets, styles: [1] } },
])("a bad page payload refuses hydrate: %j", async (payload) => {
  const scope = createScope();
  const router = createPageRouter({
    issues: scope.resolve(issueList),
    content: createElement("main"),
    assets,
  });
  try {
    const error = await Promise.resolve()
      .then(() => router.options.hydrate?.(JSON.parse(JSON.stringify(payload))))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    if (!isError(error, "BadPage")) throw error;
    expect(error.payload).toEqual({});
  } finally {
    await scope.close();
  }
});
