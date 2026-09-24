// A helper unit carries `uses`: the lines of its own file that call it, so a judge sees what
// happens to the value it returns.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { units } from "./extract.mjs";

const unit = (src, name) => units(src, "src/a.ts").find((u) => u.name === name);

void describe("a helper's uses", () => {
  void it("lists each distinct line that calls the helper, in source order", () => {
    const src = [
      "function idText(id: unknown): string {",
      "  return String(id);",
      "}",
      'fail("NotFound", { id: idText(x) });',
      "const b = idText(y);",
      'fail("NotFound", { id: idText(x) });',
    ].join("\n");
    assert.deepEqual(unit(src, "idText").uses, [
      'fail("NotFound", { id: idText(x) });',
      "const b = idText(y);",
    ]);
  });

  void it("does not count a call inside the helper's own body", () => {
    const src = "function count(n: number): number {\n  return n > 0 ? count(n - 1) : 0;\n}\n";
    assert.equal(unit(src, "count").uses, undefined);
  });

  void it("gives a helper no one calls no uses at all", () => {
    assert.equal(unit("function lonely(): number {\n  return 1;\n}\n", "lonely").uses, undefined);
  });

  void it("keeps at most six lines", () => {
    const calls = Array.from({ length: 8 }, (_, i) => `const v${i} = one(${i});`);
    const src = ["function one(n: number): number {", "  return n;", "}", ...calls].join("\n");
    assert.equal(unit(src, "one").uses.length, 6);
  });
});

void describe("arrow helpers in a .ts file", () => {
  void it("reads a const arrow as a function unit with its uses", () => {
    const src = [
      'const readId = (v: unknown): string => (typeof v === "string" ? v : "");',
      "export const id = readId(input);",
    ].join("\n");
    const found = unit(src, "readId");
    assert.equal(found.kind, "function");
    assert.deepEqual(found.uses, ["export const id = readId(input);"]);
  });

  void it("reads a const function expression as a function unit", () => {
    assert.equal(
      unit("const twice = function (n: number) {\n  return n * 2;\n};\n", "twice").kind,
      "function",
    );
  });

  void it("keeps a unit builder call an operation, not a helper", () => {
    const src = 'const save = operation({ label: "save", run: () => 1 });\n';
    assert.deepEqual(
      units(src, "src/a.ts").map((u) => [u.name, u.kind]),
      [["save", "operation"]],
    );
  });

  void it("gives each arrow of one const its own unit", () => {
    const src = "const a = () => 1, b = () => 2;\n";
    assert.deepEqual(
      units(src, "src/a.ts").map((u) => [u.name, u.source]),
      [
        ["a", "a = () => 1"],
        ["b", "b = () => 2"],
      ],
    );
  });
});
