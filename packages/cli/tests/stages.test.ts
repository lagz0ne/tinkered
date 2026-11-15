import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, expect, test } from "vite-plus/test";

import { main } from "@/index";

/** This package's folder: an app links its `node_modules`, so it has `tsc` and `vp`. */
const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** The base config of ADR 0156 decision 7, as an app extends and imports it. */
const configs = {
  "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
  "tsconfig.json": JSON.stringify({
    extends: at("base/tsconfig.json"),
    compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler" },
    include: ["src"],
  }),
  "vite.config.ts": [
    `import { defineConfig } from "vite-plus";`,
    ``,
    `import { gates } from "${at("src/config.ts")}";`,
    ``,
    `export default defineConfig({`,
    `  lint: {`,
    `    ignorePatterns: ["node_modules/**"],`,
    `    options: { typeAware: true },`,
    `    rules: { curly: "error" },`,
    `    overrides: [{ files: ["src/**"], rules: gates }],`,
    `  },`,
    `});`,
  ].join("\n"),
};

/** A fresh app with the base config and these files; `tools: false` leaves out `tsc` and `vp`. */
function appOf(files: Record<string, string[]>, tools = true) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-stages-"));
  folders.push(folder);
  if (tools) symlinkSync(at("node_modules"), join(folder, "node_modules"));

  const all = {
    ...configs,
    ...Object.fromEntries(Object.entries(files).map(([path, lines]) => [path, lines.join("\n")])),
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

const answer = [
  `export type Answer = { kind: "moved"; version: number } | { kind: "stale" } | { kind: "gone" };`,
  ``,
];

/** The head of each finding: path, line and rule id. */
const heads = (out: string) =>
  out
    .split("\n")
    .filter((line) => /^\S+:\d+ /.test(line))
    .map((line) => line.split(" ").slice(0, 2).join(" "));

test("a kind with no case fails the types stage once, by name", { timeout: 60_000 }, () => {
  const folder = appOf({
    "src/view.ts": [
      ...answer,
      `export const view = (out: Answer) => {`,
      `  switch (out.kind) {`,
      `    case "moved":`,
      `      return "moved";`,
      `    case "stale":`,
      `      return "stale";`,
      `  }`,
      `};`,
    ],
  });

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(1);
  expect(out.split("\n")[0]).toBe('src/view.ts:4 tinker/kind kind "gone" has no case');
  expect(heads(out)).toEqual(["src/view.ts:4 tinker/kind"]);
  expect(out).toContain("\ntinker check: types failed.\n");
  expect(out).toMatch(/The rules stage runs once types pass\.\n$/);
});

test(
  "a `default` fails the kind gate: it neither stands in for a kind nor sits beside all of them",
  {
    timeout: 60_000,
  },
  () => {
    const folder = appOf({
      "src/view.ts": [
        ...answer,
        `export const short = (out: Answer) => {`,
        `  switch (out.kind) {`,
        `    case "moved":`,
        `      return "moved";`,
        `    default:`,
        `      return "other";`,
        `  }`,
        `};`,
        `export const full = (out: Answer) => {`,
        `  switch (out.kind) {`,
        `    case "moved":`,
        `    case "stale":`,
        `    case "gone":`,
        `      return out.kind;`,
        `    default:`,
        `      return "other";`,
        `  }`,
        `};`,
      ],
    });

    const lines = main(["check", folder], "/").out.split("\n");

    expect(lines.filter((line) => /^\S+:\d+ /.test(line))).toEqual([
      'src/view.ts:4 tinker/kind kind "gone" | "stale" has no case',
      "src/view.ts:17 tinker/kind a `default` beside a case for every kind",
    ]);
  },
);

test(
  "a cast, a `!` and an `any` fail the cast gate; `as const` passes",
  { timeout: 60_000 },
  () => {
    const folder = appOf({
      "src/read.ts": [
        `export const read = (value: unknown, name?: string) => {`,
        `  const text = value as string;`,
        `  const wide: any = value;`,
        `  const fixed = { k: 1 } as const;`,
        `  return [text, wide, fixed, name!];`,
        `};`,
      ],
    });

    const { out } = main(["check", folder], "/");

    expect(out.split("\n").filter((line) => /^\S+:\d+ /.test(line))).toEqual([
      "src/read.ts:2 tinker/cast `value as string` hides the type",
      "src/read.ts:3 tinker/cast `any` hides the type",
      "src/read.ts:5 tinker/cast `name!` hides the type",
    ]);
  },
);

test("a type error prints with its TS code; rules wait for types", { timeout: 60_000 }, () => {
  const folder = appOf({
    "src/view.ts": [
      ...answer,
      `export function view(out: Answer) {`,
      `  if (out.kind === "gone") return out.version;`,
      `  return 0;`,
      `}`,
    ],
  });

  const { out } = main(["check", folder], "/");

  expect(heads(out)).toEqual(["src/view.ts:4 TS2339"]);
  expect(out.split("\n")[0]).toMatch(/^src\/view\.ts:4 TS2339 Property 'version' does not exist/);
});

test(
  "clean types run the rules: Tinker's rules and the app's other lint",
  { timeout: 60_000 },
  () => {
    const folder = appOf({
      "src/view.ts": [`export function shout(on: boolean) {`, `  return on ? 1 : 0;`, `}`],
      "src/other.ts": [
        `export const two = (on: boolean) => {`,
        `  if (on) return 2`,
        `  return 0;`,
        `};`,
      ],
    });

    const { code, out } = main(["check", folder, "--json"], "/");
    const report: unknown = JSON.parse(out);

    expect(code).toBe(1);
    expect(report).toMatchObject({
      kind: "failed",
      stage: "rules",
      findings: [
        { path: "src/other.ts", line: 1, rule: "tinker/plain" },
        {
          path: "src/other.ts",
          line: 2,
          rule: "eslint/curly",
          fix: [expect.stringMatching(/^help: /)],
        },
        { path: "src/view.ts", line: 1, rule: "tinker/plain" },
      ],
    });
  },
);

test("a clean app prints what ran, then OK, and exits 0", { timeout: 60_000 }, () => {
  const folder = appOf({ "src/view.ts": [...answer, `export const one = 1;`] });

  expect(main(["check", folder], "/")).toEqual({
    code: 0,
    out: "ran: tsc, lint, rules (1 files)\ntinker check: OK\n",
    err: "",
  });
});

test("a config with no tool to run it exits 2 with what to add", () => {
  const folder = appOf({ "src/a.ts": [`export const one = 1;`] }, false);

  expect(main(["check", folder], "/")).toEqual({
    code: 2,
    out: "",
    err: "tinker check: no tsc: the app has a tsconfig.json; add typescript\n",
  });
});

test(
  "TS7030 of another function stays: only the head around the switch goes",
  {
    timeout: 60_000,
  },
  () => {
    const folder = appOf({
      "src/view.ts": [
        ...answer,
        `export function one(on: boolean) {`,
        `  if (on) return 1;`,
        `}`,
        `export function two(out: Answer) {`,
        `  switch (out.kind) {`,
        `    case "moved":`,
        `      return;`,
        `  }`,
        `}`,
      ],
    });

    expect(heads(main(["check", folder], "/").out)).toEqual([
      "src/view.ts:3 TS7030",
      "src/view.ts:7 tinker/kind",
    ]);
  },
);

test("two casts on one line are two findings", { timeout: 60_000 }, () => {
  const folder = appOf({
    "src/read.ts": [`export const read = (a: unknown, b: unknown) => [a as string, b as number];`],
  });

  const { out } = main(["check", folder, "--json"], "/");

  expect(JSON.parse(out)).toMatchObject({
    total: 2,
    findings: [{ what: "`a as string` hides the type" }, { what: "`b as number` hides the type" }],
  });
});

test("a solution tsconfig checks no file, so it stops the run with exit 2", () => {
  const folder = appOf({ "src/a.ts": [`export const n: number = "x";`] });
  writeFileSync(
    join(folder, "tsconfig.json"),
    `{ "files": [], "references": [{ "path": "./a" }] }`,
  );

  expect(main(["check", folder], "/")).toMatchObject({
    code: 2,
    err: expect.stringMatching(/^tsconfig\.json: it lists `references`/),
  });
});

test(
  "a lint that fails with no report stops the run with exit 2 and its output",
  {
    timeout: 60_000,
  },
  () => {
    const folder = appOf({ "src/a.ts": [`export const one = 1;`] });
    writeFileSync(join(folder, "vite.config.ts"), `throw new Error("broken config");\n`);

    const result = main(["check", folder], "/");

    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^tinker check: vp lint --print-config failed and named no file:\n/);
  },
);

