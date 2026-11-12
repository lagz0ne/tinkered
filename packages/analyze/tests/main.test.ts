import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

import { check, isError, main, rules } from "@/index";

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A fresh app folder that holds only these files. */
function appOf(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "analyze-main-"));
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

test("each finding prints its rule id; each broken rule prints its step and its skill", () => {
  const folder = appOf({
    "src/b.tsx": `export const View = () => {\n  useState(0);\n  fetch("/api");\n  return <b />;\n};\n`,
    "src/a.ts": `export function shout(s: string) {\n  return s;\n}\n`,
  });

  const result = main(["check", "."], folder);

  expect(result).toEqual({
    code: 1,
    out: "",
    err: [
      "src/a.ts:1 tinker/plain a plain function",
      "src/b.tsx:2 tinker/react-state `useState`: React's own state or effect",
      "src/b.tsx:3 tinker/one-wire `fetch`: a page's own network call",
      "",
      "tinker/one-wire: call the server through the rpc client",
      "  read: @tinkered/core#core/rpc",
      "tinker/plain: make it an operation",
      "  read: @tinkered/core#core/operation",
      "tinker/react-state: hold the state in a Core cell and read it with @tinkered/react",
      "  read: @tinkered/react#react",
      "",
      "3 findings in 2 files",
      "",
    ].join("\n"),
  });
});

test("findings come in file order, then line order, then rule order", () => {
  const folder = appOf({
    "src/b.tsx": `export const View = () => {\n  return <b />;\n};\n`,
    "src/a.tsx": [
      `export const View = () => {`,
      `  fetch("/api");`,
      `  return <b onClick={() => useState(fetch("/api"))} />;`,
      `};`,
      `export function late() {}`,
      `fetch("/api");`,
    ].join("\n"),
    "src/c.ts": `export function shout() {}\n`,
  });

  const lines = main(["check", folder], "/").err.split("\n\n")[0]?.split("\n");

  expect(lines?.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual([
    "src/a.tsx:2 tinker/one-wire",
    "src/a.tsx:3 tinker/one-wire",
    "src/a.tsx:3 tinker/react-state",
    "src/a.tsx:5 tinker/plain",
    "src/a.tsx:6 tinker/one-wire",
    "src/c.ts:1 tinker/plain",
  ]);
});

test("a file with a longer ending is not app code", () => {
  const folder = appOf({
    "src/a.ts.txt": `export function shout() {}\nfetch("/api");\n`,
    "src/b.tsx.bak": `export function shout() {}\nfetch("/api");\n`,
  });

  expect(main(["check", folder], "/").out).toBe("no findings in 0 files\n");
});

test("the root defaults to the folder the command runs in", () => {
  const folder = appOf({ "cmds/a.ts": `export const one = 1;\n`, "src/b.ts": `export {};\n` });

  expect(main(["check"], folder)).toEqual({ code: 0, out: "no findings in 2 files\n", err: "" });
});

test("an unknown command or a spare argument prints the usage and exits 2", () => {
  const folder = appOf({});

  expect(main([], folder)).toMatchObject({ code: 2, out: "" });
  expect(main(["lint"], folder).err).toContain("usage: tinker-analyze check [root]");
  expect(main(["check", ".", "more"], folder).code).toBe(2);
});

test.each([
  [`{ "page": `, "the file is not JSON"],
  [`[]`, "the file is not an object"],
  [`null`, "the file is not an object"],
  [`{ "plain": { "entries": { "a.ts": { "f": "Why." }, "b.ts": 1 } } }`, "`plain.entries` maps"],
  [`{ "page": { "files": ["src/**", 1] } }`, "`page.files` is a list of globs"],
  [`{ "plain": 1 }`, "`plain` and `page` are objects"],
  [`{ "page": [] }`, "`plain` and `page` are objects"],
  [`{ "plain": { "entries": { "a.ts": ["f"] } } }`, "`plain.entries` maps"],
  [`{ "plain": { "entries": { "a.ts": { "f": 1 } } } }`, "`plain.entries` maps"],
  [`{ "plain": { "entries": [] } }`, "`plain.entries` maps"],
  [`{ "page": { "files": "src" } }`, "`page.files` is a list of globs"],
  [`{ "page": { "files": [1] } }`, "`page.files` is a list of globs"],
  [`{ "page": { "skip": ["src/**"] } }`, "`page.skip` maps a glob to a reason"],
  [`{ "page": { "skip": { "src/**": true } } }`, "`page.skip` maps a glob to a reason"],
])("a config of the wrong shape (%s) stops the run with exit 2", (text, reason) => {
  const folder = appOf({ "tinker-analyze.json": text, "src/a.ts": `fetch("/api");\n` });

  const result = main(["check", folder], "/");

  expect(result.code).toBe(2);
  expect(result.out).toBe("");
  expect(result.err).toContain(`tinker-analyze.json: ${reason}`);
});

test("check throws BadConfig with the file and the reason", () => {
  const folder = appOf({ "tinker-analyze.json": `{ "page": { "files": "src" } }` });

  try {
    check(folder);
  } catch (error) {
    if (!isError(error, "BadConfig")) throw error;
    expect(error.payload).toEqual({
      path: "tinker-analyze.json",
      reason: "`page.files` is a list of globs",
    });
    return;
  }
  expect.unreachable("check accepted a bad config");
});

test("an empty config and a config of reasons are both read", () => {
  const empty = appOf({ "tinker-analyze.json": `{}`, "src/a.ts": `export {};\n` });
  const full = appOf({
    "tinker-analyze.json": JSON.stringify({
      plain: { entries: { "src/a.ts": { shout: "Why." } } },
      page: { files: ["src/**"], skip: {} },
    }),
    "src/a.ts": `export function shout() {}\n\nexport function toString() {}\n`,
  });

  expect(check(empty)).toEqual({ files: 1, findings: [] });
  expect(check(full).findings).toEqual([
    { path: "src/a.ts", line: 3, rule: "tinker/plain", what: "a plain function" },
  ]);
});

test("every rule names a skill of a Tinker package", () => {
  for (const { skill, fix } of Object.values(rules)) {
    expect(skill).toMatch(/^@tinkered\/(core|react)#/);
    expect(fix).not.toBe("");
  }
});
