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

/** The issue move of the template: early returns, a ternary, a write at the end. */
const moveOf = (name: string, label: string, depends: string) => [
  `export const ${name} = operation({`,
  `  label: "${label}",`,
  `  depends: ${depends},`,
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

/** Operations that name their cells, tags and calls in each way a `run` can. */
const ops = [
  `import { operation, transport } from "@tinkered/core";`,
  ``,
  `import { count, flags, inTeam, issues } from "./units";`,
  ``,
  `const moveDeps = { list: issues.controller, ok: inTeam };`,
  ``,
  ...moveOf("move", "issue.move.do", "{ list: issues.controller, ok: inTeam }"),
  ``,
  ...moveOf("moveShared", "issue.move.shared", "moveDeps"),
  ``,
  ...moveOf("moveSpread", "issue.move.spread", "{ ...moveDeps }"),
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
  `    if (found) {`,
  `      return;`,
  `    } else {`,
  `      list.delete({ id: String(found) });`,
  `      throw new Error("no issue a");`,
  `    }`,
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
  ``,
  `export const again = operation({ label: "issues.inTeam.again", run: inTeam.run });`,
].join("\n");

/** What each move touches, however its deps are written. */
const moved =
  "exits{gone,moved,stale} reads{issues.list.of,issues.list.where} writes{issues.list.set} " +
  "calls{issues.inTeam}";

/** The graph of `ops`: each name is a label, never the local name. */
const golden = [
  "count.tick exits{value} reads{count.get,issues.list.where} writes{count.update} calls{}",
  "guard exits{refused,value} reads{issues.list.get} writes{} calls{issues.inTeam}",
  "issue.clear.do exits{cleared,kept} reads{} writes{issues.list.delete} calls{issues.inTeam}",
  "issue.look exits{value} reads{issues.list.of} writes{issues.list.delete} calls{}",
  `issue.move.do ${moved}`,
  `issue.move.shared ${moved}`,
  `issue.move.spread ${moved}`,
  "issues.inTeam exits{value} reads{} writes{} calls{}",
  "issues.inTeam.again exits{value} reads{} writes{} calls{}",
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

test("`tinker graph` prints each operation's exits and all its run touches, by label", () => {
  const folder = appOf({ "src/ops.ts": ops });

  const { code, out } = main(["graph", folder], "/");

  expect(code).toBe(0);
  expect(out).toBe(golden);
});

test(
  "code that matches its tinker.graph passes, with Windows line ends too",
  { timeout: 60_000 },
  () => {
    const folder = appOf({ "src/ops.ts": ops, "tinker.graph": golden.replaceAll("\n", "\r\n") });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(0);
    expect(out).toBe("ran: tsc, lint, rules (2 files), graph (9 operations)\ntinker check: OK\n");
  },
);

test("a write the file does not list is one finding at the operation", { timeout: 60_000 }, () => {
  const file = golden.replace(
    `issue.move.do ${moved}`,
    `issue.move.do ${moved.replace("writes{issues.list.set}", "writes{}")}`,
  );
  const folder = appOf({ "src/ops.ts": ops, "tinker.graph": file });

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(1);
  expect(findings(out)).toEqual([
    "src/ops.ts:7 tinker/graph issue.move.do: writes{issues.list.set}, tinker.graph says writes{}",
  ]);
  expect(out).toContain("\ntinker check: graph failed.\n");
});

test(
  "an operation the file lacks and a line the code lacks are findings",
  { timeout: 60_000 },
  () => {
    const look =
      "issue.look exits{value} reads{issues.list.of} writes{issues.list.delete} calls{}\n";
    const file = `${golden.replace(look, "")}issue.old.do exits{gone} reads{} writes{} calls{}\n`;
    const folder = appOf({ "src/ops.ts": ops, "tinker.graph": file });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(findings(out)).toEqual([
      "src/ops.ts:65 tinker/graph issue.look: not in tinker.graph",
      "tinker.graph:9 tinker/graph issue.old.do: in tinker.graph, not in the code",
    ]);
  },
);

test("no tinker.graph is one finding that says to write it", { timeout: 60_000 }, () => {
  const folder = appOf({ "src/ops.ts": ops });

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(1);
  expect(findings(out)).toEqual([
    "tinker.graph:1 tinker/graph there is no tinker.graph: " +
      "run `tinker graph --write` and commit it",
  ]);
});

test("`tinker graph --write` writes the file the check then passes", { timeout: 60_000 }, () => {
  const folder = appOf({ "src/ops.ts": ops });

  const wrote = main(["graph", folder, "--write"], "/");
  const { code } = main(["check", folder], "/");

  expect(wrote).toEqual({ code: 0, out: "wrote tinker.graph: 9 operations\n", err: "" });
  expect(readFileSync(join(folder, "tinker.graph"), "utf8")).toBe(golden);
  expect(code).toBe(0);
});
