import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus/pack";
import { expect, test } from "vite-plus/test";
import { privateFields } from "./private-fields";

const core = fileURLToPath(new URL("..", import.meta.url));

const listed = JSON.parse(
  readFileSync(new URL("./private-fields.json", import.meta.url), "utf8"),
) as string[];

const imports = `import { createScope } from "@tinker/core";\n`;
/** Each test's own time limit: every test packs Core once. */
const BUILD_MS = 60_000;

/**
 * Pack Core with `extra` names added to the list, and the outside-read rule scanning a scratch
 * repo of `plants` (path → code). A plant named `plant.ts` at the top is one more Core entry.
 * Resolves to the build error, or `""` when the build passes.
 */
async function guard(plants: Record<string, string>, extra: string[], dts = false) {
  const root = mkdtempSync(join(tmpdir(), "core-guard-"));
  for (const [path, code] of Object.entries(plants)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), code);
  }
  const entry: Record<string, string> = { index: "src/index.ts", testing: "src/testing.ts" };
  if (plants["plant.ts"] !== undefined) entry.plant = join(root, "plant.ts");
  const plugins = [privateFields([...listed, ...extra], root)];
  const outDir = join(root, "dist");
  try {
    await build({ config: false, cwd: core, entry, outDir, dts, logLevel: "silent", plugins });
    return "";
  } catch (error) {
    return String(error);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  "the shipped list builds when nothing outside Core reads it",
  async () => {
    expect(await guard({}, [])).toBe("");
  },
  BUILD_MS,
);

test(
  "a read through a cast fails the build",
  async () => {
    const plant = `${imports}export const read = (createScope() as unknown as { layer: 1 }).layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G1: destructuring through a cast fails the build",
  async () => {
    const plant = `${imports}export const { pending } = createScope() as unknown as { pending: 1 };\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["pending"])).toContain(
      "pending: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G2: a template-literal key in a script fails the build",
  async () => {
    const plant = `${imports}export const read = createScope()[\`owned\`];\n`;
    expect(await guard({ "apps/demo/plant.mjs": plant }, ["owned"])).toContain(
      "owned: read without type checks in apps/demo/plant.mjs",
    );
  },
  BUILD_MS,
);

test(
  "G3: a read on a cast saved to a variable fails the build",
  async () => {
    const plant = `${imports}const raw = createScope() as unknown as Record<string, unknown>;
const view = raw;
export const read = view.nodes;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["nodes"])).toContain(
      "nodes: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G4: attributes passed through a variable fail the build",
  async () => {
    const plant = `export function plant(ms: number): object[] {
  const fields: Record<string, number> = { layer: ms };
  fields.nodes = ms;
  return [{ attributes: fields }, { attributes: fields }];
}\n`;
    const error = await guard({ "plant.ts": plant }, ["layer", "nodes"]);
    expect(error).toContain("layer: a user-visible attribute key");
    expect(error).toContain("nodes: a user-visible attribute key");
  },
  BUILD_MS,
);

test(
  "G5: a script that loads Core by a computed path fails the build",
  async () => {
    const plant = `const core = await import(process.env.CORE ?? "../packages/core/dist/index.mjs");
export const read = core.createScope().parent;\n`;
    expect(await guard({ "bench/plant.mjs": plant }, ["parent"])).toContain(
      "parent: read without type checks in bench/plant.mjs",
    );
  },
  BUILD_MS,
);

test(
  "G6: Reflect.get with a listed name fails the build",
  async () => {
    const plant = `${imports}export const read: unknown = Reflect.get(createScope(), "built");\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["built"])).toContain(
      "built: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "a listed name that is gone from the runtime fails the build",
  async () => {
    expect(await guard({}, ["zzGone"])).toContain("zzGone: not in the runtime any more");
  },
  BUILD_MS,
);

test(
  "a listed name in the public types fails the build",
  async () => {
    expect(await guard({}, ["label"], true)).toContain("label: in the public types");
  },
  BUILD_MS,
);
