import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repo = resolve(import.meta.dirname, "../..");
const rule = join(repo, "tools/lint/cell-write.mjs");

/** The oxlint that vite-plus runs: `vp lint` needs a workspace, and the fixture has none. */
const vitePlus = createRequire(join(repo, "package.json")).resolve("vite-plus/package.json");
const oxlint = join(createRequire(vitePlus).resolve("oxlint/package.json"), "../bin/oxlint");

/** Lint a small app tree with only this rule on; answer the warning lines. */
function lint(files) {
  const dir = mkdtempSync(join(tmpdir(), "cell-write-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }

    writeFileSync(
      join(dir, "plugin.mjs"),
      `import rule from ${JSON.stringify(rule)};\n` +
        `export default { meta: { name: "t" }, rules: { "cell-write": rule } };\n`,
    );
    writeFileSync(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({ jsPlugins: ["./plugin.mjs"], rules: { "t/cell-write": "warn" } }),
    );
    const out = execFileSync(
      process.execPath,
      [oxlint, "-c", ".oxlintrc.json", "--format", "unix", "src"],
      { cwd: dir, encoding: "utf8" },
    );
    return out.split("\n").filter((line) => line.includes("cell-write"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const talk = {
  "src/frontend/talk/atoms.ts":
    'import { data } from "@tinker/core";\n' +
    'export const point = data({ label: "talk.point", initial: "a" });\n',
  "src/frontend/talk/operations.ts":
    'import { operation } from "@tinker/core";\n' +
    'import { point } from "./atoms";\n' +
    "export const clear = operation({\n" +
    '  label: "talk.clear",\n' +
    "  depends: { p: point.controller },\n" +
    "  run: ({ p }) => p.set(null),\n" +
    "});\n",
  "src/frontend/talk/index.ts": 'export { point as talkPoint } from "./atoms";\n',
};

void test("a controller on another capsule's cell warns; its op, a read, and an own cell do not", () => {
  const lines = lint({
    ...talk,
    "src/frontend/work/atoms.ts":
      'import { data } from "@tinker/core";\n' +
      'export const open = data({ label: "work.open", initial: false });\n',
    "src/frontend/work/resources.ts":
      'import { point } from "@/frontend/talk/atoms";\n' +
      'import { clear } from "@/frontend/talk/operations";\n' +
      'import { open } from "./atoms";\n' +
      "export const deps = {\n" +
      "  p: point.controller,\n" +
      "  c: clear.controller,\n" +
      "  o: open.controller,\n" +
      "  r: point,\n" +
      "};\n",
  });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /work\/resources\.ts:5:/);
  assert.match(lines[0], /`point` is a cell of capsule `src\/frontend\/talk`/);
});

void test("a cell re-exported under another name through an index still warns", () => {
  const lines = lint({
    ...talk,
    "src/frontend/work/resources.ts":
      'import { talkPoint } from "@/frontend/talk";\n' +
      "export const deps = { p: talkPoint.controller };\n",
  });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /`talkPoint` is a cell of capsule `src\/frontend\/talk`/);
});

void test("an aliased re-export and a typed cell still warn; a file directly under a root does not", () => {
  const lines = lint({
    "src/frontend/sync/atoms.ts":
      'import { data, type Data } from "@tinker/core";\n' +
      'export const content: Data.Cell<number> = data({ label: "content", initial: 0 });\n',
    "src/frontend/sync/index.ts": 'export { content } from "@/frontend/sync/atoms";\n',
    "src/frontend/loose.ts":
      'import { data } from "@tinker/core";\n' +
      'export const loose = data({ label: "loose", initial: 0 });\n',
    "src/frontend/checks/resources.ts":
      'import { content } from "@/frontend/sync";\n' +
      'import { loose } from "@/frontend/loose";\n' +
      "export const deps = { c: content.controller, l: loose.controller };\n",
  });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /`content` is a cell of capsule `src\/frontend\/sync`/);
});
