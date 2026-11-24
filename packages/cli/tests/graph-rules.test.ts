import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, expect, test } from "vite-plus/test";

import { main } from "@/index";

/** This package's folder: an app links its `node_modules`, so it has `tsc`, `vp` and Core. */
const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

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
    `import { capsule, data, operation, resource, rpc, tag } from "@tinkered/core";`,
    `import { z } from "zod";`,
    ``,
    `type Doc = { id: string; title: string };`,
    ``,
    `export const titles = data({`,
    `  label: "docs.title",`,
    `  mode: "keyed",`,
    `  key: (doc: Doc) => ({ id: doc.id }),`,
    `});`,
    ``,
    `export const locked = data({ label: "docs.locked", initial: false });`,
    ``,
    `export const count = data({ label: "docs", initial: 0 });`,
    ``,
    `export const canEdit = operation({`,
    `  label: "docs.canEdit",`,
    `  depends: { lock: locked },`,
    `  run: ({ lock }) => !lock,`,
    `});`,
    ``,
    `export const box = tag<typeof canEdit>({ label: "box" });`,
    ``,
    `const api = rpc({ check: { input: z.null(), output: z.boolean() } });`,
    ``,
    `export const gate = capsule({ label: "gate", exports: { api } });`,
    ``,
    `export const tx = resource({ label: "docs.tx", factory: () => ({ rows: 0 }) });`,
    ``,
    `export const shelf = tag<typeof tx>({ label: "shelf" });`,
  ].join("\n"),
};

/** One operation: its label, its deps, and its body as one line. */
const op = (label: string, depends: string, body: string) =>
  [
    `export const ${label.replaceAll(".", "_")} = operation({`,
    `  label: "${label}",`,
    `  depends: ${depends},`,
    `  run: (deps) => {`,
    `    ${body}`,
    `  },`,
    `});`,
  ].join("\n");

const write = `deps.list.set({ id: "a", title: "b" });`;

/** The app's operations, each as the tests name them. */
const ops = {
  edit: op("doc.edit.do", "{ ok: canEdit, list: titles.controller }", `deps.ok.run(); ${write}`),
  guard: op("doc.guard", "{ ok: canEdit }", "deps.ok.run();"),
  share: op(
    "doc.share.do",
    "{ ok: doc_guard, list: titles.controller }",
    `deps.ok.run(); ${write}`,
  ),
  remove: op("doc.delete.do", "{ list: titles.controller }", `deps.list.delete({ id: "a" });`),
  swap: op("doc.swap.do", "{ list: titles.controller }", `deps.list.delete({ id: "a" }); ${write}`),
  lock: op("docs.lock", "{ lock: locked.controller }", "deps.lock.set(true);"),
  create: op("doc.create.do", "{ list: titles.controller }", write),
  bump: op("docs.bump", "{ total: count.controller }", "deps.total.set(1);"),
  blind: op(
    "doc.blind.do",
    "{ ok: box.required, list: titles.controller }",
    `deps.ok.run(); ${write}`,
  ),
  peek: op("doc.peek", "{ ok: box.required }", "deps.ok.run();"),
  via: op(
    "doc.via.do",
    "{ ok: doc_peek, also: doc_blind_do, list: titles.controller }",
    `deps.ok.run(); deps.also.run(); ${write}`,
  ),
  hand: op("doc.hand", "{ list: titles.controller }", "[deps.list].pop();"),
  remote: op(
    "doc.remote.do",
    "{ ok: gate.api.check, list: titles.controller }",
    `void deps.ok.run({ input: null }); ${write}`,
  ),
  store: op("doc.store.do", "{ db: tx }", "return deps.db;"),
  stash: op("doc.stash.do", "{ db: tx }", "return deps.db;"),
  keep: op("doc.keep.do", "{ ok: canEdit, db: tx }", "deps.ok.run(); return deps.db;"),
  relay: op("doc.relay.do", "{ ok: doc_guard, db: tx }", "deps.ok.run(); return deps.db;"),
  shelved: op("doc.shelved", "{ db: shelf.required }", "return deps.db;"),
  hidden: op("doc.hidden.do", "{ ok: box.required, db: tx }", "deps.ok.run(); return deps.db;"),
};

const imports = [
  `import { operation } from "@tinkered/core";`,
  ``,
  `import { box, canEdit, count, gate, locked, shelf, titles, tx } from "./units";`,
].join("\n");

/**
 * An app with these operations, in this order, and these graph rules, its `tinker.graph`
 * written as the code is: only a rule can fail its graph stage.
 */
