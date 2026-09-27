// Plain rule breaks: each census rule the writer guidelines share fires on a minimal bad
// snippet with its id and line, and never on the same words inside a string or a comment.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspectPlain } from "./plain.mjs";

const TEST = "tests/app.test.ts";
const SRC = "src/app.ts";

/** The `[id, line]` pairs a file yields. */
const hits = (source, file, writer = true) =>
  inspectPlain(source, file, { writer }).map((r) => [r.id, r.line]);

void describe("plain rules in a test file", () => {
  void it("T01 fires on a mock or spy call", () => {
    assert.deepEqual(hits('const f = 1;\nconst g = vi.fn();\njest.spyOn(o, "x");\n', TEST), [
      ["T01", 2],
      ["T01", 3],
    ]);
  });

  void it("T02 fires on setTimeout, sleep, and waitForTimeout", () => {
    const src = [
      "await new Promise((r) => setTimeout(r, 5));",
      "await sleep(10);",
      "await page.waitForTimeout(100);",
    ].join("\n");
    assert.deepEqual(hits(src, "tests/app.browser.test.ts"), [
      ["T02", 1],
      ["T02", 2],
      ["T02", 3],
    ]);
  });

  void it("T03 fires on only and skip off test, it, or describe", () => {
    const src = 'test.only("a", () => {});\ndescribe.skip("b", () => {});\n';
    assert.deepEqual(hits(src, TEST), [
      ["T03", 1],
      ["T03", 2],
    ]);
  });

  void it("T04 fires on an import of a private source module", () => {
    const src = 'import { a } from "../src/model";\nimport { b } from "../src/model.ts";\n';
    assert.deepEqual(hits(src, TEST), [
      ["T04", 1],
      ["T04", 2],
    ]);
  });

  void it("T05 fires on an internals probe", () => {
    assert.deepEqual(hits("\nObject.isFrozen(x);\n", TEST), [["T05", 2]]);
  });

  void it("T06 fires on a cast through unknown", () => {
    assert.deepEqual(hits("const y = x as unknown as T;\n", TEST), [["T06", 1]]);
  });

  void it("T07 fires on an error class, snapshot, or message assert", () => {
    const src = [
      "expect(e).toBeInstanceOf(Error);",
      "expect(f).toThrowErrorMatchingInlineSnapshot();",
      'expect(f).toThrow("boom");',
    ].join("\n");
    assert.deepEqual(hits(src, TEST), [
      ["T07", 1],
      ["T07", 2],
      ["T07", 3],
    ]);
  });

  void it("T08 fires on isError inside expect", () => {
    assert.deepEqual(hits('\n\nexpect(isError(e, "X")).toBe(true);\n', TEST), [["T08", 3]]);
  });
});

