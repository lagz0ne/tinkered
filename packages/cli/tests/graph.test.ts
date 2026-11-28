import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, expect, test } from "vite-plus/test";

import { main } from "@/index";

/** This package's folder: an app links its `node_modules`, with `tsc`, `vp`, Core and React. */
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
  "issue.look exits{value} faults{} reads{issues.list.get,issues.list.of} " +
  "writes{issues.list.delete} calls{} uses{}";

/** What each move touches, however its deps are written. */
const moved =
  "exits{gone,moved,stale} faults{} reads{issues.list.of,issues.list.where} writes{issues.list.set} " +
  "calls{issues.inTeam} uses{}";

/** A graph as `tinker.graph` holds it: the format line first. */
const filed = (lines: string) => `# tinker.graph 3\n${lines}`;

/** The graph of `ops`: each name is a label, never the local name. */
const golden = [
  "count.tick exits{value} faults{} reads{count.get,issues.list.where} writes{count.update} calls{} uses{}",
  "guard exits{refused,value} faults{} reads{issues.list.get} writes{} calls{issues.inTeam} uses{}",
  "issue.boxed exits{value} faults{?} reads{} writes{} calls{slot:box} uses{}",
  "issue.boxes exits{value} faults{?} reads{} writes{} calls{slot:box} uses{}",
  "issue.clear.do exits{cleared,kept} faults{} reads{} writes{issues.list.delete} " +
    "calls{issues.inTeam} uses{}",
  "issue.hand exits{value} faults{} reads{?} writes{?} calls{issues.inTeam} uses{}",
  "issue.late exits{value} faults{} reads{issues.list.get} writes{} calls{} uses{}",
  looked,
  "issue.maybe exits{value} faults{?} reads{} writes{} calls{slot:box} uses{}",
  "issue.move.again exits{gone,moved,stale} faults{?} reads{?} writes{?} calls{?} uses{}",
  `issue.move.do ${moved}`,
  `issue.move.shared ${moved}`,
  `issue.move.spread ${moved}`,
  "issue.pass exits{value} faults{?} reads{?} writes{?} calls{?} uses{}",
  "issue.peek exits{value} faults{} reads{?} writes{} calls{} uses{}",
  "issue.ping exits{value} faults{?} reads{} writes{} calls{?} uses{}",
  "issue.ping.again exits{value} faults{?} reads{?} writes{?} calls{?} uses{}",
  "issue.quoted exits{value} faults{} reads{issues.list.get} writes{} calls{} uses{}",
  "issue.raw exits{value} faults{} reads{?} writes{?} calls{} uses{}",
  "issue.rename exits{value} faults{?} reads{?} writes{?} calls{?} uses{}",
  "issue.shelved exits{value} faults{} reads{?} writes{?} calls{} uses{}",
  "issues.inTeam exits{value} faults{} reads{} writes{} calls{} uses{}",
  "issues.inTeam.again exits{value} faults{} reads{} writes{} calls{} uses{}",
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
    const folder = appOf({
      "src/ops.ts": ops,
      "tinker.graph": filed(golden).replaceAll("\n", "\r\n"),
    });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(0);
    expect(out).toBe(
      "ran: tsc, lint, rules (2 files), graph (23 operations, 0 views)\ntinker check: OK\n",
    );
  },
);

test("a write the file does not list is one finding at the operation", { timeout: 60_000 }, () => {
  const file = golden.replace(
    `issue.move.do ${moved}`,
    `issue.move.do ${moved.replace("writes{issues.list.set}", "writes{}")}`,
  );
  const folder = appOf({ "src/ops.ts": ops, "tinker.graph": filed(file) });

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(1);
  expect(findings(out)).toEqual([
    "src/ops.ts:7 tinker/graph issue.move.do: writes{issues.list.set}, tinker.graph says writes{}",
  ]);
  expect(out).toContain("\ntinker check: graph failed.\n");
});

test(
  "a line that lacks one part is one finding for that part, not for each later part (#68)",
  { timeout: 60_000 },
  () => {
    const lacking = moved.replace("faults{} ", "");
    const file = golden.replace(`issue.move.do ${moved}`, `issue.move.do ${lacking} extra{x}`);
    const folder = appOf({ "src/ops.ts": ops, "tinker.graph": filed(file) });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(findings(out)).toEqual([
      "src/ops.ts:7 tinker/graph issue.move.do: faults{}, tinker.graph says nothing; " +
        "no extra, tinker.graph says extra{x}",
    ]);
  },
);