function appOf(names: (keyof typeof ops)[], rules: unknown[]) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-graph-rule-"));
  folders.push(folder);
  symlinkSync(at("node_modules"), join(folder, "node_modules"));

  mkdirSync(join(folder, "src"));
  const files = {
    ...configs,
    "src/docs.ts": [imports, ...names.map((name) => ops[name])].join("\n\n"),
    "tinker.json": JSON.stringify({ graph: { rules } }),
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(folder, path), text);

  main(["graph", folder, "--write"], "/");
  return folder;
}

/** The head of each finding: path, line, rule id and what is there. */
const findings = (out: string) => out.split("\n").filter((line) => /^\S+:\d+ /.test(line));

const rule = { writes: "docs.*", calls: "docs.canEdit" };

test("an op that calls the rule's op itself keeps the rule", { timeout: 60_000 }, () => {
  const folder = appOf(["edit"], [rule]);

  const { code, out } = main(["check", folder], "/");

  expect(out).toBe(
    "ran: tsc, lint, rules (2 files), graph (2 operations, 0 views, 1 rule)\ntinker check: OK\n",
  );
  expect(code).toBe(0);
});

test(
  "an op that reaches the rule's op only through an op it calls keeps it",
  { timeout: 60_000 },
  () => {
    const folder = appOf(
      ["guard", "share"],
      [rule, { writes: "docs.title", calls: "docs.canEdit" }],
    );

    const { code, out } = main(["check", folder], "/");

    expect(out).toBe(
      "ran: tsc, lint, rules (2 files), graph (3 operations, 0 views, 2 rules)\ntinker check: OK\n",
    );
    expect(code).toBe(0);
  },
);

test(
  "an op that writes a matching cell and never calls the rule's op is a finding with its fix",
  { timeout: 60_000 },
  () => {
    const folder = appOf(["swap"], [rule]);

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(out).toContain(
      [
        "src/docs.ts:5 tinker/graph-rule doc.swap.do " +
          "writes{docs.title.delete,docs.title.set}, calls has no docs.canEdit",
        "  Right: call the check from the operation, as a",
      ].join("\n"),
    );
    expect(out).toContain("  more: tinker skill load @tinkered/core#core/operation\n");
    expect(out).toContain("\ntinker check: graph failed.\n");
  },
);

