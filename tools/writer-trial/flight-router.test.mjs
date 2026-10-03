import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resetRouter, routerHash } from "./flight-router.mjs";

await test("requires a fresh regular router file after clearing the archive", () => {
  const root = mkdtempSync(join(tmpdir(), "flight-router-"));
  const path = join(root, "routeTree.gen.ts");
  try {
    writeFileSync(path, "archived router");
    resetRouter(path);
    assert.throws(() => routerHash(path), /ENOENT/);
    mkdirSync(path);
    assert.throws(() => routerHash(path), /must be a file/);
    resetRouter(path);
    const target = join(root, "target.ts");
    writeFileSync(target, "fresh router");
    symlinkSync(target, path);
    assert.throws(() => routerHash(path), /must be a file/);
    resetRouter(path);
    writeFileSync(path, "fresh router");
    assert.match(routerHash(path), /^[a-f0-9]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