void describe("plain rules in a source file", () => {
  void it("S02 fires on a cast through unknown", () => {
    assert.deepEqual(hits("const y = (x as unknown) as T;\n", SRC), [["S02", 1]]);
  });

  void it("S05 fires on a bare throw of Error, TypeError, or RangeError", () => {
    const src = 'throw new Error("a");\nthrow new TypeError("b");\nthrow new RangeError("c");\n';
    assert.deepEqual(hits(src, SRC), [
      ["S05", 1],
      ["S05", 2],
      ["S05", 3],
    ]);
  });

  void it("S17 fires on a type assertion in either form", () => {
    const src = "const a = v as string;\nconst b = <Poll>v;\nconst c = {} as Poll;\n";
    assert.deepEqual(hits(src, SRC), [
      ["S17", 1],
      ["S17", 2],
      ["S17", 3],
    ]);
  });

  void it("S17 leaves as const and an empty list's element type alone", () => {
    assert.deepEqual(
      hits('const k = ["a"] as const;\nconst l = [] as readonly Poll[];\n', SRC),
      [],
    );
  });

  void it("S17 does not repeat a cast through unknown that S02 reports", () => {
    assert.deepEqual(hits("const y = v as unknown as T;\n", SRC), [["S02", 1]]);
  });

  void it("S17 is writer policy: the repo's own lint does not report it", () => {
    assert.deepEqual(hits("const a = v as string;\n", SRC, false), []);
  });

  void it("S17 does not apply to test files", () => {
    assert.deepEqual(hits("const a = v as string;\n", TEST), []);
  });

  void it("S18 fires on a unit builder called inside a function", () => {
    const src = [
      'import { operation } from "@tinker/core";',
      "function textAction(label: string) {",
      "  return operation({ label, run: () => 1 });",
      "}",
    ].join("\n");
    assert.deepEqual(hits(src, SRC), [["S18", 3]]);
  });

  void it("S18 leaves a module-level unit and a non-core function alone", () => {
    const src = [
      'import { operation } from "@tinker/core";',
      'export const op = operation({ label: "op", run: () => 1 });',
      "const operationLike = (f: () => number) => f();",
      "function build() {\n  return operationLike(() => 1);\n}",
    ].join("\n");
    assert.deepEqual(hits(src, SRC), []);
  });

  void it("S18 fires on a sync family made inside a function", () => {
    const src = [
      'import { family } from "@tinker/sync";',
      "const todos = (label: string) => family({ label, initial: '' });",
    ].join("\n");
    assert.deepEqual(hits(src, SRC), [["S18", 2]]);
  });

  void it("S18 leaves a driver's extension built from wiring rows alone", () => {
    const src = [
      'import { extension } from "@tinker/core";',
      "export function mcp(rows: readonly Row[]) {",
      '  return extension({ label: "mcp", start: (scope, ctx, next) => next() });',
      "}",
    ].join("\n");
    assert.deepEqual(hits(src, SRC), []);
  });

  void it("S18's message names exactly the builders it counts", () => {
    const [found] = inspectPlain(
      'import { data } from "@tinker/core";\nfunction f() { return data({ label: "x", initial: 1 }); }\n',
      SRC,
      { writer: true },
    );
    assert.match(found.message, /data, operation, resource, tag, and family once/);
  });

  void it("S19 fires on a helper that takes a controller, directly or through a type alias", () => {
    const src = [
      'import type { Scope } from "@tinker/core";',
      "type Cells = { notice: Scope.DataController<string> };",
      "function fail(n: Scope.DataController<string>) {}",
      "const save = (cells: Cells) => cells;",
    ].join("\n");
    assert.deepEqual(hits(src, SRC), [
      ["S19", 3],
      ["S19", 4],
    ]);
  });

  void it("S19 leaves a helper over plain values alone", () => {
    assert.deepEqual(
      hits("const next = (list: readonly number[], n: number) => [...list, n];\n", SRC),
      [],
    );
  });

  void it("S18 and S19 are writer policy: the repo's own lint does not report them", () => {
    const src =
      'import { operation } from "@tinker/core";\nfunction f() { return operation({ label: "x", run: () => 1 }); }\n';
    assert.deepEqual(hits(src, SRC, false), []);
  });

  void it("S06 fires on a console call", () => {
    assert.deepEqual(hits('\nconsole.log("x");\n', SRC), [["S06", 2]]);
  });
});

