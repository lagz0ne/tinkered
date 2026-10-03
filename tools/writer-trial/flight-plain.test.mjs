import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runPlain } from "./flight-plain.mjs";
import { flightGate } from "./gate.mjs";

await test("only absent trusted plain scripts are unavailable; missing writer files block", () => {
  const seed = mkdtempSync(join(tmpdir(), "flight-plain-"));
  const packagePath = join(seed, "package.json");
  try {
    writeFileSync(packagePath, JSON.stringify({ scripts: {} }));
    assert.equal(runPlain(seed, seed).plainUnavailable, true);
    writeFileSync(packagePath, JSON.stringify({ scripts: { "check:plain": "node check.mjs" } }));
    assert.equal(runPlain(seed, seed).plainUnavailable, true);
    writeFileSync(
      join(seed, "check.mjs"),
      'console.error("ENOENT Cannot find module MODULE_NOT_FOUND"); process.exitCode = 1;',
    );
    const result = runPlain(seed, seed);
    assert.equal(result.plainExit, 1);
    assert.equal(result.unscored, undefined);
    assert.equal(result.unavailable, undefined);
    assert.match(result.output, /ENOENT Cannot find module MODULE_NOT_FOUND/);
    assert.equal(flightGate({ scaffoldExit: 0, ...result }).status, "block");
    writeFileSync(join(seed, "check.mjs"), 'console.log("plain passed");');
    assert.equal(runPlain(seed, seed).plainExit, 0);
  } finally {
    rmSync(seed, { recursive: true, force: true });
  }
});