test("a lint config with no gates, or with no typeAware, is no OK", { timeout: 60_000 }, () => {
  const bare = appOf({
    "src/read.ts": [`export const text = JSON.parse("1") as string;`],
  });
  writeFileSync(
    join(bare, "vite.config.ts"),
    `export default { lint: { ignorePatterns: ["node_modules/**"] } };\n`,
  );
  const blind = appOf({ "src/a.ts": [`export const one = 1;`] });
  writeFileSync(
    join(blind, "vite.config.ts"),
    configs["vite.config.ts"].replace("    options: { typeAware: true },\n", ""),
  );

  const off = main(["check", bare], "/");
  expect(off.code).toBe(2);
  expect(off.out).toContain(
    "skipped: gates not at error in the lint config (options.typeAware, typescript/switch-exhaustiveness-check, typescript/consistent-type-assertions, typescript/no-non-null-assertion, typescript/no-explicit-any)\n",
  );
  expect(main(["check", blind], "/").out).toContain("(options.typeAware)\n");
});

test("a kind with no case under a return type prints once", { timeout: 60_000 }, () => {
  const folder = appOf({
    "src/view.ts": [
      ...answer,
      `export const view = (out: Answer): string => {`,
      `  switch (out.kind) {`,
      `    case "moved":`,
      `    case "stale":`,
      `      return out.kind;`,
      `  }`,
      `};`,
    ],
  });

  expect(heads(main(["check", folder], "/").out)).toEqual(["src/view.ts:4 tinker/kind"]);
});