void describe("hand-rolled rules: code that redoes what tinker gives", () => {
  const APP = "apps/tracker/src/wire.ts";
  const PKG = "packages/http/src/client.ts";
  const repo = (source, file = APP) => hits(source, file, false);

  void it("S20 fires on Math.random, crypto.randomUUID, and randomUUID from node:crypto", () => {
    const src = [
      'import { randomUUID } from "node:crypto";',
      "const a = Math.random();",
      "const b = crypto.randomUUID();",
      "const c = randomUUID();",
      'const port = tag({ label: "random", default: Math.random });',
    ].join("\n");
    const found = [
      ["S20", 2],
      ["S20", 3],
      ["S20", 4],
      ["S20", 5],
    ];
    assert.deepEqual(hits(src, APP), found);
    assert.deepEqual(repo(src), found);
  });

  void it("S20 leaves ctx.random, a local randomUUID, and core's own default alone", () => {
    const src = "const a = ctx.random.uuid();\nconst randomUUID = () => 'x';\nrandomUUID();\n";
    assert.deepEqual(hits(src, APP), []);
    assert.deepEqual(repo("const r = Math.random();\n", "packages/core/src/random.ts"), []);
  });

  void it("S21 fires on Date.now, performance.now, timers, and new Date() in a unit body", () => {
    const src = [
      'import { operation } from "@tinker/core";',
      "export const stamp = operation({",
      '  label: "stamp",',
      "  run: () => {",
      "    const a = Date.now();",
      "    const b = performance.now();",
      "    setTimeout(go, 5);",
      "    globalThis.setInterval(go, 5);",
      "    return [a, b, new Date()];",
      "  },",
      "});",
    ].join("\n");
    assert.deepEqual(hits(src, APP), [
      ["S21", 5],
      ["S21", 6],
      ["S21", 7],
      ["S21", 8],
      ["S21", 9],
    ]);
  });

  void it("S21 leaves raw time outside any unit alone in the writer gate too", () => {
    assert.deepEqual(hits("export function stamp() {\n  return Date.now();\n}\n", APP), []);
  });

  void it("S21 leaves ctx.clock and a formatted saved time in a unit body alone", () => {
    const src = [
      'import { resource } from "@tinker/core";',
      "export const stamp = resource({",
      '  label: "stamp",',
      "  factory: async (ctx) => {",
      "    await ctx.clock.sleep(10, ctx.signal);",
      "    return new Date(ctx.clock.currentTimeMillis()).toISOString();",
      "  },",
      "});",
    ].join("\n");
    assert.deepEqual(hits(src, APP), []);
  });

  void it("S21 counts only unit bodies in the repo lint: a driver's own timer is fine", () => {
    const src = [
      'import { extension, operation } from "@tinker/core";',
      "const kill = (child: Child) => setTimeout(() => child.kill(), 5);",
      "export const ticker = extension({",
      '  label: "ticker",',
      "  start: (scope, ctx, next) => { setInterval(tick, 10); return next(); },",
      "});",
      'export const stamp = operation({ label: "stamp", run: () => Date.now() });',
    ].join("\n");
    assert.deepEqual(repo(src), [
      ["S21", 5],
      ["S21", 7],
    ]);
  });

  void it("S22 fires on a run whose failure is dropped by then, catch, or a bare catch", () => {
    const src = [
      "check.run().then(undefined, () => undefined);",
      "load.run({ input: id }).catch(() => {});",
      "try {",
      "  await check.run();",
      "} catch {",
      "  enabled = false;",
      "}",
    ].join("\n");
    const found = [
      ["S22", 1],
      ["S22", 2],
      ["S22", 5],
    ];
    assert.deepEqual(hits(src, APP), found);
    assert.deepEqual(repo(src, PKG), found);
  });

  void it("S22 leaves settle, a handler that narrows, and a non-run promise alone", () => {
    const src = [
      "const r = await load.settle({ input: id });",
      "compile.run(files).then(ok, (e) => { if (isError(e, 'Bad')) show(e); else throw e; });",
      "reader.cancel().then(undefined, () => undefined);",
      "try {\n  await check.run();\n} catch (error) {\n  throw error;\n}",
    ].join("\n");
    assert.deepEqual(hits(src, APP), []);
  });

  void it("S23 fires on a hand-made onX backed by a listener set", () => {
    const src = [
      "const watchers = new Set<(s: string) => void>();",
      "export const wire = {",
      "  status: () => status,",
      "  onStatus: (listener) => {",
      "    watchers.add(listener);",
      "    return () => {",
      "      watchers.delete(listener);",
      "    };",
      "  },",
      "};",
    ].join("\n");
    assert.deepEqual(hits(src, APP), [["S23", 4]]);
    assert.deepEqual(repo(src), [["S23", 4]]);
    assert.deepEqual(repo(src, "packages/sync/src/index.ts"), []);
  });

  void it("S23 leaves the Sync.Transport pair and a plain event handler alone", () => {
    const src = [
      "const transport = {",
      "  send: (message) => emit(message),",
      "  onMessage: (listener) => {",
      "    arrivals.add(listener);",
      "    return () => arrivals.delete(listener);",
      "  },",
      "  onClose: (listener) => {",
      "    partings.add(listener);",
      "    return () => partings.delete(listener);",
      "  },",
      "  close: () => closeWire(),",
      "};",
      "const props = { onClick: (event) => seen.add(event.target) };",
    ].join("\n");
    assert.deepEqual(hits(src, APP), []);
  });

  void it("S24 fires on fetch and globalThis.fetch in app code", () => {
    const src = "await fetch(url);\nawait globalThis.fetch(url, { method: 'POST' });\n";
    const found = [
      ["S24", 1],
      ["S24", 2],
    ];
    assert.deepEqual(hits(src, APP), found);
    assert.deepEqual(repo(src, "examples/sync/client.ts"), found);
  });

  void it("S24 leaves packages/http's own fetch and a transport's EventSource alone", () => {
    assert.deepEqual(repo("await fetch(url);\n", PKG), []);
    assert.deepEqual(hits("const stream = new EventSource(url);\n", APP), []);
  });

  void it("S25 fires on useState and useReducer in a .tsx source file", () => {
    const src = "const [a] = useState(0);\nconst [b] = React.useReducer(step, 0);\n";
    assert.deepEqual(hits(src, "src/Page.tsx"), [
      ["S25", 1],
      ["S25", 2],
    ]);
  });

  void it("S25 leaves a DOM useRef alone and stays out of the repo lint", () => {
    assert.deepEqual(hits("const box = useRef<HTMLDivElement>(null);\n", "src/Page.tsx"), []);
    assert.deepEqual(hits("const [a] = useState(0);\n", "src/Page.tsx", false), []);
  });

  void it("each hand-rolled message ends with its fix line", () => {
    const [found] = inspectPlain("const a = Math.random();\n", APP);
    assert.match(found.message, /^raw randomness: .+\. Fix: `id: ctx\.random\.uuid\(\)`$/);
  });

  void it("hand-rolled rules skip test files", () => {
    assert.deepEqual(hits("const a = Math.random();\nawait fetch(url);\n", TEST), []);
  });
});