test(
  "an operation the file lacks and a line the code lacks are findings",
  { timeout: 60_000 },
  () => {
    const look = `${looked}\n`;
    const file = `${golden.replace(look, "")}issue.old.do exits{gone} faults{} reads{} writes{} calls{}\n`;
    const folder = appOf({ "src/ops.ts": ops, "tinker.graph": filed(file) });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(findings(out)).toEqual([
      "src/ops.ts:65 tinker/graph issue.look: not in tinker.graph",
      "tinker.graph:24 tinker/graph issue.old.do: in tinker.graph, not in the code",
    ]);
  },
);

test("an op labelled view keeps its one-word key in the file", { timeout: 60_000 }, () => {
  const op = [
    `import { operation } from "@tinkered/core";`,
    ``,
    `export const view = operation({ label: "view", run: () => 1 });`,
  ].join("\n");
  const graph = [
    "# tinker.graph 3",
    "issues.inTeam exits{value} faults{} reads{} writes{} calls{} uses{}",
    "view exits{value} faults{} reads{} writes{} calls{} uses{}",
    "",
  ].join("\n");
  const folder = appOf({ "src/ops.ts": op, "tinker.graph": graph });

  const { code, out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([]);
  expect(code).toBe(0);
});

/** A mail capsule of the capsule skill: `send` hands a letter to the op its slot holds. */
const mailUnits = [
  `import { capsule, data, operation, tag, type Operation } from "@tinkered/core";`,
  ``,
  `const backend = tag<Operation.Handle<void, string>>({ label: "mail.backend" });`,
  ``,
  `const send = operation({`,
  `  label: "mail.send",`,
  `  depends: { backend },`,
  `  run: ({ backend }, { input }: { input: string }) => backend.run({ input }),`,
  `});`,
  ``,
  `const sent = data({ label: "mail.sent", initial: 0 });`,
  ``,
  `export const mail = capsule({`,
  `  label: "mail",`,
  `  config: { backend: backend.required },`,
  `  exports: { send, sent },`,
  `});`,
].join("\n");

test(
  "an op a capsule exports is named through the capsule; an op slot is named by its tag (#69)",
  { timeout: 60_000 },
  () => {
    const welcome = [
      `import { operation } from "@tinkered/core";`,
      ``,
      `import { mail } from "./units";`,
      ``,
      `export const welcome = operation({`,
      `  label: "mail.welcome",`,
      `  depends: { send: mail.send, count: mail.sent.controller },`,
      `  run: ({ send, count }) => {`,
      `    count.set(count.get() + 1);`,
      `    return send.run({ input: "You are in." });`,
      `  },`,
      `});`,
    ].join("\n");
    const folder = appOf({ "src/units.ts": mailUnits, "src/ops.ts": welcome });

    const { code, out } = main(["graph", folder], "/");

    expect(out).toBe(
      "mail.send exits{value} faults{?} reads{} writes{} calls{slot:mail.backend} uses{}\n" +
        "mail.welcome exits{value} faults{} reads{mail.sent.get} writes{mail.sent.set} " +
        "calls{mail.send} uses{}\n",
    );
    expect(code).toBe(0);
  },
);

test("a loop over a list slot names the slot, not `?` (#71)", { timeout: 60_000 }, () => {
  const units = [
    `import { operation, tag, type Operation } from "@tinkered/core";`,
    ``,
    `const listener = tag<Operation.Handle<unknown, string>>({ label: "signup.on" });`,
    ``,
    `export const join = operation({`,
    `  label: "signup.join",`,
    `  depends: { on: listener.all },`,
    `  run: async ({ on }, { input }: { input: string }) => {`,
    `    for (const each of on) await each.run({ input });`,
    `  },`,
    `});`,
  ].join("\n");
  const folder = appOf({ "src/units.ts": units, "src/ops.ts": "export {};\n" });

  const { code, out } = main(["graph", folder], "/");

  expect(out).toBe(
    "signup.join exits{value} faults{?} reads{} writes{} calls{slot:signup.on} uses{}\n",
  );
  expect(code).toBe(0);
});

/**
 * Capsules whose hooks run ops, wrap one, write a cell or hand `run` on, and one whose hook
 * touches nothing.
 */
const hooked = [
  `import { capsule, data, operation, resource, type Operation, type Scope } from "@tinkered/core";`,
  ``,
  `const seen = data<string[]>({ label: "tap.seen", initial: [] });`,
  ``,
  `const kept = { role: "state", explain: "Each letter the tap saw" } as const;`,
  ``,
  `const pumps = { role: "handler", explain: "Sends one letter per tick" } as const;`,
  ``,
  `export const send = operation({`,
  `  label: "mail.send",`,
  `  run: (_, { input }: { input: string }) => input,`,
  `});`,
  ``,
  `export const pump = operation({ label: "dispatch.pump", run: () => undefined });`,
  ``,
  `export const tap = capsule({`,
  `  label: "tap",`,
  `  exports: { seen },`,
  `  hooks: {`,
  `    run(event) {`,
  `      if (event.is(send)) {`,
  `        const letter = event.input;`,
  `        event.load(seen, kept).update((list) => [...list, letter]);`,
  `      }`,
  `      return event.next();`,
  `    },`,
  `  },`,
  `});`,
  ``,
  `export const dispatch = capsule({`,
  `  label: "dispatch",`,
  `  hooks: {`,
  `    async start({ next, run }) {`,
  `      await next();`,
  `      void run(pump, {}, pumps);`,
  `    },`,
  `  },`,
  `});`,
  ``,
  `export const relay = capsule({`,
  `  label: "relay",`,
  `  hooks: {`,
  `    async start({ next, run }) {`,
  `      await next();`,
  `      return (op: Operation.Handle<unknown, string>) => run(op, { input: "a" }, pumps);`,
  `    },`,
  `  },`,
  `});`,
  ``,
  `export const quiet = capsule({`,
  `  label: "quiet",`,
  `  hooks: {`,
  `    async start({ next }) {`,
  `      await next();`,
  `    },`,
  `  },`,
  `});`,
  ``,
  `export const keep = capsule({`,
  `  label: "keep",`,
  `  hooks: {`,
  `    async start({ next, run, load }) {`,
  `      await next();`,
  `      const list = load(seen, kept);`,
  `      return { run, list };`,
  `    },`,
  `  },`,
  `});`,
  ``,
  `export const routes = capsule({`,
  `  label: "routes",`,
  `  hooks: {`,
  `    async start({ next }) {`,
  `      await next();`,
  `      return (scope: Scope.Handle) => scope.run(send, { input: "a" });`,
  `    },`,
  `  },`,
  `});`,
  ``,
  `const pool = resource({ label: "mail.pool", factory: () => 2 });`,
  ``,
  `export const warm = capsule({`,
  `  label: "warm",`,
  `  hooks: {`,
  `    async start({ load, next }) {`,
  `      await load(pool, pumps);`,
  `      await next();`,
  `    },`,
  `  },`,
  `});`,
].join("\n");

/**
 * The hook lines of `hooked`: an op the graph cannot name is `?`, and so is each unit a
 * `run` or a `load` handed on may touch. A scope a callback gets runs ops too. A loaded
 * resource is a use, as in an op's `depends`.
 */
const hookLines = [
  "hook dispatch#start reads{} writes{} runs{dispatch.pump} wraps{} uses{}",
  "hook keep#start reads{?} writes{?} runs{?} wraps{} uses{}",
  "hook relay#start reads{} writes{} runs{?} wraps{} uses{}",
  "hook routes#start reads{} writes{} runs{mail.send} wraps{} uses{}",
  "hook tap#run reads{} writes{tap.seen.update} runs{} wraps{mail.send} uses{}",
  "hook warm#start reads{} writes{} runs{} wraps{} uses{mail.pool}",
];

test(
  "a capsule hook gets a hook line: what it reads, writes, runs and wraps (#72)",
  { timeout: 60_000 },
  () => {
    const folder = appOf({ "src/units.ts": hooked, "src/ops.ts": "export {};\n" });

    const { code, out } = main(["graph", folder], "/");

    expect(out.split("\n").filter((line) => line.startsWith("hook "))).toEqual(hookLines);
    expect(code).toBe(0);
  },
);

test(
  "a hook line the file lacks or says wrong is a finding at the hook (#72)",
  { timeout: 60_000 },
  () => {
    const folder = appOf({ "src/units.ts": hooked, "src/ops.ts": "export {};\n" });
    main(["graph", folder, "--write"], "/");
    const path = join(folder, "tinker.graph");
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.replace("wraps{mail.send}", "wraps{}").replace(/hook relay.*\n/, ""));

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(findings(out)).toEqual([
      "src/units.ts:20 tinker/graph hook tap#run: wraps{mail.send}, tinker.graph says wraps{}",
      "src/units.ts:43 tinker/graph hook relay#start: not in tinker.graph",
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

test(
  "a tinker.graph an older CLI wrote is one finding that says to write it again (#68)",
  { timeout: 60_000 },
  () => {
    const old = golden.replaceAll(" uses{}", "");
    const folder = appOf({ "src/ops.ts": ops, "tinker.graph": old });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(findings(out)).toEqual([
      "tinker.graph:1 tinker/graph tinker.graph has format 1; this CLI writes format 3: " +
        "run `tinker graph --write`, read the diff, and commit it",
    ]);
  },
);

test("`tinker graph --write` writes the file the check then passes", { timeout: 60_000 }, () => {
  const folder = appOf({ "src/ops.ts": ops });

  const wrote = main(["graph", folder, "--write"], "/");
  const { code } = main(["check", folder], "/");

  expect(wrote).toEqual({ code: 0, out: "wrote tinker.graph: 23 operations, 0 views\n", err: "" });
  expect(readFileSync(join(folder, "tinker.graph"), "utf8")).toBe(filed(golden));
  expect(code).toBe(0);
});

/**
 * A library's door: a capsule that exports an rpc contract, one whose exports are not written
 * in its call, two bare rpcs and two cells.
 */
const access = [
  `import { capsule, data, rpc } from "@tinkered/core";`,
  `import { z } from "zod";`,
  ``,
  `const user = rpc({`,
  `  "users.me": { input: z.null(), output: z.string() },`,
  `  list: { input: z.null(), output: z.array(z.string()) },`,
  `});`,
  ``,
  `export const access = capsule({`,
  `  label: "access",`,
  `  exports: {`,
  `    user,`,
  `    admin: user,`,
  `    staff: rpc({ ban: { input: z.string(), output: z.null() } }),`,
  `  },`,
  `});`,
  ``,
  `const doorExports = { user };`,
  ``,
  `export const door = capsule({ label: "door", exports: doorExports });`,
  ``,
  `export const counted = rpc(`,
  `  { "users.count": { input: z.null(), output: z.number() } },`,
  `  { label: "users" },`,
  `);`,
  ``,
  `export const loose = rpc({ "users.all": { input: z.null(), output: z.number() } });`,
  ``,
  `export const logins = data({ label: "access.logins", initial: new Array<string>() });`,
  ``,
  `export const codes = data({`,
  `  label: "access.codes",`,
  `  mode: "keyed",`,
  `  key: (code: { id: string }) => ({ id: code.id }),`,
  `});`,
].join("\n");

/** Each fault a call of a contract member can end with: Core's `Fault`, in code-unit order. */
const faultSet = "decode,encode,failed,invalid,link,missing,refused";

/** The `faults{}` part of a line whose run calls a contract member. */
const wire = `faults{${faultSet}}`;

/** An app of `access`, in place of the other units, and these operations: its graph. */
function graphWith(ops: string[]) {
  const head = `import { operation } from "@tinkered/core";\n\n`;
  const imports = `import { access, codes, counted, door, logins, loose } from "./units";\n\n`;
  const folder = appOf({ "src/units.ts": access, "src/ops.ts": head + imports + ops.join("\n") });
  return main(["graph", folder], "/");
}

test(
  "a member of an rpc contract that a capsule exports is named capsule.export/key",
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
      ``,
      `export const ban = operation({`,
      `  label: "home.ban",`,
      `  depends: { ban: access.staff.ban },`,
      `  run: ({ ban }) => ban.run({ input: "a" }),`,
      `});`,
      ``,
      `export const adminNames = operation({`,
      `  label: "home.adminNames",`,
      `  depends: { all: access.admin.list },`,
      `  run: ({ all }) => all.run({ input: null }),`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe(
      `home.adminNames exits{value} ${wire} reads{} writes{} calls{access.admin/list} uses{}\n` +
        `home.ban exits{value} ${wire} reads{} writes{} calls{access.staff/ban} uses{}\n` +
        `home.names exits{error,panic,value} ${wire} reads{} writes{} ` +
        `calls{access.user/list} uses{}\n` +
        `home.whoAmI exits{value} ${wire} reads{} writes{} calls{access.user/users.me} uses{}\n`,
    );
  },
);

test(
  "a member of a bare rpc const, with a label or not, keeps calls{?}",
  { timeout: 60_000 },
  () => {
    const { code, out } = graphWith([
      `export const count = operation({`,
      `  label: "home.count",`,
      `  depends: { count: counted["users.count"] },`,
      `  run: ({ count }) => count.run({ input: null }),`,
      `});`,
      ``,
      `export const all = operation({`,
      `  label: "home.all",`,
      `  depends: { all: loose["users.all"] },`,
      `  run: ({ all }) => all.run({ input: null }),`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe(
      "home.all exits{value} faults{?} reads{} writes{} calls{?} uses{}\n" +
        "home.count exits{value} faults{?} reads{} writes{} calls{?} uses{}\n",
    );
  },
);

test(
  "a member through a capsule whose exports are not written in its call keeps calls{?}",
  { timeout: 60_000 },
  () => {
    const { code, out } = graphWith([
      `export const whoAmI = operation({`,
      `  label: "home.whoAmI",`,
      `  depends: { me: door.user["users.me"] },`,
      `  run: ({ me }) => me.run({ input: null }),`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe("home.whoAmI exits{value} faults{?} reads{} writes{} calls{?} uses{}\n");
  },
);

test("a member under a key not written in the code keeps calls{?}", { timeout: 60_000 }, () => {
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
  expect(out).toBe("home.whoAmI exits{value} faults{?} reads{} writes{} calls{?} uses{}\n");
});

test(
  "a member under a key not in the contract, such as the handle's own answer op, " +
    "is a dep the graph cannot name",
  { timeout: 60_000 },
  () => {
    const { code, out } = graphWith([
      `export const answer = operation({`,
      `  label: "home.answer",`,
      `  depends: { answer: access.user.answer },`,
      `  run: ({ answer }) =>`,
      `    answer.settle({ input: { address: "list", value: null, meta: {} } }),`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe(
      "home.answer exits{error,panic,value} faults{?} reads{} writes{} calls{?} uses{}\n",
    );
  },
);

test(
  "a call of a contract member gives each fault Core's type says it can end with",
  { timeout: 60_000 },
  () => {
    const { code, out } = graphWith([
      `export const whoAmI = operation({`,
      `  label: "home.whoAmI",`,
      `  depends: { me: access.user["users.me"] },`,
      `  run: ({ me }) => me.run({ input: null }),`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe(
      `home.whoAmI exits{value} ${wire} reads{} writes{} calls{access.user/users.me} uses{}\n`,
    );
  },
);

test("two member calls give one set of faults", { timeout: 60_000 }, () => {
  const { code, out } = graphWith([
    `export const both = operation({`,
    `  label: "home.both",`,
    `  depends: { me: access.user["users.me"], all: access.user.list },`,
    `  run: ({ me, all }) => [me.run({ input: null }), all.run({ input: null })],`,
    `});`,
  ]);

  expect(code).toBe(0);
  expect(out).toBe(
    `home.both exits{value} ${wire} reads{} writes{} ` +
      `calls{access.user/list,access.user/users.me} uses{}\n`,
  );
});

test("a call of a plain op gives faults{}", { timeout: 60_000 }, () => {
  const { code, out } = graphWith([
    `const local = operation({ label: "home.local", run: () => 1 });`,
    ``,
    `export const near = operation({`,
    `  label: "home.near",`,
    `  depends: { local },`,
    `  run: ({ local }) => local.run(),`,
    `});`,
  ]);

  expect(code).toBe(0);
  expect(out).toBe(
    "home.local exits{value} faults{} reads{} writes{} calls{} uses{}\n" +
      "home.near exits{value} faults{} reads{} writes{} calls{home.local} uses{}\n",
  );
});

test(
  "a call the graph cannot name adds ? to faults{}, beside the faults of the member it names",
  { timeout: 60_000 },
  () => {
    const { code, out } = graphWith([
      `export const mixed = operation({`,
      `  label: "home.mixed",`,
      `  depends: { me: access.user["users.me"], all: loose["users.all"] },`,
      `  run: ({ me, all }) => [me.run({ input: null }), all.run({ input: null })],`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe(
      `home.mixed exits{value} faults{?,${faultSet}} reads{} writes{} ` +
        "calls{?,access.user/users.me} uses{}\n",
    );
  },
);

/**
 * Core as the app sees it, but its `rpc` handle's `fault.is` guards no type: the graph cannot
 * read the faults from it.
 */
const unguarded = [
  `import type { rpc as real } from "../node_modules/@tinkered/core/dist/index.mjs";`,
  ``,
  `export * from "../node_modules/@tinkered/core/dist/index.mjs";`,
  ``,
  `type Contracts = Parameters<typeof real>[0];`,
  ``,
  `export declare function rpc<C extends Contracts>(`,
  `  contracts: C,`,
  `): Omit<ReturnType<typeof real<C>>, "fault"> & { fault: { is(error: unknown): boolean } };`,
].join("\n");

test(
  "a member call whose contract type names no fault set gives faults{?}",
  { timeout: 60_000 },
  () => {
    const tsconfig = JSON.stringify({
      extends: at("base/tsconfig.json"),
      compilerOptions: {
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        paths: { "@tinkered/core": ["./core/index.d.ts"] },
      },
      include: ["src"],
    });
    const ops = [
      `import { operation } from "@tinkered/core";`,
      ``,
      `import { access } from "./units";`,
      ``,
      `export const whoAmI = operation({`,
      `  label: "home.whoAmI",`,
      `  depends: { me: access.user["users.me"] },`,
      `  run: ({ me }) => me.run({ input: null }),`,
      `});`,
    ].join("\n");
    const folder = appOf({
      "tsconfig.json": tsconfig,
      "core/index.d.ts": unguarded,
      "src/units.ts": access,
      "src/ops.ts": ops,
    });

    const { code, out } = main(["graph", folder], "/");

    expect(code).toBe(0);
    expect(out).toBe(
      "home.whoAmI exits{value} faults{?} reads{} writes{} calls{access.user/users.me} uses{}\n",
    );
  },
);

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
      "home.codesNow exits{value} faults{} reads{access.codes.where,access.logins.get} " +
        "writes{access.codes.delete,access.logins.set} calls{} uses{}\n",
    );
  },
);

/**
 * Resources an op may use: a plain one, a keyed one, two a capsule exports, and tags that hold
 * them. `odd` and `maker` have a `factory` key but are no resource.
 */
const stores = [
  `import { capsule, resource, tag } from "@tinkered/core";`,
  ``,
  `export const tx = resource({ label: "db.tx", factory: () => ({ rows: 0 }) });`,
  ``,
  `const id = tag<string>({ label: "db.id" });`,
  ``,
  `export const row = resource({`,
  `  label: "db.row",`,
  `  config: { id: id.required },`,
  `  factory: (_, { config }) => config.id,`,
  `});`,
  ``,
  `const pool = resource({ label: "pg.pool", factory: () => 2 });`,
  ``,
  `export const db = capsule({`,
  `  label: "db",`,
  `  exports: { pool, mail: resource({ label: "db.mail", factory: () => "sent" }) },`,
  `});`,
  ``,
  `const name = ["db", "loose"].join(".");`,
  ``,
  `export const loose = resource({ label: name, factory: () => 1 });`,
  ``,
  `export const held = tag<typeof tx>({ label: "db.held" });`,
  ``,
  `export const rowAt = resource({`,
  `  label: name,`,
  `  config: { id: id.required },`,
  `  factory: (_, { config }) => config.id,`,
  `});`,
  ``,
  `export const rows = tag<typeof row>({ label: "db.rows" });`,
  ``,
  `export const odd = capsule({ label: "odd", exports: { factory: pool } });`,
  ``,
  `export const maker = tag<{ factory: () => number }>({ label: "db.maker" });`,
].join("\n");

/** An app of `stores`, in place of the other units, and these operations: its graph. */
function usesGraph(ops: string[]) {
  const head = `import { operation } from "@tinkered/core";\n\n`;
  const names = "db, held, loose, maker, odd, row, rowAt, rows, tx";
  const imports = `import { ${names} } from "./units";\n\n`;
  const folder = appOf({ "src/units.ts": stores, "src/ops.ts": head + imports + ops.join("\n") });
  return main(["graph", folder], "/");
}

test(
  "uses{} names each resource depends names: a const, a keyed read, a capsule export",
  { timeout: 60_000 },
  () => {
    const { code, out } = usesGraph([
      `export const save = operation({`,
      `  label: "home.save",`,
      `  depends: { tx },`,
      `  run: ({ tx }) => tx.rows,`,
      `});`,
      ``,
      `export const sync = operation({`,
      `  label: "home.sync",`,
      `  depends: { one: row({ id: "a" }), pool: db.pool, mail: db["mail"], again: tx },`,
      `  run: ({ pool }) => pool,`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe(
      "home.save exits{value} faults{} reads{} writes{} calls{} uses{db.tx}\n" +
        "home.sync exits{value} faults{} reads{} writes{} calls{} uses{db.mail,db.row,db.tx,pg.pool}\n",
    );
  },
);

test(
  "a resource with no written label, under a key not written, or in a tag is uses{?}; a " +
    "capsule or a tag's value with a factory key is no resource",
  { timeout: 60_000 },
  () => {
    const { code, out } = usesGraph([
      `const key = "pool" as const;`,
      ``,
      `export const any = operation({`,
      `  label: "home.any",`,
      `  depends: { any: loose, tx },`,
      `  run: ({ any }) => any,`,
      `});`,
      ``,
      `export const keyed = operation({`,
      `  label: "home.keyed",`,
      `  depends: { pool: db[key] },`,
      `  run: ({ pool }) => pool,`,
      `});`,
      ``,
      `export const boxed = operation({`,
      `  label: "home.boxed",`,
      `  depends: { inBox: held.required },`,
      `  run: ({ inBox }) => inBox,`,
      `});`,
      ``,
      `export const one = operation({`,
      `  label: "home.one",`,
      `  depends: { r: rowAt({ id: "a" }) },`,
      `  run: () => 1,`,
      `});`,
      ``,
      `export const shelf = operation({`,
      `  label: "home.shelf",`,
      `  depends: { all: rows.required },`,
      `  run: ({ all }) => all,`,
      `});`,
      ``,
      `export const plain = operation({`,
      `  label: "home.plain",`,
      `  depends: { odd, make: maker.required },`,
      `  run: ({ make }) => make.factory(),`,
      `});`,
    ]);

    expect(code).toBe(0);
    expect(out).toBe(
      "home.any exits{value} faults{} reads{} writes{} calls{} uses{?,db.tx}\n" +
        "home.boxed exits{value} faults{} reads{} writes{} calls{} uses{?}\n" +
        "home.keyed exits{value} faults{} reads{} writes{} calls{} uses{?}\n" +
        "home.one exits{value} faults{} reads{} writes{} calls{} uses{?}\n" +
        "home.plain exits{value} faults{} reads{} writes{} calls{} uses{}\n" +
        "home.shelf exits{value} faults{} reads{} writes{} calls{} uses{?}\n",
    );
  },
);

/** Two ops a view runs: one sets a cell, one asks the door. */
const viewOps = [
  `import { operation } from "@tinkered/core";`,
  ``,
  `import { logins } from "./units";`,
  ``,
  `export const forget = operation({`,
  `  label: "home.forget",`,
  `  depends: { seen: logins.controller },`,
  `  run: ({ seen }) => seen.set([]),`,
  `});`,
  ``,
  `export const again = operation({`,
  `  label: "home.again",`,
  `  depends: { seen: logins.controller },`,
  `  run: ({ seen }) => seen.get().length,`,
  `});`,
].join("\n");

/**
 * Views in each way the graph names them: an aliased `useData`, a nested callback, a `memo`
 * const, a default export, a first argument it cannot name, and a local `useData` that is no
 * hook of React's.
 */
const views = [
  `import { memo } from "react";`,
  `import { useData as read, useRun } from "@tinkered/react";`,
  ``,
  `import { again, forget } from "../ops";`,
  `import { access, codes, counted, logins } from "../units";`,
  ``,
  `const cells = { seen: logins };`,
  ``,
  `export function SignIn() {`,
  `  const seen = read(logins);`,
  `  const some = read(codes.where({}));`,
  `  const me = useRun(access.user["users.me"]);`,
  `  const pick = () => (seen.length ? useRun(forget) : useRun(again));`,
  `  return <p>{some.length > 0 ? me.status : pick().status}</p>;`,
  `}`,
  ``,
  `export const Count = memo(function Count() {`,
  `  const seen = read(logins);`,
  `  const all = read(cells.seen);`,
  `  const count = useRun(counted["users.count"]);`,
  `  return <p>{seen.length + all.length > 0 ? count.status : null}</p>;`,
  `});`,
  ``,
  `function useData(cell: typeof codes) {`,
  `  return cell;`,
  `}`,
  ``,
  `export function Quiet() {`,
  `  return <p>{useData(codes).label}</p>;`,
  `}`,
  ``,
  `export default function () {`,
  `  return <p>{useRun(forget).status}</p>;`,
  `}`,
].join("\n");

/** The graph of `views`: the op lines, then the view lines, sorted by name. */
const viewLines = [
  "home.again exits{value} faults{} reads{access.logins.get} writes{} calls{} uses{}",
  "home.forget exits{value} faults{} reads{} writes{access.logins.set} calls{} uses{}",
  "view src/home/home.tsx#Count reads{?,access.logins.get} runs{?}",
  "view src/home/home.tsx#SignIn reads{access.codes.where,access.logins.get} " +
    "runs{access.user/users.me,home.again,home.forget}",
  "view src/home/home.tsx#default reads{} runs{home.forget}",
  "",
].join("\n");

/** One view that keeps every rule of the check: it reads a cell and runs an op. */
const signIn = [
  `import { useData, useRun } from "@tinkered/react";`,
  ``,
  `import { forget } from "../ops";`,
  `import { logins } from "../units";`,
  ``,
  `export function SignIn() {`,
  `  const seen = useData(logins);`,
  `  const { run } = useRun(forget);`,
  `  return <button onClick={() => run()}>{seen.length}</button>;`,
  `}`,
].join("\n");

/** The graph of `signIn`. */
const signInLines = [
  "# tinker.graph 3",
  "home.again exits{value} faults{} reads{access.logins.get} writes{} calls{} uses{}",
  "home.forget exits{value} faults{} reads{} writes{access.logins.set} calls{} uses{}",
  "view src/home/home.tsx#SignIn reads{access.logins.get} runs{home.forget}",
  "",
].join("\n");

/** The app's `tsconfig.json`, with JSX on. */
const jsxConfig = JSON.stringify({
  extends: at("base/tsconfig.json"),
  compilerOptions: {
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
  },
  include: ["src"],
});

/** An app of `access`, `viewOps` and these views, with JSX on. */
function viewApp(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-graph-views-"));
  folders.push(folder);
  symlinkSync(at("node_modules"), join(folder, "node_modules"));

  const own = { "tsconfig.json": jsxConfig, "src/units.ts": access, "src/ops.ts": viewOps };
  for (const [path, text] of Object.entries({ ...configs, ...own, ...files })) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

test(
  "a view line names each cell a view reads and each op it runs, by React's hooks only",
  { timeout: 60_000 },
  () => {
    const folder = viewApp({ "src/home/home.tsx": views });

    const { code, out } = main(["graph", folder], "/");

    expect(code).toBe(0);
    expect(out).toBe(viewLines);
  },
);

test("a view that matches its tinker.graph line passes the check", { timeout: 60_000 }, () => {
  const folder = viewApp({ "src/home/home.tsx": signIn, "tinker.graph": signInLines });

  const { code, out } = main(["check", folder], "/");

  expect(out).toBe(
    "ran: tsc, lint, rules (3 files), graph (2 operations, 1 view)\ntinker check: OK\n",
  );
  expect(code).toBe(0);
});

test("a changed view line and a view line the code lacks are findings", { timeout: 60_000 }, () => {
  const file =
    signInLines.replace("runs{home.forget}", "runs{}") +
    "view src/home/home.tsx#Gone reads{} runs{}\n";
  const folder = viewApp({ "src/home/home.tsx": signIn, "tinker.graph": file });

  const { code, out } = main(["check", folder], "/");

  expect(code).toBe(1);
  expect(findings(out)).toEqual([
    "src/home/home.tsx:6 tinker/graph view src/home/home.tsx#SignIn: " +
      "runs{home.forget}, tinker.graph says runs{}",
    "tinker.graph:5 tinker/graph view src/home/home.tsx#Gone: in tinker.graph, not in the code",
  ]);
});
