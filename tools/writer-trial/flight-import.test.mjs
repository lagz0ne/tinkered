import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite-plus";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const http = join(repo, "apps/start-scaffold/src/scaffold/backend/http.ts");
const core = join(repo, "packages/core/dist/index.mjs");

await test("feature HTTP advice loads without the server barrel's import loop", async () => {
  const root = mkdtempSync(join(tmpdir(), "flight-import-"));
  try {
    mkdirSync(join(root, "backend"));
    mkdirSync(join(root, "lib"));
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
      const bundle = await build({
        configFile: false,
        logLevel: "silent",
        build: {
          write: false,
          minify: false,
          lib: { entry: join(root, "lib/tinker.server.mjs"), formats: ["es"] },
        },
      });
      const output = Array.isArray(bundle) ? bundle[0].output : bundle.output;
      const chunk = output.find((file) => file.type === "chunk" && file.isEntry);
      assert.ok(chunk);
      const entry = join(root, "entry.mjs");
      writeFileSync(entry, chunk.code);
      return spawnSync(process.execPath, [entry], { encoding: "utf8" });
    };
    const old = await load(join(root, "lib/tinker.server.mjs"));
    assert.notEqual(old.status, 0);
    assert.match(old.stderr, /undefined|before initialization/);
    for (const skill of ["tinker-seams", "tinker-feature", "tinker-forms"]) {
      const text = readFileSync(
        join(repo, `apps/start-scaffold/.agents/skills/${skill}/SKILL.md`),
        "utf8",
      );
      assert.ok(text.includes("@/scaffold/backend/http"), skill);
      assert.doesNotMatch(text, /(?:httpRequest|Import it)[^\n]*tinker\.server/, skill);
    }
    const fixed = await load(resolve(http));
    assert.equal(fixed.status, 0, fixed.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
