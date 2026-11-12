import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

import { main } from "@/index";

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** The gaps doc of the tests: G1 open for 2 lines, G2 closed, G3 open for 1 line. */
const doc = [
  "# Gaps",
  "",
  "## G1: measuring the DOM",
  "",
  "- Status: open",
  "- Lines: 2",
  "",
  "## Notes",
  "",
  "- Status: open",
  "- Lines: 9",
  "",
  "## G2: done",
  "",
  "- Status: closed",
  "- Lines: 0",
  "",
  "## G3: auth",
  "",
  "- Status: open",
  "- Lines: 1",
].join("\n");

/** Run the command on an app with that doc named in its config, and these files. */
function run(files: Record<string, string[]>) {
  const folder = mkdtempSync(join(tmpdir(), "analyze-gaps-"));
  folders.push(folder);
  const all: Record<string, string> = {
    "tinker-analyze.json": JSON.stringify({ gaps: "docs/gaps.md" }),
    "docs/gaps.md": doc,
  };
  for (const [path, lines] of Object.entries(files)) all[path] = lines.join("\n");
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }

  const { code, out, err } = main(["check", folder], "/");
  return { code, out, hits: err.split("\n\n")[0] };
}

test("a marker on an open row allows the finding below it; the run prints the counts", () => {
  const result = run({
    "src/a.tsx": [
      `export const View = () => {`,
      `  // tinker-gap: G1`,
      `  useLayoutEffect(() => {});`,
      `    // tinker-gap: G3`,
      `  fetch("/auth");`,
      `  return <b />;`,
      `};`,
    ],
  });

  expect(result).toEqual({
    code: 0,
    out: "gaps: G1 1/2, G2 0/0 closed, G3 1/1\nno findings in 1 files\n",
    hits: "",
  });
});

test("a finding with no marker, or a marker two lines up, still breaks its rule", () => {
  const result = run({
    "src/a.ts": [
      `// tinker-gap: G1`,
      ``,
      `fetch("/a");`,
      `fetch("/b");`,
      `// tinker-gap G1`,
      `fetch("/c");`,
    ],
  });

  expect(result.code).toBe(1);
  expect(result.hits.split("\n")).toEqual([
    "src/a.ts:1 tinker/gap G1: a marker with no finding on the next line",
    "src/a.ts:3 tinker/one-wire `fetch`: a page's own network call",
    "src/a.ts:4 tinker/one-wire `fetch`: a page's own network call",
    "src/a.ts:6 tinker/one-wire `fetch`: a page's own network call",
  ]);
});

test("a marker for a closed row or a missing row breaks tinker/gap and keeps the finding", () => {
  const result = run({
    "src/a.ts": [`// tinker-gap: G2`, `fetch("/a");`, `// tinker-gap: G9`, `fetch("/b");`],
  });

  expect(result.hits.split("\n")).toEqual([
    "src/a.ts:1 tinker/gap G2: the row is closed",
    "src/a.ts:2 tinker/one-wire `fetch`: a page's own network call",
    "src/a.ts:3 tinker/gap G9: no row in docs/gaps.md",
    "src/a.ts:4 tinker/one-wire `fetch`: a page's own network call",
  ]);
});

test("a row with more marked lines than its count breaks at the row's head", () => {
  const result = run({
    "src/a.ts": [`// tinker-gap: G3`, `fetch("/a");`],
    "src/b.ts": [`// tinker-gap: G3`, `fetch("/b"); fetch("/c");`],
  });

  expect(result.out).toBe("gaps: G1 0/2, G2 0/0 closed, G3 2/1\n");
  expect(result.hits).toBe("docs/gaps.md:18 tinker/gap G3: 2 marked lines, the row allows 1");
});

test("a gaps doc that does not exist stops the run with exit 2", () => {
  const folder = mkdtempSync(join(tmpdir(), "analyze-gaps-"));
  folders.push(folder);
  writeFileSync(join(folder, "tinker-analyze.json"), JSON.stringify({ gaps: "docs/none.md" }));

  expect(main(["check", folder], "/")).toEqual({
    code: 2,
    out: "",
    err: "tinker-analyze.json: the gaps doc docs/none.md does not exist\n",
  });
});