test("an op the rule excepts, with its reason, is no finding", { timeout: 60_000 }, () => {
  const folder = appOf(
    ["create", "remove"],
    [{ ...rule, except: { "doc.create.do": "No doc yet." } }],
  );

  const { out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([
    "src/docs.ts:13 tinker/graph-rule doc.delete.do writes{docs.title.delete}, " +
      "calls has no docs.canEdit",
  ]);
});

test("the rule's own op writes a matching cell and is no finding", { timeout: 60_000 }, () => {
  const folder = appOf(["lock", "remove"], [{ writes: "docs.locked", calls: "docs.lock" }]);

  const { code, out } = main(["check", folder], "/");

  expect(out).toBe(
    "ran: tsc, lint, rules (2 files), graph (3 operations, 0 views, 1 rule)\ntinker check: OK\n",
  );
  expect(code).toBe(0);
});

test("a pattern names a cell, so any write method matches it", { timeout: 60_000 }, () => {
  const folder = appOf(["remove"], [{ writes: "docs.title", calls: "doc.title" }]);

  const { out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([
    "src/docs.ts:5 tinker/graph-rule doc.delete.do writes{docs.title.delete}, " +
      "calls has no doc.title",
  ]);
});

test("`*` in a pattern stands for one label part or more", { timeout: 60_000 }, () => {
  const folder = appOf(
    ["bump", "remove"],
    [
      { writes: "docs.*", calls: "doc.part" },
      { writes: "*", calls: "doc.all" },
    ],
  );

  const { out } = main(["check", folder], "/");

  const head = "src/docs.ts:13 tinker/graph-rule doc.delete.do writes{docs.title.delete}";
  expect(findings(out)).toEqual([
    "src/docs.ts:5 tinker/graph-rule docs.bump writes{docs.set}, calls has no doc.all",
    `${head}, calls has no doc.part`,
    `${head}, calls has no doc.all`,
  ]);
});

test("a write the graph cannot see matches no pattern", { timeout: 60_000 }, () => {
  const folder = appOf(["hand"], [{ writes: "*", calls: "doc.all" }]);

  const { code, out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([]);
  expect(code).toBe(0);
});

test(
  "an op the graph has no line for, such as an rpc member, ends the way",
  { timeout: 60_000 },
  () => {
    const folder = appOf(["remote"], [rule]);

    const { out } = main(["check", folder], "/");

    expect(findings(out)).toEqual([
      "src/docs.ts:5 tinker/graph-rule doc.remote.do writes{docs.title.set}, " +
        "calls has no docs.canEdit",
    ]);
  },
);

test(
  "a `?` in calls, its own or on the way, cannot prove the rule and is a finding",
  { timeout: 60_000 },
  () => {
    const folder = appOf(["blind", "peek", "via"], [rule]);

    const { out } = main(["check", folder], "/");

    expect(findings(out)).toEqual([
      "src/docs.ts:5 tinker/graph-rule doc.blind.do writes{docs.title.set}, " +
        "calls{?} in doc.blind.do cannot prove docs.canEdit",
      "src/docs.ts:21 tinker/graph-rule doc.via.do writes{docs.title.set}, " +
        "calls{?} in doc.blind.do, doc.peek cannot prove docs.canEdit",
    ]);
  },
);

const uses = { uses: "docs.tx", calls: "docs.canEdit" };

test(
  "an op that uses a matching resource and never calls the rule's op is a finding",
  { timeout: 60_000 },
  () => {
    const folder = appOf(["store", "keep"], [uses]);

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(findings(out)).toEqual([
      "src/docs.ts:5 tinker/graph-rule doc.store.do uses{docs.tx}, calls has no docs.canEdit",
    ]);
  },
);

test(
  "an op that uses a matching resource and reaches the rule's op through an op it calls keeps it",
  { timeout: 60_000 },
  () => {
    const folder = appOf(["guard", "relay"], [uses]);

    const { code, out } = main(["check", folder], "/");

    expect(out).toBe(
      "ran: tsc, lint, rules (2 files), graph (3 operations, 0 views, 1 rule)\ntinker check: OK\n",
    );
    expect(code).toBe(0);
  },
);

test("a uses rule takes `*` and `except` as a writes rule does", { timeout: 60_000 }, () => {
  const folder = appOf(
    ["store", "stash"],
    [{ uses: "docs.*", calls: "docs.canEdit", except: { "doc.store.do": "No doc yet." } }],
  );

  const { out } = main(["check", folder], "/");

  expect(findings(out)).toEqual([
    "src/docs.ts:13 tinker/graph-rule doc.stash.do uses{docs.tx}, calls has no docs.canEdit",
  ]);
});

test(
  "a resource the graph cannot name matches no uses pattern; a `?` in calls cannot prove it",
  { timeout: 60_000 },
  () => {
    const folder = appOf(["shelved", "hidden"], [{ uses: "*", calls: "docs.canEdit" }]);

    const { out } = main(["check", folder], "/");

    expect(findings(out)).toEqual([
      "src/docs.ts:13 tinker/graph-rule doc.hidden.do uses{docs.tx}, " +
        "calls{?} in doc.hidden.do cannot prove docs.canEdit",
    ]);
  },
);

test.each([
  [{ graph: [] }, "`graph` is an object"],
  [{ graph: { rules: {} } }, "`graph.rules` is a list"],
  [{ graph: { rules: ["docs.*"] } }, "`graph.rules` is a list"],
  [{ graph: { rules: [{ calls: "docs.canEdit" }] } }, "`graph.rules` is a list"],
  [
    { graph: { rules: [rule, { writes: "docs*", calls: "docs.canEdit" }] } },
    "`graph.rules` is a list",
  ],
  [
    { graph: { rules: [{ writes: "docs..title", calls: "docs.canEdit" }] } },
    "`graph.rules` is a list",
  ],
  [{ graph: { rules: [{ writes: "docs.*" }] } }, "`graph.rules` is a list"],
  [{ graph: { rules: [{ ...rule, uses: "docs.tx" }] } }, "`graph.rules` is a list"],
  [{ graph: { rules: [{ uses: "docs*", calls: "docs.canEdit" }] } }, "`graph.rules` is a list"],
  [{ graph: { rules: [{ uses: "docs.tx" }] } }, "`graph.rules` is a list"],
  [{ graph: { rules: [{ ...rule, except: ["doc.create.do"] }] } }, "`graph.rules` is a list"],
  [{ graph: { rules: [{ ...rule, except: { "doc.create.do": 1 } }] } }, "`graph.rules` is a list"],
])("a graph rule of the wrong shape stops the check: %j", (config, reason) => {
  const folder = mkdtempSync(join(tmpdir(), "tinker-graph-rule-"));
  folders.push(folder);
  writeFileSync(join(folder, "tinker.json"), JSON.stringify(config));

  const { code, err } = main(["check", folder], "/");

  expect(code).toBe(2);
  expect(err).toContain(`tinker.json: ${reason}`);
});
