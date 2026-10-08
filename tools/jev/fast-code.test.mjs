import { test } from "node:test";
import assert from "node:assert/strict";
import { lintQuestions, slice } from "./bank.mjs";

const fast = [
  "madeEveryCall",
  "awaitsSyncWork",
  "waitsOnSideWork",
  "recomputesSameValue",
  "shapeGrowsPerCall",
];

void test("preflight's lint includes fast-code judges on short helpers and roots", () => {
  const source =
    "function encoder() { return new TextEncoder(); } function root() { return createScope(); }";
  for (const unit of slice(source, "apps/demo/src/run.ts")) {
    assert.deepEqual(Object.keys(lintQuestions(unit)).sort(), [...fast].sort());
    assert.ok("unit" in lintQuestions(unit, true));
  }
});

void test("fast-code judges read library helpers and unit builders while existing scope stays intact", () => {
  const source =
    'import { operation } from "@tinker/core"; export function make(input) { return operation({ run: () => input }); }';
  const unit = slice(source, "packages/demo/src/run.ts").find((u) => u.name === "make");
  const questions = lintQuestions(unit);
  for (const id of fast) assert.ok(id in questions);
  assert.ok(!("domainLogicInRender" in questions));
  assert.ok(!("effectWithoutDefer" in questions));
});

void test("class constructors and methods reach fast-code judges without app judges", () => {
  const source = "export class Frame { declare closed: boolean; close() { this.closed = true; } }";
  const units = slice(source, "packages/demo/src/frame.ts");
  const frame = units.find((unit) => unit.name === "Frame");
  assert.equal(frame.source, source.slice("export ".length));
  for (const all of [false, true])
    assert.deepEqual(Object.keys(lintQuestions(frame, all)).sort(), [...fast].sort());
});