test("a line the lint config prints does not hide the report", { timeout: 60_000 }, () => {
  const folder = appOf({ "src/a.ts": [`export const one = 1;`] });
  writeFileSync(
    join(folder, "vite.config.ts"),
    `console.log("{ plugin note");\nconsole.error("plugin note");\n${configs["vite.config.ts"]}`,
  );

  expect(main(["check", folder], "/").out).toBe(
    "ran: tsc, lint, rules (1 files)\ntinker check: OK\n",
  );
});

test("a tool that cannot start stops the run with exit 2 and the reason", () => {
  const folder = appOf({ "src/a.ts": [`export const one = 1;`] }, false);
  mkdirSync(join(folder, "node_modules/.bin"), { recursive: true });
  writeFileSync(join(folder, "node_modules/.bin/tsc"), "not a program\n");
  chmodSync(join(folder, "node_modules/.bin/tsc"), 0o644);

  const result = main(["check", folder], "/");

  expect(result.code).toBe(2);
  expect(result.err).toMatch(/^tinker check: tsc failed and named no file:\n.*EACCES/);
});

test(
  "a Tinker lint rule no skill teaches prints its own message, with no skill notice",
  { timeout: 60_000 },
  () => {
    const folder = appOf({
      "vite.config.ts": [
        `import { defineConfig } from "vite-plus";`,
        ``,
        `import { gates } from "${at("src/config.ts")}";`,
        ``,
        `export default defineConfig({`,
        `  lint: {`,
        `    ignorePatterns: ["node_modules/**"],`,
        `    jsPlugins: [{ name: "tinker", specifier: "${at("lint/index.mjs")}" }],`,
        `    options: { typeAware: true },`,
        `    rules: { "tinker/body-steps": "error" },`,
        `    overrides: [{ files: ["src/**"], rules: gates }],`,
        `  },`,
        `});`,
      ],
      "src/view.ts": [
        `export let n = 0;`,
        `if (n === 0) {`,
        ...Array<string>(6).fill("  n++;"),
        `}`,
      ],
    });

    expect(main(["check", folder], "/").out.split("\n").slice(0, 2)).toEqual([
      "src/view.ts:2 tinker/body-steps Split this block into steps with a blank line between them.",
      "",
    ]);
  },
);

const gapsDoc = [`## G1: a cast Core cannot type yet`, ``, `- Status: open`, `- Lines: 1`, ``];

test(
  "a lint comment that turns a gate off fails the types stage; other rules may be off",
  { timeout: 60_000 },
  () => {
    const folder = appOf({
      "src/a.ts": [
        `// oxlint-disable-next-line typescript/consistent-type-assertions -- a reason`,
        `export const a = JSON.parse("1") as string;`,
        `/* eslint-disable-next-line */`,
        `export const b = [1].at(0)!;`,
        `// oxlint-disable-next-line curly`,
        `export const c = 1;`,
      ],
    });

    const { code, out } = main(["check", folder, "--json"], "/");

    expect(code).toBe(1);
    expect(JSON.parse(out)).toMatchObject({
      kind: "failed",
      stage: "types",
      total: 5,
      findings: [
        {
          line: 1,
          rule: "tinker/gap",
          what: "a `lint-disable` comment turns off the gate consistent-type-assertions",
        },
        { line: 3, what: expect.stringMatching(/gate switch-exhaustiveness-check$/) },
        { line: 3, what: expect.stringMatching(/gate consistent-type-assertions$/) },
        { line: 3, what: expect.stringMatching(/gate no-non-null-assertion$/) },
        { line: 3, what: expect.stringMatching(/gate no-explicit-any$/) },
      ],
    });
  },
);

test("a gap row allows a gate finding, and counts it", { timeout: 60_000 }, () => {
  const folder = appOf({
    "tinker.json": [`{ "gaps": "gaps.md" }`],
    "gaps.md": gapsDoc,
    "src/a.ts": [`// tinker-gap: G1`, `export const a = JSON.parse("1") as string;`],
  });

  expect(main(["check", folder], "/")).toEqual({
    code: 0,
    out: "gaps: G1 1/1\nran: tsc, lint, rules (1 files)\ntinker check: OK\n",
    err: "",
  });
});

test(
  "a gap marker with no gate finding below it fails the rules stage",
  { timeout: 60_000 },
  () => {
    const folder = appOf({
      "tinker.json": [`{ "gaps": "gaps.md" }`],
      "gaps.md": gapsDoc,
      "src/a.ts": [`// tinker-gap: G1`, `export const a = 1;`],
    });

    expect(heads(main(["check", folder], "/").out)).toEqual(["src/a.ts:1 tinker/gap"]);
  },
);
