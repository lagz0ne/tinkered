import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

import { check } from "@/index";

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** Check a fresh app folder that holds only these files; answer each barrel finding as text. */
function barrels(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-barrel-"));
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }

  return check(folder)
    .findings.filter(({ rule }) => rule === "tinker/barrel")
    .map(({ path, line, rule, what }) => `${path}:${line} ${rule} ${what}`);
}

test("a re-export of values, of types, or of an imported name is a barrel", () => {
  const hits = barrels({
    "src/todo/index.ts": [
      `import list, * as all from "./list";`,
      `import { type Row, add, remove } from "./db";`,
      `export * from "./list";`,
      `export * as rows from "./db";`,
      `export { add as plus } from "./db";`,
      `export type { Row } from "./db";`,
      `export {`,
      `  add,`,
      `};`,
      `export { remove as drop, type Row as Line };`,
      `export { all };`,
      `export default list;`,
    ].join("\n"),
  });

  expect(hits).toEqual([
    'src/todo/index.ts:3 tinker/barrel `export * from "./list"`: a re-export',
    'src/todo/index.ts:4 tinker/barrel `export * as rows from "./db"`: a re-export',
    'src/todo/index.ts:5 tinker/barrel `export { add as plus } from "./db"`: a re-export',
    'src/todo/index.ts:6 tinker/barrel `export type { Row } from "./db"`: a re-export',
    "src/todo/index.ts:7 tinker/barrel `export { add, }`: a re-export",
    "src/todo/index.ts:10 tinker/barrel `export { remove as drop, type Row as Line }`: a re-export",
    "src/todo/index.ts:11 tinker/barrel `export { all }`: a re-export",
    "src/todo/index.ts:12 tinker/barrel `export default list`: a re-export",
  ]);
});

test("a file that exports what it declares passes, and only src and cmds are app code", () => {
  const reexport = `export * from "./list";\n`;

  const hits = barrels({
    "src/todo/list.tsx": [
      `import { add } from "./db";`,
      `const view = () => <b>{add}</b>;`,
      `export const plus = add;`,
      `export { view };`,
      `export default view;`,
    ].join("\n"),
    "cmds/serve.ts": reexport,
    "tinker/base.ts": reexport,
  });

  expect(hits).toEqual(['cmds/serve.ts:1 tinker/barrel `export * from "./list"`: a re-export']);
});
