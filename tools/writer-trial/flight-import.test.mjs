import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const http = "@tinker/start/server";
const core = join(repo, "packages/core/dist/index.mjs");

await test("feature HTTP advice loads without the server barrel's import loop", async () => {
  const root = mkdtempSync(join(tmpdir(), "flight-import-"));
  try {
    mkdirSync(join(root, "backend"));
    mkdirSync(join(root, "lib"));
    symlinkSync(join(repo, "apps/start-scaffold/node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(
      join(root, "lib/tinker.server.mjs"),
      `export { search } from "../backend/flights.mjs";
export { httpRequest } from ${JSON.stringify(http)};
`,
    );
    const load = async (path) => {
      writeFileSync(
        join(root, "backend/flights.mjs"),
        `import { operation } from ${JSON.stringify(core)};
import { httpRequest } from ${JSON.stringify(path)};
export const search = operation({
  label: "flight-search",
  depends: { request: httpRequest.controller },
  run: () => "ready",
});
`,
      );
      return spawnSync(process.execPath, [join(root, "lib/tinker.server.mjs")], {
        encoding: "utf8",
      });
    };
    const old = await load(join(root, "lib/tinker.server.mjs"));
    assert.notEqual(old.status, 0);
    assert.match(old.stderr, /undefined|before initialization/);
    for (const skill of ["tinker-seams", "tinker-feature", "tinker-forms"]) {
      const text = readFileSync(
        join(repo, `apps/start-scaffold/.agents/skills/${skill}/SKILL.md`),
        "utf8",
      );
      assert.ok(text.includes("@tinker/start/server"), skill);
      assert.doesNotMatch(text, /(?:httpRequest|Import it)[^\n]*tinker\.server/, skill);
    }
    const fixed = await load(http);
    assert.equal(fixed.status, 0, fixed.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
