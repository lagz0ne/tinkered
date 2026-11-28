import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

import { check, isError, main } from "@/index";

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A fresh app folder that holds only these files. */
function appOf(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-main-"));
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

/** A package that ships one skill, so Intent lists it and the check reads its sections. */
function skillPackage(folder: string, skill: string) {
  const root = join(folder, "node_modules/@tinkered/kit");
  const manifest = {
    name: "@tinkered/kit",
    version: "1.0.0",
    keywords: ["tanstack-intent"],
    repository: { type: "git", url: "git+https://github.com/lagz0ne/tinkered.git" },
  };

  mkdirSync(join(root, "skills/kit"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(root, "skills/kit/SKILL.md"), skill);

  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({
      dependencies: { "@tinkered/kit": "1.0.0" },
      intent: { skills: ["@tinkered/*"] },
    }),
  );
}

const skill = (right: string) =>
  [
    "---",
    "name: kit",
    "description: Use when a check prints tinker/one-wire or tinker/react-state.",
    "---",
    "",
    "## Common mistakes",
    "",
    "### HIGH: `fetch` on the page [tinker/one-wire]",
    "",
    "Wrong:",
    "",
    "```ts",
    "# not a heading",
    "fetch(url);",
    "```",
    "",
    right,
    "",
    "Check: the lint.",
    "",
    "### HIGH: `useState` [tinker/react-state]",
    "",
    "Right: a `data` cell.",
    "",
    "### HIGH: `useEffect` [tinker/react-state]",
    "",
    "Right: a `resource`, with steps:",
    "",
    "- one",
    "- two",
    "",
    "Not this line.",
    "",
  ].join("\n");

test("each finding prints its rule id, then the Right part of its skill section", () => {
  const folder = appOf({
    "src/b.tsx": `export const View = () => {\n  useEffect(() => {});\n  fetch("/api");\n  useState(0);\n  fetch("/b");\n  return <b />;\n};\n`,
  });
  skillPackage(folder, skill("Right: add an address to the contract\nand call it."));

  expect(main(["check", "."], folder)).toEqual({
    code: 1,
    out: [
      "src/b.tsx:2 tinker/react-state `useEffect`: React's own state or effect",
      "  Right: a `resource`, with steps:",
      "  - one",
      "  - two",
      "  more: tinker skill load @tinkered/kit#kit",
      "",
      "src/b.tsx:3 tinker/one-wire `fetch`: a page's own network call",
      "  Right: add an address to the contract",
      "  and call it.",
      "  more: tinker skill load @tinkered/kit#kit",
      "",
      "src/b.tsx:4 tinker/react-state `useState`: React's own state or effect",
      "  Right: a `data` cell.",
      "  more: tinker skill load @tinkered/kit#kit",
      "",
      "src/b.tsx:5 tinker/one-wire `fetch`: a page's own network call",
      "  fix: as above",
      "",
      "tinker check: rules failed.",
      "Next: fix each finding, then run `tinker check` again.",
      "",
    ].join("\n"),
    err: "",
  });
});

test("the fix is read from the skill on each run: a changed Right line prints", () => {
  const folder = appOf({ "src/a.ts": `fetch("/api");\n` });
  skillPackage(folder, skill("Right: one wire."));
  expect(main(["check", folder], "/").out).toContain("\n  Right: one wire.\n");

  skillPackage(folder, skill("Right: the rpc client."));
  expect(main(["check", folder], "/").out).toContain("\n  Right: the rpc client.\n");
});

test("a rule with no section says so, and points at the skill list", () => {
  const folder = appOf({ "src/a.ts": `export function shout() {}\n` });
  skillPackage(folder, skill("Right: one wire."));

  expect(main(["check", folder], "/").out.split("\n").slice(0, 3)).toEqual([
    "src/a.ts:1 tinker/plain a plain function",
    "  No skill you have teaches this rule: run `tinker skill list`.",
    "",
  ]);
});

test("at most 5 findings print, in file, line and rule order; the count says how many", () => {
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

  const { out } = main(["check", folder], "/");
  const heads = out.split("\n").filter((line) => /^\S+:\d+ /.test(line));

  expect(heads.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual([
    "src/a.tsx:2 tinker/one-wire",
    "src/a.tsx:3 tinker/one-wire",
    "src/a.tsx:3 tinker/react-state",
    "src/a.tsx:5 tinker/plain",
    "src/a.tsx:6 tinker/one-wire",
  ]);
  expect(out).toContain("\ntinker check: rules failed, 6 findings, 5 shown.\n");
});

test("--json prints the same report as data", () => {
  const folder = appOf({ "src/a.ts": `fetch("/api");\n` });
  skillPackage(folder, skill("Right: one wire."));

  const result = main(["check", folder, "--json"], "/");

  expect(result.code).toBe(1);
  expect(JSON.parse(result.out)).toEqual({
    kind: "failed",
    stage: "rules",
    total: 1,
    findings: [
      {
        path: "src/a.ts",
        line: 1,
        rule: "tinker/one-wire",
        what: "`fetch`: a page's own network call",
        fix: ["Right: one wire."],
        skill: "@tinkered/kit#kit",
      },
    ],
    gaps: [],
  });
  expect(JSON.parse(main(["--json", "check", appOf({})], "/").out)).toMatchObject({
    kind: "incomplete",
  });
});

test("a file with a longer ending is not app code", () => {
  const folder = appOf({
    "src/a.ts.txt": `export function shout() {}\nfetch("/api");\n`,
    "src/b.tsx.bak": `export function shout() {}\nfetch("/api");\n`,
  });

  expect(main(["check", folder], "/").out).toContain("ran: rules (0 files)\n");
});

test("the root defaults to the folder the command runs in", () => {
  const folder = appOf({ "cmds/a.ts": `export const one = 1;\n`, "src/b.ts": `export {};\n` });

  expect(main(["check"], folder).out).toContain("ran: rules (2 files)\n");
});

test("clean rules with a tool skipped are no OK: the answer is not done, exit 2", () => {
  expect(main(["check", appOf({ "src/a.ts": `export {};\n` })], "/")).toEqual({
    code: 2,
    out: [
      "ran: rules (1 files)",
      "skipped: tsc (no tsconfig.json), lint (no vite.config)",
      "tinker check: not done. A check did not run, so this is no OK.",
      "Next: add the config the skipped line names, then run `tinker check` again.",
      "",
    ].join("\n"),
    err: "",
  });
});

test("a root that is not there exits 2, before any check", () => {
  const folder = join(appOf({}), "typo");

  expect(main(["check", folder], "/")).toEqual({
    code: 2,
    out: "",
    err: `tinker check: no folder at ${folder}\n`,
  });
  expect(main(["graph", folder], "/")).toEqual({
    code: 2,
    out: "",
    err: `tinker graph: no folder at ${folder}\n`,
  });
});

test("an unknown command or a spare argument prints the usage and exits 2", () => {
  const folder = appOf({});
  const { err: usage } = main([], folder);

  expect(main([], folder)).toMatchObject({ code: 2, out: "" });
  expect(main(["lint"], folder).err).toContain("tinker check [root] [--json]");
  expect(main(["check", ".", "more"], folder).code).toBe(2);
  expect(main(["skill"], folder).code).toBe(2);
  expect(main(["skill", "list", "more"], folder).code).toBe(2);
  expect(main(["skill", "load"], folder).code).toBe(2);
  expect(main(["skill", "load", "a#b", "more"], folder).code).toBe(2);
  expect(main(["skill", "list", "--json"], folder).code).toBe(2);
  expect(main(["check", ".", "--since"], folder).code).toBe(2);
  expect(main(["graph", ".", "--json"], folder).code).toBe(2);
  expect(main(["check", "--help"], folder)).toMatchObject({ code: 2, err: usage });
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
  [`{ "gaps": ["docs/gaps.md"] }`, "`gaps` is the path of the gaps doc"],
])("a config of the wrong shape (%s) stops the run with exit 2", (text, reason) => {
  const folder = appOf({ "tinker.json": text, "src/a.ts": `fetch("/api");\n` });

  const result = main(["check", folder], "/");

  expect(result.code).toBe(2);
  expect(result.out).toBe("");
  expect(result.err).toContain(`tinker.json: ${reason}`);
});

test("check throws BadConfig with the file and the reason", () => {
  const folder = appOf({ "tinker.json": `{ "page": { "files": "src" } }` });

  try {
    check(folder);
  } catch (error) {
    if (!isError(error, "BadConfig")) throw error;
    expect(error.payload).toEqual({
      path: "tinker.json",
      reason: "`page.files` is a list of globs",
    });
    return;
  }
  expect.unreachable("check accepted a bad config");
});

test("an empty config and a config of reasons are both read", () => {
  const empty = appOf({ "tinker.json": `{}`, "src/a.ts": `export {};\n` });
  const full = appOf({
    "tinker.json": JSON.stringify({
      plain: { entries: { "src/a.ts": { shout: "Why." } } },
      page: { files: ["src/**"], skip: {} },
    }),
    "src/a.ts": `export function shout() {}\n\nexport function toString() {}\n`,
  });

  expect(check(empty)).toEqual({ files: 1, findings: [], gaps: [] });
  expect(check(full).findings).toEqual([
    { path: "src/a.ts", line: 3, rule: "tinker/plain", what: "a plain function" },
  ]);
});

test("a config under the name before ADR 0156 stops the run with the new name", () => {
  const folder = appOf({ "tinker-analyze.json": `{}`, "src/a.ts": `export {};\n` });

  expect(main(["check", folder], "/")).toEqual({
    code: 2,
    out: "",
    err: "tinker-analyze.json: rename this file to tinker.json\n",
  });
  expect(check(appOf({ "tinker.json": `{}`, "tinker-analyze.json": `[]` })).findings).toEqual([]);
});

test("skill list names each skill the app has; skill load prints its text", () => {
  const folder = appOf({});
  skillPackage(folder, skill("Right: one wire."));

  expect(main(["skill", "list"], folder)).toEqual({
    code: 0,
    out: [
      "@tinkered/kit#kit",
      "  Use when a check prints tinker/one-wire or tinker/react-state.",
      "",
      "Load one: tinker skill load <skill>",
      "",
    ].join("\n"),
    err: "",
  });
  expect(main(["skill", "load", "@tinkered/kit#kit"], folder)).toEqual({
    code: 0,
    out: skill("Right: one wire."),
    err: "",
  });
});

test("an app with no skills says so; a skill it lacks exits 2 with the reason", () => {
  const folder = appOf({});

  expect(main(["skill", "list"], folder).out).toBe(
    "no skills found: add a package that ships skills\n",
  );
  const missing = main(["skill", "load", "@tinkered/kit#kit"], folder);
  expect(missing.code).toBe(2);
  expect(missing.err).toContain("@tinkered/kit");
});
