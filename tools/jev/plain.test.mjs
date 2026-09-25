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

  void it("S06 fires on a console call", () => {
    assert.deepEqual(hits('\nconsole.log("x");\n', SRC), [["S06", 2]]);
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
