import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createScope, data, operation } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";
import { z } from "zod";

import { main } from "@/index";

/** This package's folder: an app links its `node_modules`, so it has `tsc`, `vp` and Core. */
const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** The file this process's capsule writes its effect lines to: the env value is read at load. */
const written = join(mkdtempSync(join(tmpdir(), "tinker-effects-run-")), "effects.tsv");
folders.push(dirname(written));
process.env.TINKER_EFFECTS = written;
const { exits } = await import("@/test");
delete process.env.TINKER_EFFECTS;

/** The effect lines of one op, as the capsule wrote them: `label<tab>exit<tab>cells`. */
const linesOf = (label: string) =>
  readFileSync(written, "utf8")
    .split("\n")
    .filter((line) => line.startsWith(`${label}\t`))
    .sort();

const doors = data<string[]>({ label: "doors.list", initial: [] });
const log = data<string[]>({ label: "doors.log", initial: [] });

test("with the check's ask, the capsule hooks writes", () => {
  expect(typeof exits.hooks.write).toBe("function");
});

test("an op with two exits gives a line for each, with the cells it wrote", async () => {
  const open = operation({
    label: "door.open",
    input: z.boolean(),
    depends: { doors: doors.controller },
    run: ({ doors }, { input }) => {
      if (!input) return { kind: "locked" as const };
      doors.set(["open"]);
      return { kind: "opened" as const };
    },
  });
  const scope = createScope({ capsules: [exits()] });

  await scope.run(open, { input: true });
  await scope.run(open, { input: false });
  await scope.close();

  expect(linesOf("door.open")).toEqual(["door.open\tlocked\t", "door.open\topened\tdoors.list"]);
});

test("a write by an op the run calls counts for the caller's line", async () => {
  const note = operation({
    label: "door.note",
    depends: { log: log.controller },
    run: ({ log }) => log.update((list) => [...list, "seen"]),
  });
  const shut = operation({
    label: "door.shut",
    depends: { doors: doors.controller, note },
    run: ({ doors, note }) => {
      note.run();
      doors.set([]);
      return { kind: "shut" as const };
    },
  });
  const scope = createScope({ capsules: [exits()] });

  await scope.run(shut);
  await scope.close();

  expect(linesOf("door.shut")).toEqual(["door.shut\tshut\tdoors.list,doors.log"]);
  expect(linesOf("door.note")).toEqual(["door.note\tvalue\tdoors.log"]);
});

test("an exit with two write sets has two lines, each once", async () => {
  const lock = operation({
    label: "door.lock",
    input: z.boolean(),
    depends: { doors: doors.controller },
    run: ({ doors }, { input }) => {
      if (input) doors.set(["locked"]);
      return { kind: "locked" as const };
    },
  });
  const scope = createScope({ capsules: [exits()] });

  for (const input of [true, false, true, false]) await scope.run(lock, { input });
  await scope.close();

  expect(linesOf("door.lock")).toEqual(["door.lock\tlocked\t", "door.lock\tlocked\tdoors.list"]);
});

test("a run that throws gives no line, and its writes count for the caller", async () => {
  const jam = operation({
    label: "door.jam",
    depends: { log: log.controller },
    run: async ({ log }) => {
      log.set(["jammed"]);
      throw new Error("the door is jammed");
    },
  });
  const kick = operation({
    label: "door.kick",
    depends: { jam },
    run: async ({ jam }) => {
      const result = await jam.settle();
      return result.status === "success" ? { kind: "open" as const } : { kind: "stuck" as const };
    },
  });
  const scope = createScope({ capsules: [exits()] });

  expect(await scope.run(kick)).toEqual({ kind: "stuck" });
  await scope.close();

  expect(linesOf("door.jam")).toEqual([]);
  expect(linesOf("door.kick")).toEqual(["door.kick\tstuck\tdoors.log"]);
});

/** A promise and the call that settles it: a run waits on it until the test lets it go. */
function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve: () => resolve() };
}

