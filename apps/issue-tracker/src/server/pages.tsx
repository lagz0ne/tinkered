import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequestHandler as createSsrRequest } from "@tanstack/react-router/ssr/server";
import { defaultStreamHandler as renderStream } from "@tanstack/react-router/ssr/server";
import { operation } from "@tinker/core";
import { pages } from "@tinker/stack/pages";
import { App } from "../client/App.tsx";
import { issueList } from "../shared/issues.ts";
import { createPageRouter, type Page } from "../shared/page.tsx";
import { raise } from "../errors.ts";

/** Shadow the published list once: the HTML and its payload share the same snapshot,
 * even if another request publishes while React is still streaming. */
const readPage = operation({
  label: "issues.pageCells",
  depends: { issues: issueList.controller },
  run({ issues }) {
    const values = issues.get();
    issues.set(values);
    return values;
  },
});

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

function readEntry(raw: unknown): { file: string; css: string[] } {
  if (!isRecord(raw)) raise("BadPage", {});
  if (typeof raw.file !== "string") raise("BadPage", {});
  const css = raw.css ?? [];
  if (!Array.isArray(css)) raise("BadPage", {});
  const styles = css.filter((value): value is string => typeof value === "string");
  if (styles.length !== css.length) raise("BadPage", {});
  return { file: raw.file, css: styles };
}

/** Vite's manifest is a file boundary. Only the page's entry and styles are needed. */
export async function readPageAssets(dir: string): Promise<Page.Assets> {
  const raw: unknown = JSON.parse(await readFile(join(dir, ".vite", "manifest.json"), "utf8"));
  if (!isRecord(raw)) raise("BadPage", {});
  const entry = readEntry(raw["index.html"]);
  return { script: `/${entry.file}`, styles: entry.css.map((file) => `/${file}`), dev: false };
}

export function createIssuePages(assets: Page.Assets) {
  return pages({
    component: App,
    read: readPage,
    render(request, issues, content) {
      return createSsrRequest({
        request,
        createRouter: () => createPageRouter({ issues, content, assets }),
      })(renderStream);
    },
  });
}
