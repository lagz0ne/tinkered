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
  `import { api, box, cells, count, flags, inTeam, issues, shelf } from "./units";`,
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
  `  depends: { one: issues.of({ id: "a" }), list: issues.controller, all: issues },`,
  `  run({ one, list, all }) {`,
  `    const found = one.get();`,
  `    if (found || all.length === 0) {`,
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
  ``,
  `export const moveAgain = operation({`,
  `  label: "issue.move.again",`,
  `  depends: moveDeps,`,
  `  run: move.run,`,
  `});`,
  ``,
  `export const hand = operation({`,
  `  label: "issue.hand",`,
  `  depends: moveDeps,`,
  `  run: (deps) => {`,
  `    const { list, ok: check } = deps;`,
  `    const all = [list];`,
  `    return check.run() ? all.length : 0;`,
  `  },`,
  `});`,
  ``,
  `export const pass = operation({`,
  `  label: "issue.pass",`,
  `  depends: moveDeps,`,
  `  run: (deps) => [deps].length,`,
  `});`,
  ``,
  `export const ping = operation({`,
  `  label: "issue.ping",`,
  `  depends: { ping: api.ping },`,
  `  run: ({ ping }) => ping.run(),`,
  `});`,
  ``,
  `export const raw = operation({`,
  `  label: "issue.raw",`,
  `  depends: { list: cells.list.controller },`,
  `  run: ({ list }) => list.set({ id: "r", version: 1 }),`,
  `});`,
  ``,
  `export const peek = operation({`,
  `  label: "issue.peek",`,
  `  depends: { some: cells.list.where({}) },`,
  `  run: ({ some }) => some.get().length,`,
  `});`,
  ``,
  `export const rename = operation({`,
  `  label: "issue.rename",`,
  `  depends: moveDeps,`,
  `  run: (deps) => {`,
  `    const all = deps;`,
  `    return Object.keys(all).length;`,
  `  },`,
  `});`,
  ``,
  `export const boxed = operation({`,
  `  label: "issue.boxed",`,
  `  depends: { inBox: box.required },`,
  `  run: ({ inBox }) => inBox.run(),`,
  `});`,
  ``,
  `export const pingAgain = operation({`,
  `  label: "issue.ping.again",`,
  `  depends: { ping: api.ping },`,
  `  run: ping.run,`,
  `});`,
  ``,
  `export const quoted = operation({`,
  `  label: "issue.quoted",`,
  `  depends: { "the-list": issues.controller },`,
  `  run: (deps) => {`,
  `    const { "the-list": list } = deps;`,
  `    return list.get().length;`,
  `  },`,
  `});`,
  ``,
  `export const late = operation({`,
  `  label: "issue.late",`,
  `  depends: { list: issues.controller },`,
  `  run: async (deps) => {`,
  `    const size = Promise.resolve().then(() => list.get().length);`,
  `    const { list } = deps;`,
  `    return size;`,
  `  },`,
  `});`,
  ``,
  `export const boxes = operation({`,
  `  label: "issue.boxes",`,
  `  depends: { every: box.all },`,
  `  run: ({ every }) => every.length,`,
  `});`,
  ``,
  `export const maybe = operation({`,
  `  label: "issue.maybe",`,
  `  depends: { held: box.optional },`,
  `  run: ({ held }) => held.present,`,
  `});`,
  ``,
  `export const shelved = operation({`,
  `  label: "issue.shelved",`,
  `  depends: { held: shelf.required },`,
  `  run: ({ held }) => held.length,`,
  `});`,
].join("\n");

/** What `look` touches: its bare `all` reads the cell's value. */
const looked =
  "issue.look exits{value} reads{issues.list.get,issues.list.of} " +
  "writes{issues.list.delete} calls{}";

/** What each move touches, however its deps are written. */
const moved =
  "exits{gone,moved,stale} reads{issues.list.of,issues.list.where} writes{issues.list.set} " +
  "calls{issues.inTeam}";

