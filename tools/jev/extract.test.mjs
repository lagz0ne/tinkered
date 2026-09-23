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
