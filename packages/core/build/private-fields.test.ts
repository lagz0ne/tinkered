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
    const plant = `${imports}const view: { layer: number } = { layer: 1 };
export const read = view.layer;
export const text = "@ts-nocheck";
// @ts-expect-error
export const unrelated = 1;
export const { layer } = view;\n`;
    expect(await guard({ "packages/react/src/control.ts": plant }, ["layer"])).toBe("");
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
  "G7: attributes passed through a function parameter fail the build",
  async () => {
    const plant = `export function plant(fields: Record<string, number>): object {
  return { attributes: fields };
}
export const out = plant({ layer: 1, nodes: 2 });\n`;
    const error = await guard({ "plant.ts": plant }, ["layer", "nodes"]);
    expect(error).toContain("layer: a user-visible attribute key");
    expect(error).toContain("nodes: a user-visible attribute key");
  },
  BUILD_MS,
);

test(
  "G8: a read through an any parameter fails the build",
  async () => {
    const plant = `${imports}export const read = (value: any) => value.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G9: a read through an any variable fails the build",
  async () => {
    const plant = `${imports}const loose: any = createScope();\nexport const read = loose.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G10: a read on a call result typed any fails the build",
  async () => {
    const plant = `${imports}declare function loose(): any;\nexport const read = loose().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G11: a read on a @ts-expect-error line fails the build",
  async () => {
    const plant = `${imports}// @ts-expect-error\nexport const read = createScope().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G12: a member below @ts-expect-error fails the build",
  async () => {
    const plant = `${imports}export const read = createScope()
  // @ts-expect-error
  .layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G13: a destructured key below @ts-expect-error fails the build",
  async () => {
    const plant = `${imports}export const {
  // @ts-expect-error
  layer,
} = createScope();\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G14: destructuring an any parameter fails the build",
  async () => {
    const plant = `${imports}export const read = ({ layer }: any) => layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G15: destructuring an any variable fails the build",
  async () => {
    const plant = `${imports}export const { layer }: any = createScope();\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G16: a read below @ts-ignore fails the build",
  async () => {
    const plant = `${imports}export const read = createScope()
  // @ts-ignore
  .layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G17: a destructured key below @ts-ignore fails the build",
  async () => {
    const plant = `${imports}export const {
  // @ts-ignore
  layer,
} = createScope();\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G18: a member read in a @ts-nocheck file fails the build",
  async () => {
    const plant = `// @ts-nocheck\n${imports}export const read = createScope().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G19: destructuring in a @ts-nocheck file fails the build",
  async () => {
    const plant = `// @ts-nocheck\n${imports}export const { layer } = createScope();\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G20: a read of a variable declared below @ts-expect-error fails the build",
  async () => {
    const plant = `${imports}// @ts-expect-error\nconst view: { layer: number } = createScope();\nexport const read = view.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G21: a read of a variable typed by an alias of any fails the build",
  async () => {
    const plant = `${imports}type Loose = any;\nconst view: Loose = createScope();\nexport const read = view.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G22: a read through a rest parameter typed any[] fails the build",
  async () => {
    const plant = `${imports}export function plant(...xs: any[]) {\n  return xs[0].layer;\n}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G23: a read through a catch parameter typed any fails the build",
  async () => {
    const plant = `${imports}export function plant() {\n  try {\n    return 1;\n  } catch (e: any) {\n    return e.layer;\n  }\n}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G24: a read through a field typed any fails the build",
  async () => {
    const plant = `${imports}declare const view: { v: any };\nexport const read = view.v.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G25: a read through an alias of an any function fails the build",
  async () => {
    const plant = `${imports}declare function loose(): any;\nconst alias = loose;\nexport const read = alias().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G26: a read on an inline any-returning call fails the build",
  async () => {
    const plant = `${imports}export const read = ((): any => createScope())().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G27: a read on a callback parameter typed to return any fails the build",
  async () => {
    const plant = `${imports}export const plant = (cb: () => any) => cb().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G28: a read on a function's returned cast fails the build",
  async () => {
    const plant = `${imports}export function make() {\n  return createScope() as unknown as { layer: 1 };\n}\nexport const read = make().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G29: a read on a parameter whose default is a cast fails the build",
  async () => {
    const plant = `${imports}export function plant(view = createScope() as unknown as { layer: 1 }) {\n  return view.layer;\n}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G30: a read on an object method that returns any fails the build",
  async () => {
    const plant = `${imports}export const api = {\n  get(): any {\n    return createScope();\n  },\n};\nexport const read = api.get().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G31: attributes passed through new fail the build",
  async () => {
    const plant = `export class Box {\n  out: object;\n  constructor(fields: Record<string, number>) {\n    this.out = { attributes: fields };\n  }\n}\nexport const made = new Box({ layer: 1 });\n`;
    expect(await guard({ "plant.ts": plant }, ["layer"])).toContain(
      "layer: a user-visible attribute key",
    );
  },
  BUILD_MS,
);

test(
  "G32: attributes passed through .call fail the build",
  async () => {
    const plant = `export function plant(fields: Record<string, number>) {\n  return { attributes: fields };\n}\nexport const made = plant.call(null, { layer: 1 });\n`;
    expect(await guard({ "plant.ts": plant }, ["layer"])).toContain(
      "layer: a user-visible attribute key",
    );
  },
  BUILD_MS,
);

test(
  "G33: attributes passed through .apply fail the build",
  async () => {
    const plant = `export function plant(fields: Record<string, number>) {\n  return { attributes: fields };\n}\nexport const made = plant.apply(null, [{ nodes: 2 }]);\n`;
    expect(await guard({ "plant.ts": plant }, ["nodes"])).toContain(
      "nodes: a user-visible attribute key",
    );
  },
  BUILD_MS,
);

test(
  "G34: attributes passed through .bind fail the build",
  async () => {
    const plant = `export function plant(fields: Record<string, number>) {\n  return { attributes: fields };\n}\nexport const made = plant.bind(null, { pending: 3 });\n`;
    expect(await guard({ "plant.ts": plant }, ["pending"])).toContain(
      "pending: a user-visible attribute key",
    );
  },
  BUILD_MS,
);

test(
  "G35: attributes passed through a rest parameter fail the build",
  async () => {
    const plant = `export function plant(...fields: object[]) {\n  return { attributes: fields };\n}\nexport const made = plant({ layer: 1 });\n`;
    expect(await guard({ "plant.ts": plant }, ["layer"])).toContain(
      "layer: a user-visible attribute key",
    );
  },
  BUILD_MS,
);

test(
  "G36: attributes passed through a destructured parameter fail the build",
  async () => {
    const plant = `export function plant({ fields }: { fields: Record<string, number> }) {\n  return { attributes: fields };\n}\nexport const made = plant({ fields: { layer: 1 } });\n`;
    expect(await guard({ "plant.ts": plant }, ["layer"])).toContain(
      "layer: a user-visible attribute key",
    );
  },
  BUILD_MS,
);

test(
  "G37: a read on a function imported from another file, typed to return any, fails the build",
  async () => {
    const plants = {
      "packages/react/src/loose.ts": `export function loose(): any {\n  return 1;\n}\n`,
      "packages/react/src/plant.ts": `${imports}import { loose } from "./loose";\nexport const read = loose().layer;\n`,
    };
    expect(await guard(plants, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G38: a read of a variable assigned below @ts-expect-error fails the build",
  async () => {
    const plant = `${imports}declare let view: { layer: number };\n// @ts-expect-error\nview = createScope();\nexport const read = view.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G39: as const cannot hide a cast inside an array",
  async () => {
    const plant = `${imports}const box = [createScope() as any] as const;
export const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G40: a read through a cast inside a plain object fails the build",
  async () => {
    const plant = `${imports}export const read = { s: createScope() as any }.s.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G41: a read through a cast inside a plain array fails the build",
  async () => {
    const plant = `${imports}const box = [createScope() as any];
export const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G42: a read through nested spread literals holding a cast fails the build",
  async () => {
    const plant = `${imports}const box = { ...{ rows: [, ...[createScope() as any]] } };
export const read = box.rows[1].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G43: an imported function returning a local any alias fails the build",
  async () => {
    const plants = {
      "packages/react/src/loose.ts": `type Loose = any;
export function loose(): Loose { return 1; }\n`,
      "packages/react/src/plant.ts": `${imports}import { loose } from "./loose";
export const read = loose().layer;\n`,
    };
    expect(await guard(plants, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G44: a class method inside a callback returning a cast fails the build",
  async () => {
    const plant = `${imports}[1].map(() => {
  class Box {
    get() { return createScope() as any; }
  }
  return new Box().get().layer;
});\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "plain object and array literals with checked values stay unflagged",
  async () => {
    const plant = `${imports}const box = { ...{ rows: [, ...[{ layer: 1 }]] } };
export const read = box.rows[1].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a directive covers only the line under it",
  async () => {
    const plant = `${imports}// @ts-expect-error\nconst unrelated = 1;\nconst view: { layer: number } = { layer: 1 };\nexport const read = view.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a return inside a callback does not make its enclosing function a cast",
  async () => {
    const plant = `${imports}export function make() {\n  [1].map(() => {\n    return createScope() as unknown as number;\n  });\n  return 1;\n}\nexport const read = make().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "an as-const literal returned by a function stays unflagged",
  async () => {
    const plant = `${imports}export const make = () => ({ layer: 1 }) as const;\nexport const read = make().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a typed callback and a typed field stay unflagged",
  async () => {
    const plant = `${imports}export const plant = (cb: () => string, box: { layer: string }) => cb() + box.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
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
