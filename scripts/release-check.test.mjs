import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { releaseNotes, releaseProblems } from "./release-check.mjs";

const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8")).version;

await test("notes are the one CHANGELOG.md section for the version", () => {
  const text = "# Changelog\n\n## 0.8.0\n\nNew.\n\n## 0.7.0\n\nOld.\n";

  assert.equal(releaseNotes(text, "0.8.0"), "## 0.8.0\n\nNew.\n");
  assert.equal(releaseNotes(text, "0.7.0"), "## 0.7.0\n\nOld.\n");
  assert.equal(releaseNotes(text, "0.9.0"), null);
});

await test("this tree passes as its own version", () => {
  assert.deepEqual(releaseProblems(root, version), []);
});

await test("a tag that does not match the tree names every problem", () => {
  assert.deepEqual(releaseProblems(root, "9.9.9"), [
    `@tinkered/core is ${version}, not 9.9.9`,
    `@tinkered/react is ${version}, not 9.9.9`,
    `@tinkered/bun is ${version}, not 9.9.9`,
    `@tinkered/analyze is ${version}, not 9.9.9`,
    'CHANGELOG.md has no "## 9.9.9" section',
  ]);
});
