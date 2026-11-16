import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { build } from "vite-plus";

const repo = resolve(import.meta.dirname, "../../..");
const entry = join(repo, "packages/entry");

/** A page app that has `@tinkered/entry` installed, as an app gets it from npm. */
function app(main) {
  const dir = mkdtempSync(join(tmpdir(), "entry-page-"));

  mkdirSync(join(dir, "node_modules/@tinkered"), { recursive: true });
  symlinkSync(entry, join(dir, "node_modules/@tinkered/entry"));
  symlinkSync(join(repo, "packages/core"), join(dir, "node_modules/@tinkered/core"));

  writeFileSync(join(dir, "index.html"), '<script type="module" src="./main.ts"></script>\n');
  writeFileSync(join(dir, "main.ts"), main);

  return dir;
}

/** Build the page; answer the build error text, or undefined when it builds. */
async function buildPage(dir) {
  try {
    await build({ root: dir, logLevel: "silent", build: { outDir: "out" } });
    return undefined;
  } catch (error) {
    return String(error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test("a page build that names a backend export fails at that name", async () => {
  const dir = app('import { routes } from "@tinkered/entry/server";\nconsole.log(routes);\n');

  const error = await buildPage(dir);

  assert.match(error, /"routes" is not exported by .*not-in-page\.mjs/);
});

void test("a page build that takes only types from a backend entry builds", async () => {
  const dir = app(
    'import type { Routes } from "@tinkered/entry/server";\n' +
      "const none: Routes | undefined = undefined;\nconsole.log(none);\n",
  );

  const error = await buildPage(dir);

  assert.equal(error, undefined);
});

void test("a program on Node still resolves the command entry", () => {
  const dir = app("");

  const path = createRequire(join(dir, "main.mjs")).resolve("@tinkered/entry/cmd");
  rmSync(dir, { recursive: true, force: true });

  assert.equal(path, join(entry, "dist/cmd.mjs"));
});
