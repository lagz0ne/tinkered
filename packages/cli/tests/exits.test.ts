import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createScope, operation, rpc, transport } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";
import { z } from "zod";

import { main } from "@/index";
import { exits } from "@/test";

/** This package's folder: an app links its `node_modules`, so it has `tsc`, `vp` and Core. */
const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** An app whose tests are `node tests.mjs`: the script writes the exits a real run would. */
const configs = {
  "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
  "tinker.json": JSON.stringify({ tests: "node tests.mjs" }),
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
    `    overrides: [{ files: ["src/**"], rules: gates }],`,
    `  },`,
    `});`,
  ].join("\n"),
  "src/ops.ts": [
    `import { operation, transport } from "@tinkered/core";`,
    ``,
    `export const move = operation({`,
    `  label: "move.do",`,
    `  run: (_, { random }) =>`,
    `    random.next() < 0.5 ? { kind: "moved" as const } : { kind: "gone" as const },`,
    `});`,
    ``,
    `export const guard = operation({`,
    `  label: "guard",`,
    `  input: transport.hook.start,`,
    `  run: (_, { input }) => (input.meta.who ? undefined : input.refuse({})),`,
    `});`,
  ].join("\n"),
  "tinker.graph": [
    "guard exits{refused,value} reads{} writes{} calls{}",
    "move.do exits{gone,moved} reads{} writes{} calls{}",
    "",
  ].join("\n"),
};

/** A fresh app whose test run writes these exits, then ends with `status`. */
function appOf(reached: readonly string[], status = 0) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-exits-app-"));
  folders.push(folder);
  symlinkSync(at("node_modules"), join(folder, "node_modules"));

  const script = [
    `import { appendFileSync } from "node:fs";`,
    `for (const line of ${JSON.stringify(reached)}) appendFileSync(process.env.TINKER_EXITS, line + "\\n");`,
    `console.log("the tests ran");`,
    `process.exit(${status});`,
  ].join("\n");
  for (const [path, text] of Object.entries({ ...configs, "tests.mjs": script })) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

const all = ["move.do\tmoved", "move.do\tgone", "guard\trefused", "guard\tvalue"];

/** The head of each finding: path, line, rule id and what is there. */
const findings = (out: string) => out.split("\n").filter((line) => /^\S+:\d+ /.test(line));

test(
  "an answer kind that no test reaches fails the exits stage, by label",
  { timeout: 60_000 },
  () => {
    const folder = appOf(all.filter((line) => line !== "move.do\tgone"));

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(findings(out)).toEqual([
      "src/ops.ts:3 tinker/exit `move.do` answers `gone`, and no test reaches it",
    ]);
    expect(out).toContain("\ntinker check: exits failed.\n");
    expect(out).toMatch(/Next: add a test for each finding, then run `tinker check` again\.\n$/);
  },
);

test("a refusal and a plain return are exits too", { timeout: 60_000 }, () => {
  const folder = appOf(all.filter((line) => !line.startsWith("guard")));

  const { out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([
    "src/ops.ts:9 tinker/exit `guard` refuses, and no test reaches it",
    "src/ops.ts:9 tinker/exit `guard` returns, and no test reaches it",
  ]);
});

test("the finding prints the fix its skill teaches", { timeout: 60_000 }, () => {
  const folder = appOf([]);

  const { out } = main(["check", folder], "/");

  expect(out).toContain("  Right: a test for each exit the check names.");
});

test("every declared exit reached: OK, and it names the two stages", { timeout: 60_000 }, () => {
  const folder = appOf(all);

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(0);
  expect(out).toMatch(/^ran: .*, tests, exits\ntinker check: OK\n$/);
});

test("red tests are the answer: their output, and no exit finding", { timeout: 60_000 }, () => {
  const folder = appOf([], 1);

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(1);
  expect(findings(out)).toEqual([]);
  expect(out).toBe(
    [
      "the tests ran",
      "",
      "tinker check: tests failed.",
      "Next: make the tests pass, then run `tinker check` again.",
      "",
    ].join("\n"),
  );
});

test("`tests` that is not a command line stops the run", () => {
  const folder = appOf(all);
  writeFileSync(join(folder, "tinker.json"), JSON.stringify({ tests: ["node"] }));

  const { code, err } = main(["check", folder], "/");

  expect(code).toBe(2);
  expect(err).toBe("tinker.json: `tests` is the command that runs the tests\n");
});

const api = rpc({ echo: { input: z.number(), output: z.number() } });

const echo = operation({ label: "echo", input: api.echo.input, run: (_, { input }) => input });

/** Refuses each call: a refusal made by Core's own `refuse`, on the path an app has. */
const guard = operation({
  label: "guard",
  input: transport.hook.start,
  run: (_, { input }) => input.refuse({}),
});

test("the capsule writes the exit of each run of a scope that lists it", async () => {
  const folder = mkdtempSync(join(tmpdir(), "tinker-exits-run-"));
  folders.push(folder);
  const file = join(folder, "exits.tsv");
  const answer = operation({ label: "answer", run: () => ({ kind: "stale" as const }) });
  const later = operation({ label: "later", run: async () => 1 });
  const scope = await createScope({
    capsules: [exits({ file }), api({ implement: { echo }, onStart: [guard] })],
  }).ready;

  await scope.run(answer);
  await scope.run(later);
  await scope.settle(api.echo, { input: 1 });
  await scope.close();

  const lines = readFileSync(file, "utf8").split("\n");
  expect(lines).toContain("answer\tstale");
  expect(lines).toContain("later\tvalue");
  expect(lines).toContain("guard\trefused");
});

test("a page's exits go to its store in one write, as counts by exit", async () => {
  const writes: string[] = [];
  const kept = new Map<string, string>();
  const store = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, text: string) => void (kept.set(key, text), writes.push(text)),
  };
  const answer = operation({ label: "answer", run: () => ({ kind: "stale" as const }) });
  const scope = createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS_NOT_SET, store })],
  });

  await Promise.all([scope.run(answer), scope.run(answer)]);
  await scope.close();

  expect(writes).toEqual([JSON.stringify({ "answer\tstale": 2 })]);
  expect([...kept.keys()]).toEqual(["tinker.exits"]);
});

test("an exit that a page test left in the app's folder is reached", { timeout: 60_000 }, () => {
  const folder = appOf(all.filter((line) => line !== "move.do\tgone"));
  const script = [
    `import { mkdirSync, writeFileSync } from "node:fs";`,
    `mkdirSync(".tinker/exits", { recursive: true });`,
    `writeFileSync(".tinker/exits/a.json", JSON.stringify({ "move.do\\tgone": 1 }));`,
  ].join("\n");
  writeFileSync(
    join(folder, "tests.mjs"),
    `${readFileSync(join(folder, "tests.mjs"), "utf8").replace(/process\.exit.*/, "")}\n${script}`,
  );

  const { code, out } = main(["check", folder], "/");

  expect(out).toMatch(/tinker check: OK\n$/);
  expect(code).toBe(0);
});
