import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, expect, test } from "vite-plus/test";

import { main } from "@/index";

/** This package's folder: an app links its `node_modules`, so it has `tsc`, `vp` and Core. */
const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** The issue move of the template, with the stale answer before the write. */
const move = [
  `export const move = operation({`,
  `  label: "issue.move.do",`,
  `  depends: { list: issues.controller, ok: inTeam },`,
  `  run: ({ list, ok }, { random }) => {`,
  `    const now = ok.run() ? list.of({ id: "a" }).get() : undefined;`,
  `    if (!now) return { kind: "gone" as const };`,
  `    if (list.where({}).get().length > random.next()) return { kind: "stale" as const };`,
  ``,
  `    list.set({ ...now, version: now.version + 1 });`,
  `    return { kind: "moved" as const };`,
  `  },`,
  `});`,
];

/** The bug: the stale path writes before it answers. */
const staleWrites = [
  ...move.slice(0, 6),
  `    list.set({ ...now, version: now.version + 1 });`,
  `    if (list.where({}).get().length > random.next()) return { kind: "stale" as const };`,
  ``,
  `    return { kind: "moved" as const };`,
  `  },`,
  `});`,
];

/** Operations that name their cells, tags and calls in each way a `run` can. */
const ops = (moveLines: readonly string[]) =>
  [
    `import { operation, transport } from "@tinkered/core";`,
    ``,
    `import { count, flags, inTeam, issues } from "./units";`,
    ``,
    ...moveLines,
    ``,
    `export const guard = operation({`,
    `  label: "guard",`,
    `  input: transport.hook.start,`,
    `  depends: { inTeam, list: issues.controller, on: flags.required },`,
    `  run: (deps, { input }) =>`,
    `    deps.list.get().length > 0 && deps.on.get("open")`,
    `      ? deps.inTeam.run()`,
    `      : input.refuse({}),`,
    `});`,
    ``,
    `export const tick = operation({`,
    `  label: "count.tick",`,
    `  depends: { total: count.controller, open: issues.where({}) },`,
    `  run({ total, open }) {`,
    `    if (open.get().length === total.get()) return;`,
    `    total.update((n) => n + 1);`,
    `  },`,
    `});`,
    ``,
    `export const look = operation({`,
    `  label: "issue.look",`,
    `  depends: { one: issues.of({ id: "a" }), list: issues.controller },`,
    `  run({ one, list }) {`,
    `    const found = one.get();`,
    `    if (found) return;`,
    `    list.delete({ id: String(found) });`,
    `    throw new Error("no issue a");`,
    `  },`,
    `});`,
    ``,
    `export const clear = operation({`,
    `  label: "issue.clear.do",`,
    `  depends: { list: issues.controller, ok: inTeam },`,
    `  run: ({ list, ok }) => {`,
    `    const pick = ok.settle().status === "success" ? "drop" : "keep";`,
    `    switch (pick) {`,
    `      case "drop":`,
    `        list.delete({ id: "a" });`,
    `        return { kind: "cleared" as const };`,
    `      case "keep":`,
    `        return { kind: "kept" as const };`,
    `    }`,
    `  },`,
    `});`,
  ].join("\n");

/** The graph of `ops(move)`: each name is a label, never the local name. */
const golden = [
  "count.tick value reads{count.get,issues.list.where} writes{count.update} calls{}",
  "guard refused reads{issues.list.get} writes{} calls{}",
  "guard value reads{issues.list.get} writes{} calls{issues.inTeam}",
  "issue.clear.do cleared reads{} writes{issues.list.delete} calls{issues.inTeam}",
  "issue.clear.do kept reads{} writes{} calls{issues.inTeam}",
  "issue.look value reads{issues.list.of} writes{} calls{}",
  "issue.move.do gone reads{issues.list.of} writes{} calls{issues.inTeam}",
  "issue.move.do moved reads{issues.list.of,issues.list.where} writes{issues.list.set} " +
    "calls{issues.inTeam}",
  "issue.move.do stale reads{issues.list.of,issues.list.where} writes{} calls{issues.inTeam}",
  "issues.inTeam value reads{} writes{} calls{}",
  "",
].join("\n");

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
    `    overrides: [{ files: ["src/**"], rules: gates }],`,
    `  },`,
    `});`,
  ].join("\n"),
  "src/units.ts": [
    `import { data, operation, tag } from "@tinkered/core";`,
    ``,
    `type Issue = { id: string; version: number };`,
    ``,
    `export const issues = data({`,
    `  label: "issues.list",`,
    `  mode: "keyed",`,
    `  key: (issue: Issue) => ({ id: issue.id }),`,
    `});`,
    ``,
    `export const count = data({ label: "count", initial: 0 });`,
    ``,
    `export const flags = tag<Map<string, boolean>>({ label: "flags" });`,
    ``,
    `export const inTeam = operation({`,
    `  label: "issues.inTeam",`,
    `  run: (_, { random }) => random.next() < 0.5,`,
    `});`,
  ].join("\n"),
};

