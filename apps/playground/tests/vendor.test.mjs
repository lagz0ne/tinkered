import { build } from "esbuild";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { copyModuleGraph } from "../scripts/copy-module-graph.mjs";

test("vendor output includes every file imported by the Core entry", async () => {
  const sourceDir = fileURLToPath(new URL("../../../packages/core/dist/", import.meta.url));
  const outputDir = fileURLToPath(new URL("../public/vendor/", import.meta.url));
  const { metafile } = await build({
    absWorkingDir: sourceDir,
    entryPoints: ["index.mjs"],
    bundle: true,
    packages: "external",
    format: "esm",
    write: false,
    metafile: true,
  });
  for (const file of Object.keys(metafile.inputs)) {
    const output = file === "index.mjs" ? "core.mjs" : file;
    expect(readFileSync(join(outputDir, output), "utf8")).toBe(
      readFileSync(join(sourceDir, file), "utf8"),
    );
  }
});

test("copies nested, re-exported, and dynamic imports without copying unused files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "playground-vendor-"));
  const sourceDir = join(directory, "source");
  const outputDir = join(directory, "vendor");
  const files = {
    "index.mjs": 'import "react"; export { value } from "./chunk.mjs";',
    "chunk.mjs": 'export const value = () => import("./nested/lazy.mjs");',
    "nested/lazy.mjs": 'import "../chunk.mjs"; export const answer = 42;',
  };
  try {
    mkdirSync(join(sourceDir, "nested"), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      writeFileSync(join(sourceDir, file), content);
    }
    writeFileSync(join(sourceDir, "unused.mjs"), "export const unused = true;");
    await copyModuleGraph(join(sourceDir, "index.mjs"), join(outputDir, "core.mjs"));
    expect(
      readdirSync(outputDir, { recursive: true }).sort((left, right) => left.localeCompare(right)),
    ).toEqual(["chunk.mjs", "core.mjs", "nested", "nested/lazy.mjs"]);
    for (const [file, content] of Object.entries(files)) {
      expect(readFileSync(join(outputDir, file === "index.mjs" ? "core.mjs" : file), "utf8")).toBe(
        content,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