void describe("plain rules in every file", () => {
  void it("S12 fires on a ts-ignore or ts-expect-error comment", () => {
    const src = "// @ts-ignore\nconst a = 1;\n/* @ts-expect-error */\nconst b = 2;\n";
    assert.deepEqual(hits(src, "other/app.ts"), [
      ["S12", 1],
      ["S12", 3],
    ]);
  });

  void it("S13 fires on a lint disable comment", () => {
    const src = "// eslint-disable-next-line\nconst a = 1;\n// oxlint-disable-line\n";
    assert.deepEqual(hits(src, TEST), [
      ["S13", 1],
      ["S13", 3],
    ]);
  });

  void it("an unparsable file yields one parse row", () => {
    const rows = inspectPlain("const a = 1;\nfoo(;\n", SRC);
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["parse", 2]],
    );
  });
});

void describe("plain rules never fire on", () => {
  void it("console.log( inside a string in source", () => {
    assert.deepEqual(hits('const s = "console.log(";\n', SRC), []);
  });

  void it("ts-ignore text inside a string", () => {
    assert.deepEqual(hits('const s = "// @ts-ignore";\n', TEST), []);
  });

  void it("a rule word in the middle of a comment", () => {
    assert.deepEqual(hits("/** Never use @ts-ignore or eslint-disable here. */\n", SRC), []);
  });

  void it("a locator assert, waitForSelector, or expect.poll", () => {
    const src = [
      'await expect(locator).toHaveText("x");',
      'await page.waitForSelector("a");',
      "await expect.poll(() => 1).toBe(1);",
    ].join("\n");
    assert.deepEqual(hits(src, TEST), []);
  });

  void it("an import of the public entry src/index", () => {
    const src = 'import { a } from "../src/index";\nimport { b } from "../src/index.ts";\n';
    assert.deepEqual(hits(src, TEST), []);
  });

  void it("vi.fn() in a source file that is not a test", () => {
    assert.deepEqual(hits("vi.fn();\n", SRC), []);
  });

  void it("isError narrowing in an if, then a payload assert", () => {
    const src = 'if (isError(e, "X")) expect(e.payload.id).toBe(1);\n';
    assert.deepEqual(hits(src, TEST), []);
  });
});