test("two runs side by side keep their own cells", async () => {
  const gates = { first: gate(), second: gate() };
  const swing = operation({
    label: "door.swing",
    input: z.enum(["first", "second"]),
    depends: { doors: doors.controller, log: log.controller },
    run: async ({ doors, log }, { input }) => {
      await gates[input].promise;
      if (input === "first") doors.set(["swung"]);
      else log.set(["swung"]);
      return { kind: "swung" as const };
    },
  });
  const scope = createScope({ capsules: [exits()] });

  const first = scope.run(swing, { input: "first" });
  const second = scope.run(swing, { input: "second" });
  gates.second.resolve();
  await second;
  gates.first.resolve();
  await first;
  await scope.close();

  expect(linesOf("door.swing")).toEqual([
    "door.swing\tswung\tdoors.list",
    "door.swing\tswung\tdoors.log",
  ]);
});

/** The lint config of a fixture app: the gates, on its own code. */
const viteConfig = (test: string) =>
  [
    `import { defineConfig } from "vite-plus";`,
    ``,
    `import { gates } from "${at("src/config.ts")}";`,
    ``,
    `export default defineConfig({`,
    `  cacheDir: ".cache",`,
    `  lint: {`,
    `    ignorePatterns: ["node_modules/**", ".cache/**"],`,
    `    options: { typeAware: true },`,
    `    overrides: [{ files: ["src/**"], rules: gates }],`,
    `  },`,
    test,
    `});`,
  ].join("\n");

/** An app with one op: `door.open` answers `locked` and writes nothing, or `opened`. */
const configs = {
  "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
  "tinker.json": JSON.stringify({ tests: "node tests.mjs" }),
  "tsconfig.json": JSON.stringify({
    extends: at("base/tsconfig.json"),
    compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler" },
    include: ["src"],
  }),
  "vite.config.ts": viteConfig(""),
  "src/ops.ts": [
    `import { data, operation } from "@tinkered/core";`,
    ``,
    `const doors = data<string[]>({ label: "doors.list", initial: [] });`,
    ``,
    `export const open = operation({`,
    `  label: "door.open",`,
    `  depends: { doors: doors.controller },`,
    `  run: ({ doors }, { random }) => {`,
    `    if (random.next() < 0.5) return { kind: "locked" as const };`,
    `    doors.set(["open"]);`,
    `    return { kind: "opened" as const };`,
    `  },`,
    `});`,
  ].join("\n"),
};

/** The script a fixture's tests run: it writes these effect lines, and reaches both exits. */
function testsOf(effects: readonly string[], status: number) {
  return [
    `import { appendFileSync } from "node:fs";`,
    `appendFileSync(process.env.TINKER_EXITS, "door.open\\tlocked\\ndoor.open\\topened\\n");`,
    `for (const line of ${JSON.stringify(effects)}) appendFileSync(process.env.TINKER_EFFECTS, line + "\\n");`,
    `console.log("the tests ran");`,
    `process.exit(${status});`,
  ].join("\n");
}

