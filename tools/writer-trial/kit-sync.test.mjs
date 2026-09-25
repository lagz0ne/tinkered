// Every teacher reference app carries the one layout kit, byte for byte, and builds the
// baseline layout by default (tools/writer-trial/teacher/layout-kit/README.md).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const teacher = fileURLToPath(new URL("./teacher/", import.meta.url));
const kit = readFileSync(join(teacher, "layout-kit/layout.tsx"), "utf8");
const fixtures = readdirSync(teacher).filter((d) => d.endsWith("-fixture"));

void describe("the layout kit in every reference app", () => {
  for (const fixture of fixtures) {
    void it(`${fixture} holds the kit unchanged and builds the baseline layout`, () => {
      const src = join(teacher, fixture, "src");
      assert.equal(readFileSync(join(src, "layout.tsx"), "utf8"), kit);
      const choice = readFileSync(join(src, "layout-choice.ts"), "utf8");
      assert.match(choice, /LAYOUT_NAME: string = "baseline"/);
    });
  }

  void it("covers every reference app there is", () => {
    assert.ok(fixtures.length >= 7, `found ${fixtures.length} fixtures`);
    for (const f of fixtures) assert.ok(existsSync(join(teacher, f, "src")), f);
  });
});