/** A fresh app with these files over the configs. */
function appOf(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-graph-app-"));
  folders.push(folder);
  symlinkSync(at("node_modules"), join(folder, "node_modules"));

  for (const [path, text] of Object.entries({ ...configs, ...files })) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

/** The head of each finding: path, line, rule id and what is there. */
const findings = (out: string) => out.split("\n").filter((line) => /^\S+:\d+ /.test(line));

test("`tinker graph` prints each exit's reads, writes and calls, by label", () => {
  const folder = appOf({ "src/ops.ts": ops(move) });

  const { code, out } = main(["graph", folder], "/");

  expect(code).toBe(0);
  expect(out).toBe(golden);
});

test(
  "code that matches its tinker.graph passes, with Windows line ends too",
  { timeout: 60_000 },
  () => {
    const folder = appOf({
      "src/ops.ts": ops(move),
      "tinker.graph": golden.replaceAll("\n", "\r\n"),
    });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(0);
    expect(out).toBe("ran: tsc, lint, rules (2 files), graph (10 exits)\ntinker check: OK\n");
  },
);

test("a stale path that writes is one finding at the operation", { timeout: 60_000 }, () => {
  const folder = appOf({ "src/ops.ts": ops(staleWrites), "tinker.graph": golden });

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(1);
  expect(findings(out)).toEqual([
    "src/ops.ts:5 tinker/graph issue.move.do stale: " +
      "writes{issues.list.set}, tinker.graph says writes{}",
  ]);
  expect(out).toContain("\ntinker check: graph failed.\n");
});

test("an exit the file lacks and a line the code lacks are findings", { timeout: 60_000 }, () => {
  const stale =
    "issue.move.do stale reads{issues.list.of,issues.list.where} writes{} calls{issues.inTeam}\n";
  const file = `${golden.replace(stale, "")}issue.old.do gone reads{} writes{} calls{}\n`;
  const folder = appOf({ "src/ops.ts": ops(move), "tinker.graph": file });

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(1);
  expect(findings(out)).toEqual([
    "src/ops.ts:5 tinker/graph issue.move.do stale: not in tinker.graph",
    "tinker.graph:10 tinker/graph issue.old.do gone: in tinker.graph, not in the code",
  ]);
});

test("no tinker.graph is one finding that says to write it", { timeout: 60_000 }, () => {
  const folder = appOf({ "src/ops.ts": ops(move) });

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(1);
  expect(findings(out)).toEqual([
    "tinker.graph:1 tinker/graph there is no tinker.graph: " +
      "run `tinker graph --write` and commit it",
  ]);
});

test("`tinker graph --write` writes the file the check then passes", { timeout: 60_000 }, () => {
  const folder = appOf({ "src/ops.ts": ops(staleWrites) });

  const wrote = main(["graph", folder, "--write"], "/");
  const { code } = main(["check", folder], "/");

  expect(wrote).toEqual({ code: 0, out: "wrote tinker.graph: 10 exits\n", err: "" });
  expect(readFileSync(join(folder, "tinker.graph"), "utf8")).toContain(
    "issue.move.do stale reads{issues.list.of,issues.list.where} writes{issues.list.set} " +
      "calls{issues.inTeam}\n",
  );
  expect(code).toBe(0);
});
