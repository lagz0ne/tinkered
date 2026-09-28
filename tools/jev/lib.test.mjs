// The size check preflight runs before a file-level call (no network, no key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fitsOneCall, HERE, MAX_CALL_CHARS } from "./lib.mjs";

void test("code at the cap fits one call; one character more does not", () => {
  assert.equal(fitsOneCall("x".repeat(MAX_CALL_CHARS)), true);
  assert.equal(fitsOneCall("x".repeat(MAX_CALL_CHARS + 1)), false);
});

void test("core's index.ts is too big for one call; blueprint.ts fits", () => {
  const read = (path) => readFileSync(join(HERE, "../..", path), "utf8");
  assert.equal(fitsOneCall(read("packages/core/src/index.ts")), false);
  assert.equal(fitsOneCall(read("packages/blueprint/src/blueprint.ts")), true);
});
