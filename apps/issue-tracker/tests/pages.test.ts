import { createElement } from "react";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { isError, issueList, issueServer } from "../src/index.ts";

import { createIssuePages, readPageAssets } from "@tinker-issue-tracker/server-pages";
import { createPageRouter } from "@tinker-issue-tracker/pages";

const assets = { script: "/assets/client.js", styles: ["/assets/style.css"], dev: false };

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