/** The graph of `ops`: each name is a label, never the local name. */
const golden = [
  "count.tick exits{value} reads{count.get,issues.list.where} writes{count.update} calls{}",
  "guard exits{refused,value} reads{issues.list.get} writes{} calls{issues.inTeam}",
  "issue.boxed exits{value} reads{} writes{} calls{?}",
  "issue.boxes exits{value} reads{} writes{} calls{?}",
  "issue.clear.do exits{cleared,kept} reads{} writes{issues.list.delete} calls{issues.inTeam}",
  "issue.hand exits{value} reads{?} writes{?} calls{issues.inTeam}",
  "issue.late exits{value} reads{issues.list.get} writes{} calls{}",
  looked,
  "issue.maybe exits{value} reads{} writes{} calls{?}",
  "issue.move.again exits{gone,moved,stale} reads{?} writes{?} calls{?}",
  `issue.move.do ${moved}`,
  `issue.move.shared ${moved}`,
  `issue.move.spread ${moved}`,
  "issue.pass exits{value} reads{?} writes{?} calls{?}",
  "issue.peek exits{value} reads{?} writes{} calls{}",
  "issue.ping exits{value} reads{} writes{} calls{?}",
  "issue.ping.again exits{value} reads{?} writes{?} calls{?}",
  "issue.quoted exits{value} reads{issues.list.get} writes{} calls{}",
  "issue.raw exits{value} reads{?} writes{?} calls{}",
  "issue.rename exits{value} reads{?} writes{?} calls{?}",
  "issue.shelved exits{value} reads{?} writes{?} calls{}",
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
    `export const shelf = tag<typeof issues>({ label: "shelf" });`,
    ``,
    `export const inTeam = operation({`,
    `  label: "issues.inTeam",`,
    `  run: (_, { random }) => random.next() < 0.5,`,
    `});`,
    ``,
    `export const api = { ping: inTeam };`,
    ``,
    `export const box = tag<typeof inTeam>({ label: "box" });`,
    ``,
    `export const cells = { list: issues };`,
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

test(
  "`tinker graph` prints each operation's exits and all its run touches, by label",
  { timeout: 60_000 },
  () => {
    const folder = appOf({ "src/ops.ts": ops });

    const { code, out } = main(["graph", folder], "/");

    expect(code).toBe(0);
    expect(out).toBe(golden);
  },
);

test(
  "code that matches its tinker.graph passes, with Windows line ends too",
  { timeout: 60_000 },
  () => {
    const folder = appOf({ "src/ops.ts": ops, "tinker.graph": golden.replaceAll("\n", "\r\n") });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(0);
    expect(out).toBe("ran: tsc, lint, rules (2 files), graph (23 operations)\ntinker check: OK\n");
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
    const look = `${looked}\n`;
    const file = `${golden.replace(look, "")}issue.old.do exits{gone} reads{} writes{} calls{}\n`;
    const folder = appOf({ "src/ops.ts": ops, "tinker.graph": file });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(findings(out)).toEqual([
      "src/ops.ts:65 tinker/graph issue.look: not in tinker.graph",
      "tinker.graph:23 tinker/graph issue.old.do: in tinker.graph, not in the code",
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

  expect(wrote).toEqual({ code: 0, out: "wrote tinker.graph: 23 operations\n", err: "" });
  expect(readFileSync(join(folder, "tinker.graph"), "utf8")).toBe(golden);
  expect(code).toBe(0);
});

/** A library's door: a capsule that exports an rpc contract, beside cells and two bare rpcs. */
const access = [
  `import { capsule, data, rpc } from "@tinkered/core";`,
  `import { z } from "zod";`,
  ``,
  `const user = rpc({`,
  `  "users.me": { input: z.null(), output: z.string() },`,
  `  list: { input: z.null(), output: z.array(z.string()) },`,
  `});`,
  ``,
  `export const access = capsule({ label: "access", exports: { user } });`,
  ``,
  `export const counted = rpc(`,
  `  { "users.count": { input: z.null(), output: z.number() } },`,
  `  { label: "users" },`,
  `);`,
  ``,
  `export const loose = rpc({ "users.all": { input: z.null(), output: z.number() } });`,
  ``,
  `export const logins = data({ label: "access.logins", initial: [] as string[] });`,
  ``,
  `export const codes = data({`,
  `  label: "access.codes",`,
  `  mode: "keyed",`,
  `  key: (code: { id: string }) => ({ id: code.id }),`,
  `});`,
].join("\n");

/** An app of `access`, in place of the other units, and these operations: its graph. */
function graphWith(ops: string[]) {
  const head = `import { operation } from "@tinkered/core";\n\n`;
  const imports = `import { access, codes, counted, logins, loose } from "./units";\n\n`;
  const folder = appOf({ "src/units.ts": access, "src/ops.ts": head + imports + ops.join("\n") });
  return main(["graph", folder], "/");
}

test(
  "a run of an rpc contract's member through a capsule calls capsule.export/key",
  { timeout: 60_000 },
  () => {
    const { code, out } = graphWith([
      `export const whoAmI = operation({`,
      `  label: "home.whoAmI",`,
      `  depends: { me: access.user["users.me"] },`,
      `  run: ({ me }) => me.run({ input: null }),`,
      `});`,
      ``,
      `export const names = operation({`,
      `  label: "home.names",`,
      `  depends: { all: access.user.list.controller },`,
      `  run: ({ all }) => all.settle({ input: null }),`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe(
      "home.names exits{error,panic,value} reads{} writes{} calls{access.user/list}\n" +
        "home.whoAmI exits{value} reads{} writes{} calls{access.user/users.me}\n",
    );
  },
);

test("a run of a labelled rpc's member calls label/key", { timeout: 60_000 }, () => {
  const { code, out } = graphWith([
    `export const count = operation({`,
    `  label: "home.count",`,
    `  depends: { count: counted["users.count"] },`,
    `  run: ({ count }) => count.run({ input: null }),`,
    `});`,
  ]);

  expect(code).toBe(0);
  expect(out).toBe("home.count exits{value} reads{} writes{} calls{users/users.count}\n");
});

test("a member of an rpc with no label keeps calls{?}", { timeout: 60_000 }, () => {
  const { code, out } = graphWith([
    `export const all = operation({`,
    `  label: "home.all",`,
    `  depends: { all: loose["users.all"] },`,
    `  run: ({ all }) => all.run({ input: null }),`,
    `});`,
  ]);

  expect(code).toBe(0);
  expect(out).toBe("home.all exits{value} reads{} writes{} calls{?}\n");
});

test("a member under a computed key keeps calls{?}", { timeout: 60_000 }, () => {
  const { code, out } = graphWith([
    `const key = "users.me" as const;`,
    ``,
    `export const whoAmI = operation({`,
    `  label: "home.whoAmI",`,
    `  depends: { me: access.user[key] },`,
    `  run: ({ me }) => me.run({ input: null }),`,
    `});`,
  ]);

  expect(code).toBe(0);
  expect(out).toBe("home.whoAmI exits{value} reads{} writes{} calls{?}\n");
});

test(
  "an atScope or atNamespace controller reads and writes as the cell's controller does",
  { timeout: 60_000 },
  () => {
    const { code, out } = graphWith([
      `export const codesNow = operation({`,
      `  label: "home.codesNow",`,
      `  depends: { seen: logins.atScope.controller, all: codes.atNamespace.controller },`,
      `  run: ({ seen, all }) => {`,
      `    if (seen.get().length === 0) all.delete({ id: "a" });`,
      `    seen.set([]);`,
      `    return all.where({}).get().length;`,
      `  },`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe(
      "home.codesNow exits{value} reads{access.codes.where,access.logins.get} " +
        "writes{access.codes.delete,access.logins.set} calls{}\n",
    );
  },
);