/** A fresh app in a temp folder with these files, its `node_modules` linked to this package's. */
function appOf(files: Readonly<Record<string, string>>) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-effects-app-"));
  folders.push(folder);
  symlinkSync(at("node_modules"), join(folder, "node_modules"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

/** What the tests wrote: the op's two exits, with a library's cell and a test's own op too. */
const ran = [
  "door.open\topened\tdoors.list,lib.cache",
  "door.open\tlocked\t",
  "door.open\tlocked\ttest.seen",
  "test.peek\tvalue\tdoors.list",
];

const filed = [
  "# tinker.effects 1",
  "door.open locked writes{}",
  "door.open opened writes{doors.list}",
];

/** The head of each finding: path, line, rule id and what is there. */
const findings = (out: string) => out.split("\n").filter((line) => /^\S+:\d+ /.test(line));

const read = (folder: string, path: string) => readFileSync(join(folder, path), "utf8");

test(
  "`tinker check --write` writes tinker.graph and tinker.effects, then a plain check is OK",
  { timeout: 60_000 },
  () => {
    const folder = appOf({ ...configs, "tests.mjs": testsOf(ran, 0) });

    const wrote = main(["check", folder, "--write"], "/");
    const again = main(["check", folder], "/");

    expect(wrote.code).toBe(0);
    expect(wrote.out).toMatch(
      /graph \(1 operation, 0 views, wrote tinker\.graph\), tests, exits, effects \(2 lines, wrote tinker\.effects\)\ntinker check: OK\n$/,
    );
    expect(read(folder, "tinker.graph")).toContain("door.open exits{locked,opened}");
    expect(read(folder, "tinker.effects")).toBe(`${filed.join("\n")}\n`);
    expect(again.out).toMatch(/, tests, exits, effects \(2 lines\)\ntinker check: OK\n$/);
    expect(again.code).toBe(0);
  },
);

test("two runs of `--write` write the same file, in any order of runs", { timeout: 60_000 }, () => {
  const folder = appOf({ ...configs, "tests.mjs": testsOf(ran, 0) });
  main(["check", folder, "--write"], "/");
  const first = read(folder, "tinker.effects");
  writeFileSync(join(folder, "tests.mjs"), testsOf([...ran].reverse(), 0));

  main(["check", folder, "--write"], "/");

  expect(read(folder, "tinker.effects")).toBe(first);
});

test("a new write set is one finding, at the op, with its fix", { timeout: 60_000 }, () => {
  const folder = appOf({
    ...configs,
    "tests.mjs": testsOf([...ran, "door.open\tlocked\tdoors.list"], 0),
    "tinker.effects": `${filed.join("\n")}\n`,
  });
  main(["graph", folder, "--write"], "/");

  const { code, out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([
    "src/ops.ts:5 tinker/effect door.open locked: writes{doors.list} or writes{}, file says writes{}",
  ]);
  expect(out).toContain("  Right: if the change is meant, run");
  expect(out).toContain("\ntinker check: effects failed.\n");
  expect(code).toBe(1);
});

test(
  "a write set no run gives is one finding, and so is an exit no run gives",
  { timeout: 60_000 },
  () => {
    const lost = [...filed, "door.open opened writes{}", "door.open stuck writes{}"];
    const folder = appOf({
      ...configs,
      "tests.mjs": testsOf(ran, 0),
      "tinker.effects": `${lost.join("\n")}\n`,
    });
    main(["graph", folder, "--write"], "/");

    const { out } = main(["check", folder], "/");

    expect(findings(out)).toEqual([
      "src/ops.ts:5 tinker/effect door.open opened: writes{doors.list}, file says writes{doors.list} or writes{}",
      "src/ops.ts:5 tinker/effect door.open stuck: no run, file says writes{}",
    ]);
  },
);

test("a line for an op the graph has not points at the file", { timeout: 60_000 }, () => {
  const folder = appOf({
    ...configs,
    "tests.mjs": testsOf(ran, 0),
    "tinker.effects": `${[...filed, "door.close shut writes{}"].join("\n")}\n`,
  });
  main(["graph", folder, "--write"], "/");

  const { out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([
    "tinker.effects:4 tinker/effect door.close shut: no run, file says writes{}",
  ]);
});

test("no tinker.effects is one finding, and a plain check writes none", { timeout: 60_000 }, () => {
  const folder = appOf({ ...configs, "tests.mjs": testsOf(ran, 0) });
  main(["graph", folder, "--write"], "/");

  const { code, out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([
    "tinker.effects:1 tinker/effect there is no tinker.effects: run `tinker check --write` and commit it",
  ]);
  expect(code).toBe(1);
  expect(() => read(folder, "tinker.effects")).toThrow();
});

test("a tinker.effects with no format line is one finding", { timeout: 60_000 }, () => {
  const folder = appOf({
    ...configs,
    "tests.mjs": testsOf(ran, 0),
    "tinker.effects": `${filed.slice(1).join("\n")}\n`,
  });
  main(["graph", folder, "--write"], "/");

  const { out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([
    "tinker.effects:1 tinker/effect tinker.effects has format 0; this CLI writes format 1: run `tinker check --write`, read the diff, and commit it",
  ]);
});

test(
  "`--write` with a failed test writes tinker.graph and no tinker.effects",
  { timeout: 60_000 },
  () => {
    const folder = appOf({ ...configs, "tests.mjs": testsOf(ran, 1) });

    const { code, out } = main(["check", folder, "--write"], "/");

    expect(code).toBe(1);
    expect(out).toContain("tinker check: tests failed.");
    expect(read(folder, "tinker.graph")).toContain("door.open");
    expect(() => read(folder, "tinker.effects")).toThrow();
  },
);

test(
  "a real test run: a library's cell and a test's own cell are in no line",
  { timeout: 300_000 },
  () => {
    const folder = appOf({
      ...configs,
      "tinker.json": JSON.stringify({ tests: `${at("node_modules/.bin/vp")} test run` }),
      "vite.config.ts": viteConfig(`  test: { server: { deps: { inline: ["vite-plus"] } } },`),
      "lib/tick.ts": [
        `import { data, operation } from "@tinkered/core";`,
        ``,
        `const ticks = data<number>({ label: "lib.ticks", initial: 0 });`,
        ``,
        `export const tick = operation({`,
        `  label: "lib.tick",`,
        `  depends: { ticks: ticks.controller },`,
        `  run: ({ ticks }) => ticks.update((count) => count + 1),`,
        `});`,
      ].join("\n"),
      "src/ops.ts": [
        `import { data, operation } from "@tinkered/core";`,
        `import { z } from "zod";`,
        ``,
        `import { tick } from "../lib/tick";`,
        ``,
        `const doors = data<string[]>({ label: "doors.list", initial: [] });`,
        ``,
        `export const open = operation({`,
        `  label: "door.open",`,
        `  input: z.boolean(),`,
        `  depends: { doors: doors.controller, tick },`,
        `  run: async ({ doors, tick }, { input }) => {`,
        `    await tick.run();`,
        `    if (!input) return { kind: "locked" as const };`,
        `    doors.set(["open"]);`,
        `    return { kind: "opened" as const };`,
        `  },`,
        `});`,
      ].join("\n"),
      "tests/door.test.ts": [
        `import { createScope, data, operation } from "@tinkered/core";`,
        `import { expect, test } from "vite-plus/test";`,
        ``,
        `import { exits } from "${at("src/test")}";`,
        ``,
        `import { open } from "../src/ops";`,
        ``,
        `const seen = data<string[]>({ label: "test.seen", initial: [] });`,
        ``,
        `const peek = operation({`,
        `  label: "test.peek",`,
        `  depends: { seen: seen.controller, open },`,
        `  run: async ({ seen, open }) => {`,
        `    seen.set(["peeked"]);`,
        `    return open.run({ input: false });`,
        `  },`,
        `});`,
        ``,
        `test("a door opens, or is locked", async () => {`,
        `  const scope = createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] });`,
        `  expect(await scope.run(open, { input: true })).toEqual({ kind: "opened" });`,
        `  expect(await scope.run(peek)).toEqual({ kind: "locked" });`,
        `  await scope.close();`,
        `});`,
      ].join("\n"),
    });

    const wrote = main(["check", folder, "--write"], "/");
    const first = read(folder, "tinker.effects");
    main(["check", folder, "--write"], "/");
    const again = main(["check", folder], "/");

    expect(wrote.out).toMatch(/tinker check: OK\n$/);
    expect(first).toBe(`${filed.join("\n")}\n`);
    expect(read(folder, "tinker.effects")).toBe(first);
    expect(again.out).toMatch(/effects \(2 lines\)\ntinker check: OK\n$/);
  },
);
