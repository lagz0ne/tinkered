import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Copy the entry and its local imports verbatim; bare imports stay with the iframe's import map. */
export async function copyModuleGraph(from, to) {
  const sourceDir = dirname(from);
  const outputDir = dirname(to);
  const { metafile } = await build({
    absWorkingDir: sourceDir,
    entryPoints: [from],
    bundle: true,
    packages: "external",
    format: "esm",
    write: false,
    metafile: true,
  });
  for (const file of Object.keys(metafile.inputs)) {
    const source = join(sourceDir, file);
    const output = source === from ? to : join(outputDir, file);
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(source, output);
  }
}
