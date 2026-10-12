import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { releaseNotes, releaseProblems } from "./release-check.mjs";

const root = resolve(import.meta.dirname, "..");
const registry = "apps/start-scaffold/public/r";
const version = JSON.parse(readFileSync(join(root, "packages/start/package.json"), "utf8")).version;
const apps = ["apps/start-scaffold/starter.package.json", "apps/start-scaffold/app.package.json"];

/** A packed folder that matches this tree byte for byte, apart from JSON layout. */
function packedCopy() {
  const packed = mkdtempSync(join(tmpdir(), "release-check-"));
  mkdirSync(join(packed, registry), { recursive: true });
  cpSync(join(root, registry), join(packed, registry), { recursive: true });
  for (const file of apps) cpSync(join(root, file), join(packed, file));

  const app = join(packed, registry, "app.json");
  writeFileSync(app, JSON.stringify(JSON.parse(readFileSync(app, "utf8"))) + "\n");
  return packed;
}

await test("notes are the one UPGRADE.md section for the version", () => {
  const text = "# Notes\n\n## 0.8.0\n\nNew.\n\n## 0.7.0\n\nOld.\n";

  assert.equal(releaseNotes(text, "0.8.0"), "## 0.8.0\n\nNew.\n");
  assert.equal(releaseNotes(text, "0.7.0"), "## 0.7.0\n\nOld.\n");
  assert.equal(releaseNotes(text, "0.9.0"), null);
});

await test("this tree passes as its own version, whatever the JSON layout", () => {
  const packed = packedCopy();
  try {
    assert.deepEqual(releaseProblems(root, version, packed), []);
  } finally {
    rmSync(packed, { recursive: true });
  }
});

await test("a tag that does not match the tree names every stale file", () => {
  const packed = packedCopy();
  const app = join(packed, registry, "app.json");
  writeFileSync(app, readFileSync(app, "utf8").replaceAll(`v${version}`, "v9.9.9"));
  try {
    const problems = releaseProblems(root, "9.9.9", packed);

    assert.ok(problems.includes(`@tinker/core is ${version}, not 9.9.9`));
    assert.ok(problems.includes(`start tests @tinker/react ${version}, not 9.9.9`));
    assert.ok(problems.includes('UPGRADE.md has no "## 9.9.9" section'));
    assert.ok(problems.some((problem) => problem.startsWith(`${registry}/app.json differs`)));
  } finally {
    rmSync(packed, { recursive: true });
  }
});
