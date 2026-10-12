import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const recursiveUnion = Array.from(
  { length: 20 },
  (_, index) => `{ member: ${index}; a: U; layer: number }`,
).join(" | ");

const recursiveSource = `${imports}type U = ${recursiveUnion};
declare const u: U;
declare const s: U[];
let layer: number;\n`;

/** Four thenables that each settle to a union of all four: the settle walk's worst case at this size. */
const thenableSource = `${imports}type U = T0 | T1 | T2 | T3;
${[0, 1, 2, 3].map((index) => `interface T${index} { then(cb: (value: U) => void): void }`).join("\n")}
declare const ps: U[];
let layer: number;\n`;

const childBuild = `
  import { build } from ${JSON.stringify(import.meta.resolve("vite-plus/pack"))};
  import { privateFields } from ${JSON.stringify(pathToFileURL(join(core, "build/private-fields.ts")).href)};
  const root = process.argv[1];
  try {
    await build({ config: false, cwd: ${JSON.stringify(core)}, entry: { index: "src/index.ts", testing: "src/testing.ts" },
      outDir: root + "/dist", dts: false, logLevel: "silent",
      plugins: [privateFields(${JSON.stringify([...listed, "layer"])}, root)] });
  } catch (error) { process.stdout.write(String(error)); }
`;

/** A typed Promise nested `depth` layers around `inner`. */
const promiseLayers = (inner: string, depth: number) =>
  `${"Promise<".repeat(depth)}${inner}${">".repeat(depth)}`;

/** Thenables W1 to W`depth`: each settles to the one before, and W1 settles to `inner`. */
const thenableChain = (inner: string, depth: number) =>
  Array.from({ length: depth }, (_, index) => {
    const value = index === 0 ? inner : `W${index}`;
    return `interface W${index + 1} { then(cb: (value: ${value}) => void): void }`;
  }).join("\n");

/** A child deadline can stop a synchronous checker walk that blocks the test worker's timer. */
function guardInChild(plant: string, deadline = 10_000): string {
  const root = mkdtempSync(join(tmpdir(), "core-recursive-guard-"));
  const file = join(root, "packages/react/src/plant.ts");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, plant);
  try {
    return execFileSync(process.execPath, ["--input-type=module", "--eval", childBuild, root], {
      encoding: "utf8",
      timeout: deadline,
      killSignal: "SIGKILL",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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
  "G45: as const cannot hide a conditional cast in an array",
  async () => {
    const plant = `${imports}declare const c: boolean;
const box = [c ? (createScope() as any) : 1] as const;
export const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G46: as const cannot hide a conditional cast in an object",
  async () => {
    const plant = `${imports}declare const c: boolean;
const box = { s: c ? (createScope() as any) : 1 } as const;
export const read = box.s.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G47: as const cannot hide a cast behind nullish coalescing",
  async () => {
    const plant = `${imports}const box = [(createScope() as any) ?? 1] as const;
export const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G48: as const cannot hide a cast behind logical AND",
  async () => {
    const plant = `${imports}declare const c: boolean;
const box = [c && (createScope() as any)] as const;
export const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G49: as const cannot hide a cast behind logical OR",
  async () => {
    const plant = `${imports}declare const c: boolean;
const box = [c || (createScope() as any)] as const;
export const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G50: as const cannot hide a cast behind the comma operator",
  async () => {
    const plant = `${imports}const box = [(0, createScope() as any)] as const;
export const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G51: as const cannot hide a cast in a called inline function",
  async () => {
    const plant = `${imports}const box = [(() => createScope() as any)()] as const;
export const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G52: an imported type alias of any fails the build",
  async () => {
    const plants = {
      "packages/react/src/types.ts": `export type Loose = any;\n`,
      "packages/react/src/plant.ts": `${imports}import type { Loose } from "./types";\nconst view: Loose = createScope();\nexport const read = view.layer;\n`,
    };
    expect(await guard(plants, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G53: an imported function returning an imported alias of any fails the build",
  async () => {
    const plants = {
      "packages/react/src/types.ts": `export type Loose = any;\n`,
      "packages/react/src/loose.ts": `import type { Loose } from "./types";\nexport function loose(): Loose {\n  return 1;\n}\n`,
      "packages/react/src/plant.ts": `${imports}import { loose } from "./loose";\nexport const read = loose().layer;\n`,
    };
    expect(await guard(plants, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G54: an imported value typed any fails the build",
  async () => {
    const plants = {
      "packages/react/src/loose.ts": `export const loose: any = 1;\n`,
      "packages/react/src/plant.ts": `${imports}import { loose } from "./loose";\nexport const read = loose.layer;\n`,
    };
    expect(await guard(plants, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G55: a namespace import of a function returning any fails the build",
  async () => {
    const plants = {
      "packages/react/src/loose.ts": `export function loose(): any {\n  return 1;\n}\n`,
      "packages/react/src/plant.ts": `${imports}import * as m from "./loose";\nexport const read = m.loose().layer;\n`,
    };
    expect(await guard(plants, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G56: a default import typed any fails the build",
  async () => {
    const plants = {
      "packages/react/src/loose.ts": `const loose: any = 1;\nexport default loose;\n`,
      "packages/react/src/plant.ts": `${imports}import loose from "./loose";\nexport const read = loose.layer;\n`,
    };
    expect(await guard(plants, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G57: a directive on an argument line hides the parameter's type fails the build",
  async () => {
    const plant = `${imports}export function take(view: { layer: number }) {\n  return view.layer;\n}\nexport const out = take(\n  // @ts-expect-error\n  createScope(),\n);\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G58: a directive on a return line hides the return type fails the build",
  async () => {
    const plant = `${imports}export function make(): { layer: number } {\n  // @ts-expect-error\n  return createScope();\n}\nexport const read = make().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G59: a read on an awaited Promise of any fails the build",
  async () => {
    const plant = `${imports}declare function loose(): Promise<any>;\nexport async function read() {\n  return (await loose()).layer;\n}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G60: a read through an index signature typed any fails the build",
  async () => {
    const plant = `${imports}declare const bag: { [k: string]: any };\nexport const read = bag.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G61: a read through any | undefined fails the build",
  async () => {
    const plant = `${imports}declare const maybe: any | undefined;\nexport const read = maybe.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G62: a call on a value typed Function fails the build",
  async () => {
    const plant = `${imports}declare const run: Function;\nexport const read = run().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G63: attributes passed through super(g) fail the build",
  async () => {
    const plant = `export class Base {\n  out: object;\n  constructor(fields: Record<string, number>) {\n    this.out = { attributes: fields };\n  }\n}\nexport class Sub extends Base {\n  constructor(g: Record<string, number>) {\n    super(g);\n  }\n}\nexport const made = new Sub({ layer: 1 });\n`;
    expect(await guard({ "plant.ts": plant }, ["layer"])).toContain(
      "layer: a user-visible attribute key",
    );
  },
  BUILD_MS,
);

test(
  "G64: attributes passed through o.plant.call(...) fail the build",
  async () => {
    const plant = `export const o = {\n  plant(fields: Record<string, number>): object {\n    return { attributes: fields };\n  },\n};\nexport const made = o.plant.call(null, { layer: 1 });\n`;
    expect(await guard({ "plant.ts": plant }, ["layer"])).toContain(
      "layer: a user-visible attribute key",
    );
  },
  BUILD_MS,
);

test(
  "G65: a variable from a conditional cast to any fails the build",
  async () => {
    const plant = `${imports}declare const c: boolean;\ndeclare const s: unknown;\nconst x = c ? (s as any) : 1;\nexport const read = x.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G66: an array holding a conditional cast to any, with no as const, fails the build",
  async () => {
    const plant = `${imports}declare const c: boolean;\ndeclare const s: unknown;\nconst box = [c ? (s as any) : 1];\nexport const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G67: an array holding an IIFE that returns a cast fails the build",
  async () => {
    const plant = `${imports}const box = [(() => createScope() as unknown as { layer: 1 })()];\nexport const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G68: a getter that returns a cast fails the build",
  async () => {
    const plant = `${imports}export class Box {\n  get layer() {\n    return createScope() as unknown as { pending: 1 };\n  }\n}\nexport const read = new Box().layer.pending;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["pending"])).toContain(
      "pending: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G69: a getter typed any fails the build",
  async () => {
    const plant = `${imports}export class Box {\n  get layer(): any {\n    return createScope();\n  }\n}\nexport const read = new Box().layer.pending;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["pending"])).toContain(
      "pending: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G70: destructuring a key of an index signature typed any fails the build",
  async () => {
    const plant = `${imports}declare const bag: { [k: string]: any };\nexport const { layer } = bag;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G71: a directive on a declaration's value line hides the declared type and fails the build",
  async () => {
    const plant = `${imports}export const view: { layer: number } =\n  // @ts-expect-error\n  createScope();\nexport const read = view.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "a typed index signature stays unflagged",
  async () => {
    const plant = `${imports}declare const dict: { [k: string]: string };\nexport const read = dict.layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "an argument with no directive and a checked value stays unflagged",
  async () => {
    const plant = `${imports}export function take(view: { layer: number }) {\n  return view.layer;\n}\nexport const out = take({ layer: 1 });\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a return with no directive and a checked value stays unflagged",
  async () => {
    const plant = `${imports}export function make(): { layer: number } {\n  return { layer: 1 };\n}\nexport const read = make().layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "an as-const array with a checked object stays unflagged",
  async () => {
    const plant = `${imports}const box = [{ layer: 1 }] as const;
export const read = box[0].layer;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
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

test(
  "R1: nested array assignment from any fails the build",
  async () => {
    const plant = `${imports}declare const o: any[];
let layer;
[{ layer }] = o;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "R2: nested object assignment from any fails the build",
  async () => {
    const plant = `${imports}declare const o: any;
let layer;
({ a: { layer } } = o);\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "R3: a for-of assignment from any fails the build",
  async () => {
    const plant = `${imports}declare const anys: any[];
let layer;
for ({ layer } of anys) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "a direct object assignment from any still fails the build",
  async () => {
    const plant = `${imports}declare const o: any;
let layer;
({ layer } = o);\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "R4: a nested assignment reads the source property type",
  async () => {
    const plant = `${imports}declare const o: { a: any };
let layer: number;
({ a: { layer } } = o);\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "R5: an array assignment reads each source element type",
  async () => {
    const plant = `${imports}declare const o: [any];
let layer: number;
[{ layer }] = o;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "a checked nested assignment stays unflagged despite an any sibling",
  async () => {
    const plant = `${imports}declare const o: { a: { layer: number }; loose: any };
let layer;
({ a: { layer } } = o);\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "R6: a for-of assignment reads every possible tuple element",
  async () => {
    const plant = `${imports}declare const anys: [{ layer: number }, any];
let layer: number;
for ({ layer } of anys) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "a missing checker binary leaves no scratch folder after the build fails",
  () => {
    const root = mkdtempSync(join(tmpdir(), "core-guard-"));
    const fixtureCore = join(root, "packages/core");
    const modules = join(fixtureCore, "node_modules");
    mkdirSync(modules, { recursive: true });
    mkdirSync(join(fixtureCore, "build"));
    mkdirSync(join(root, "apps"));

    try {
      cpSync(join(core, "build/private-fields.ts"), join(fixtureCore, "build/private-fields.ts"));
      cpSync(
        join(core, "build/private-fields.json"),
        join(fixtureCore, "build/private-fields.json"),
      );
      cpSync(join(core, "node_modules/typescript"), join(modules, "typescript"), {
        recursive: true,
        dereference: true,
      });
      symlinkSync(
        dirname(fileURLToPath(import.meta.resolve("vite-plus/package.json"))),
        join(modules, "vite-plus"),
      );
      writeFileSync(
        join(root, "apps/plant.ts"),
        `${imports}declare const o: any; export const read = o.layer;`,
      );

      const script = `
        import { build } from ${JSON.stringify(import.meta.resolve("vite-plus/pack"))};
        import { privateFields } from ${JSON.stringify(pathToFileURL(join(fixtureCore, "build/private-fields.ts")).href)};
        try {
          await build({ config: false, cwd: ${JSON.stringify(core)}, entry: "src/index.ts",
            outDir: ${JSON.stringify(join(root, "dist"))}, dts: false, logLevel: "silent",
            plugins: [privateFields(${JSON.stringify([...listed, "layer"])}, ${JSON.stringify(root)})] });
          throw new Error("the build accepted a missing checker");
        } catch (error) {
          if (!String(error).includes("Unable to resolve @typescript/")) throw error;
        }
      `;
      execFileSync(process.execPath, ["--input-type=module", "--eval", script], { stdio: "pipe" });

      expect(readdirSync(modules).filter((name) => name.startsWith("core-guard-"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  BUILD_MS,
);

test(
  "R7: a spread array assignment from any fails the build",
  async () => {
    const plant = `${imports}declare const o: any;
let layer;
[...[{ layer }]] = o;\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G72: a for-of assignment from a Set of any fails the build",
  async () => {
    const plant = `${imports}declare const s: Set<any>;
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G73: a for-of assignment reading a Map entry of any fails the build",
  async () => {
    const plant = `${imports}declare const m: Map<string, any>;
let layer;
for ([, { layer }] of m) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G74: a for-of assignment from a function returning Iterable of any fails the build",
  async () => {
    const plant = `${imports}declare function gen(): Iterable<any>;
let layer;
for ({ layer } of gen()) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G75: a for-await assignment from an AsyncIterable of any fails the build",
  async () => {
    const plant = `${imports}declare const it: AsyncIterable<any>;
let layer;
for await ({ layer } of it) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G76: a for-await assignment settles a Promise element of any and fails the build",
  async () => {
    const plant = `${imports}declare const ps: Set<Promise<any>>;
let layer;
for await ({ layer } of ps) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G77: a for-of assignment through a hand-written iterator of any fails the build",
  async () => {
    const plant = `${imports}declare const ui: {
  [Symbol.iterator](): { next(): { done: boolean; value: any } };
};
let layer;
for ({ layer } of ui) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G78: a for-of assignment from an iterable whose [Symbol.iterator]() is any fails the build",
  async () => {
    const plant = `${imports}declare const s: { [Symbol.iterator](): any };
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G79: a for-of assignment from an iterator whose next() is any fails the build",
  async () => {
    const plant = `${imports}declare const s: { [Symbol.iterator](): { next(): any } };
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G80: a for-await assignment settles a PromiseLike element of any and fails the build",
  async () => {
    const plant = `${imports}declare const ps: PromiseLike<any>[];
let layer;
for await ({ layer } of ps) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G81: a for-of assignment reads every next() overload, so an any overload fails the build",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](): {
    next(): { done: false; value: { layer: number } };
    next(x: number): { done: boolean; value: any };
  };
};
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G82: a for-of assignment reads the global Symbol.iterator, not a user symbol named iterator",
  async () => {
    const plant = `${imports}declare const iterator: unique symbol;
declare const s: {
  [iterator](): { next(): { done: false; value: { layer: number } } };
  [Symbol.iterator](): { next(): { done: false; value: any } };
};
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G83: a for-await assignment settles each member of a union, so a PromiseLike of any fails the build",
  async () => {
    const plant = `${imports}declare const ps: (PromiseLike<any> | number)[];
let layer;
for await ({ layer } of ps) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G84: a for-await assignment from a circular thenable that never settles fails the build",
  async () => {
    const plant = `${imports}interface Self { then(cb: (value: Self) => void): void }
declare const ss: Self[];
let layer;
for await ({ layer } of ss) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G85: a nested for-of assignment reads a later next overload's any property",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](): {
    next(): { value: { a: { layer: number } } };
    next(x: number): { value: { a: any } };
  };
};
let layer: number;
for ({ a: { layer } } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G86: a nested for-of assignment reads every yielded member's any property",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](): {
    next(): { done: false; value: { a: { layer: number } } }
      | { done: boolean; value: { a: any } };
  };
};
let layer: number;
for ({ a: { layer } } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G87: a for-await assignment settles a union inside a promise value",
  async () => {
    const plant = `${imports}declare const ps: Promise<{ layer: number } | PromiseLike<any>>[];
let layer: number;
for await ({ layer } of ps) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G88: a for-of assignment through four recursive union properties builds within the deadline",
  () => {
    const plant = `${recursiveSource}for ({ a: { a: { a: { a: { layer } } } } } of s) {}\n`;
    expect(guardInChild(plant)).toBe("");
  },
  BUILD_MS,
);

test(
  "G89: an assignment through four recursive union properties builds within the deadline",
  () => {
    const plant = `${recursiveSource}({ a: { a: { a: { a: { layer } } } } } = u);\n`;
    expect(guardInChild(plant)).toBe("");
  },
  BUILD_MS,
);

test(
  "G90: a for-await loop over four thenables that settle to each other builds within five seconds",
  () => {
    const plant = `${thenableSource}for await (const x of ps) {}\n`;
    expect(guardInChild(plant, 5_000)).toBe("");
  },
  BUILD_MS,
);

test(
  "G91: a for-await assignment over four thenables that settle to each other fails within five seconds",
  () => {
    const plant = `${thenableSource}for await ({ layer } of ps) {}\n`;
    expect(guardInChild(plant, 5_000)).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G92: a for-of assignment from a next() result that cannot yield fails the build",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](): { next(): { done?: true; value: any } };
};
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G93: an optional argument does not stop a no-argument call from picking an any iterator",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](x?: number): { next(): { done: false; value: any } };
  [Symbol.iterator](): { next(): { done: false; value: { layer: number } } };
};
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G94: a for-await assignment whose every next() overload yields any fails the build",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.asyncIterator](): {
    next(): Promise<{ done: false; value: any }>;
    next(x: number): Promise<{ done: false; value: any }>;
  };
};
let layer;
for await ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G95: a for-await assignment settles a Promise of any nine layers deep and fails the build",
  async () => {
    const plant = `${imports}declare const ps: ${promiseLayers("any", 9)}[];
let layer;
for await ({ layer } of ps) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G96: a for-await assignment settles a thenable chain of any nine layers deep and fails the build",
  async () => {
    const plant = `${imports}${thenableChain("any", 9)}
declare const ws: W9[];
let layer;
for await ({ layer } of ws) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G97: a for-await assignment from a thenable that settles to itself or to any fails the build",
  async () => {
    const plant = `${imports}interface S { then(cb: (value: S | any) => void): void }
declare const ss: S[];
let layer;
for await ({ layer } of ss) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G98: a for-of assignment whose done: true next() overload is any fails the build",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](): {
    next(): { done: false; value: { layer: number } };
    next(x: number): { done: true; value: any };
  };
};
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "a for-of assignment from a typed Set stays unflagged",
  async () => {
    const plant = `${imports}declare const s: Set<{ layer: number }>;
let layer: number;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-of assignment reading a typed Map entry stays unflagged despite an any key",
  async () => {
    const plant = `${imports}declare const m: Map<any, { layer: number }>;
let layer: number;
for ([, { layer }] of m) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-of assignment from a typed generator stays unflagged despite an any return",
  async () => {
    const plant = `${imports}declare function gen(): Generator<{ layer: number }, any>;
let layer: number;
for ({ layer } of gen()) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-await assignment from a typed AsyncIterable stays unflagged",
  async () => {
    const plant = `${imports}declare const it: AsyncIterable<{ layer: number }>;
let layer: number;
for await ({ layer } of it) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-of assignment ignores the any value of a done: true result, as the declaration form does",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](): {
    next(): { done: false; value: { layer: number } } | { done: true; value: any };
  };
};
let layer: number;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-of assignment reads the [Symbol.iterator]() overload a call with no arguments picks, so a later any overload stays unflagged",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](): { next(): { done: false; value: { layer: number } } };
  [Symbol.iterator](x: number): { next(): { done: false; value: any } };
};
let layer: number;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-of assignment skips a [Symbol.iterator]() overload that needs an argument, as the declaration form does",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](x: number): { next(): { done: false; value: any } };
  [Symbol.iterator](): { next(): { done: false; value: { layer: number } } };
};
let layer: number;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "Z4: async result overloads keep a known false flag rather than dropping any",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.asyncIterator](): {
    next(): Promise<{ done: false; value: { layer: number } }>;
    next(x: number): Promise<{ done: boolean; value: any }>;
  };
};
let layer: number;
for await ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "Z18: nested async result overloads keep a known false flag rather than dropping any",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.asyncIterator](): {
    next(): Promise<{ done: false; value: { a: any } }>;
    next(x: number): Promise<{ done: false; value: { a: { layer: number } } }>;
  };
};
let layer: number;
for await ({ a: { layer } } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "a for-of assignment ignores the any value of a done?: true result, as the declaration form does",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](): {
    next(): { done: false; value: { layer: number } } | { done?: true; value: any };
  };
};
let layer: number;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-await assignment settles a typed Promise nine layers deep and stays unflagged",
  async () => {
    const plant = `${imports}declare const ps: ${promiseLayers("{ layer: number }", 9)}[];
let layer: number;
for await ({ layer } of ps) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-await assignment settles a thenable chain nine layers deep and stays unflagged",
  async () => {
    const plant = `${imports}${thenableChain("{ layer: number }", 9)}
declare const ws: W9[];
let layer: number;
for await ({ layer } of ws) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-await assignment from a thenable that settles to itself or to a typed value stays unflagged",
  async () => {
    const plant = `${imports}interface S { then(cb: (value: S | { layer: number }) => void): void }
declare const ss: S[];
let layer: number;
for await ({ layer } of ss) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a for-await assignment from a thenable whose then takes no argument stays unflagged",
  async () => {
    const plant = `${imports}interface Z { then(cb: () => void): void }
declare const zs: Z[];
let layer: number;
for await ({ layer } of zs) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

test(
  "a growing thenable with a typed leaf keeps any when the settle budget runs out",
  async () => {
    const plant = `${imports}interface Gt<X> {
  then(cb: (v: Gt<[X]> | { layer: number }) => void): void;
}
declare const s: Gt<0>[];
let layer: unknown;
for await ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

const typedIterator = "{ next(): { done: false; value: { layer: number } } }";
const anyIterator = "{ next(): { done: false; value: any } }";

const overloadPlants = [
  [
    "S1: every zero-argument iterator overload counts",
    `declare const s: {
    [Symbol.iterator](): ${typedIterator};
    [Symbol.iterator](): ${anyIterator};
  };`,
    false,
    "{ layer }",
  ],
  [
    "S1 optional: a later optional iterator overload counts",
    `declare const s: {
    [Symbol.iterator](): ${typedIterator};
    [Symbol.iterator](x?: number): ${anyIterator};
  };`,
    false,
    "{ layer }",
  ],
  [
    "S1 third: a third iterator overload counts",
    `declare const s: {
    [Symbol.iterator](): ${typedIterator};
    [Symbol.iterator](): ${typedIterator};
    [Symbol.iterator](): ${anyIterator};
  };`,
    false,
    "{ layer }",
  ],
  [
    "void: an iterator parameter typed void may be left out",
    `declare const s: {
    [Symbol.iterator](x: void): ${anyIterator};
    [Symbol.iterator](): ${typedIterator};
  };`,
    false,
    "{ layer }",
  ],
  [
    "void union: an iterator parameter that includes void may be left out",
    `declare const s: {
    [Symbol.iterator](x: number | void): ${anyIterator};
    [Symbol.iterator](): ${typedIterator};
  };`,
    false,
    "{ layer }",
  ],
  [
    "async subtype: a typed next result must not hide a nested any",
    `declare const s: {
    [Symbol.asyncIterator](): {
      next(): Promise<{ done: false; value: { a: any; b: number } }>;
      next(x?: number): Promise<{ done: false; value: { a: { layer: number } } }>;
    };
  };`,
    true,
    "{ a: { layer } }",
  ],
  [
    "callback overloads: a missing first parameter must not hide a later any",
    `interface Z {
    then(cb: { (): void; (v: any): void }): void;
  }
  declare const s: Z[];`,
    true,
    "{ layer }",
  ],
  [
    "then overloads: a missing callback must not hide a later any",
    `interface Z {
    then(): void;
    then(cb: (v: any) => void): void;
  }
  declare const s: Z[];`,
    true,
    "{ layer }",
  ],
  [
    "MY32b: joining a later then overload keeps a known false flag",
    `interface Z {
    then(cb: (v: { layer: number }) => void): void;
    then(cb: (v: any) => void, x: number): void;
  }
  declare const s: Z[];`,
    true,
    "{ layer }",
  ],
] as const;

test.each(overloadPlants)(
  "%s fails the build",
  async (_name, declaration, isAwait, target) => {
    const plant = `${imports}${declaration}
let layer: unknown;
for ${isAwait ? "await " : ""}(${target} of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "tuple rest: an iterator overload with a required tuple element is skipped",
  async () => {
    const plant = `${imports}declare const s: {
  [Symbol.iterator](...a: [number]): ${anyIterator};
  [Symbol.iterator](): ${typedIterator};
};
let layer: number;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

const typedAsync = "{ next(): Promise<{ done: false; value: { layer: number } }> }";

/** Each row: a name, the declaration, whether the loop awaits, and the loop's target. */
const fallbackPlants = [
  [
    "R9c: an array intersected with an any iterator",
    `declare const s: { layer: number }[] & {
    [Symbol.iterator](): ${anyIterator};
  };`,
    false,
    "{ layer }",
  ],
  [
    "R9d: an Array subtype that overrides the iterator with an any iterator",
    `interface Sub extends Array<{ layer: number }> {
    [Symbol.iterator](): ArrayIterator<any>;
  }
  declare const s: Sub;`,
    false,
    "{ layer }",
  ],
  [
    "A6: an optional async iterator falls back to a sync any iterator",
    `declare const s: {
    [Symbol.asyncIterator]?(): ${typedAsync};
    [Symbol.iterator](): ${anyIterator};
  };`,
    true,
    "{ layer }",
  ],
  [
    "A7b: an async iterator typed undefined falls back to a sync any iterator",
    `declare const s: {
    [Symbol.asyncIterator]: undefined;
    [Symbol.iterator](): ${anyIterator};
  };`,
    true,
    "{ layer }",
  ],
  [
    "A7: a required async parameter falls back to a sync any iterator",
    `declare const s: {
    [Symbol.asyncIterator](x: number): ${typedAsync};
    [Symbol.iterator](): ${anyIterator};
  };`,
    true,
    "{ layer }",
  ],
  [
    "T14: a local Promise class with an any then is a thenable, not the global Promise",
    `declare class Promise<X> {
    then(cb: (v: any) => void): void;
    x: X;
  }
  declare const s: Promise<{ layer: number }>[];`,
    true,
    "{ layer }",
  ],
] as const;

test.each(fallbackPlants)(
  "%s fails the build",
  async (_name, declaration, isAwait, target) => {
    const plant = `${imports}${declaration}
let layer: unknown;
for ${isAwait ? "await " : ""}(${target} of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

/** Each row: a name, the declaration, whether the loop awaits, and the loop's target. */
const fallbackControls = [
  [
    "a plain array of typed objects stays clean",
    `declare const s: { layer: number }[];`,
    false,
    "{ layer }",
  ],
  [
    "an Array subtype without an override stays clean",
    `interface Sub extends Array<{ layer: number }> {}
  declare const s: Sub;`,
    false,
    "{ layer }",
  ],
  [
    "an array intersected with a typed iterator stays clean",
    `declare const s: { layer: number }[] & {
    [Symbol.iterator](): ${typedIterator};
  };`,
    false,
    "{ layer }",
  ],
  [
    "a real AsyncIterable of typed objects stays clean",
    `declare const s: AsyncIterable<{ layer: number }>;`,
    true,
    "{ layer }",
  ],
  [
    "an async iterator typed undefined with a typed sync iterator stays clean",
    `declare const s: {
    [Symbol.asyncIterator]: undefined;
    [Symbol.iterator](): ${typedIterator};
  };`,
    true,
    "{ layer }",
  ],
  [
    "an optional async iterator with a typed sync iterator stays clean",
    `declare const s: {
    [Symbol.asyncIterator]?(): ${typedAsync};
    [Symbol.iterator](): ${typedIterator};
  };`,
    true,
    "{ layer }",
  ],
  [
    "the global Promise of typed objects stays clean",
    `declare const s: Promise<{ layer: number }>[];`,
    true,
    "{ layer }",
  ],
  [
    "a tuple of typed objects stays clean",
    `declare const s: [{ layer: number }, { layer: number }];`,
    false,
    "{ layer }",
  ],
] as const;

test.each(fallbackControls)(
  "%s passes the build",
  async (_name, declaration, isAwait, target) => {
    const plant = `${imports}${declaration}
let layer: unknown;
for ${isAwait ? "await " : ""}(${target} of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toBe("");
  },
  BUILD_MS,
);

/** Runtime fields that the shipped list lacked: each must be renamed in every built file. */
const unlisted = [
  "borrows",
  "controllerOf",
  "deferFn",
  "lastController",
  "lastTarget",
  "mayHook",
  "releaser",
];

test(
  "the shipped list renames each runtime field it lacked in every built file",
  async () => {
    expect(listed).toEqual(expect.arrayContaining(unlisted));
    const root = mkdtempSync(join(tmpdir(), "core-dist-"));
    try {
      await build({
        config: false,
        cwd: core,
        entry: { index: "src/index.ts", testing: "src/testing.ts" },
        outDir: join(root, "dist"),
        dts: false,
        minify: true,
        logLevel: "silent",
        plugins: [privateFields()],
      });
      const files = readdirSync(join(root, "dist")).filter((file) => !file.endsWith(".map"));
      const built = files.map((file) => readFileSync(join(root, "dist", file), "utf8")).join("\n");
      for (const name of unlisted) expect(built).not.toMatch(new RegExp(`\\b${name}\\b`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  BUILD_MS,
);

test(
  "G105: an array joined with Iterable<any> fails the build",
  async () => {
    const plant = `${imports}declare const s: { layer: number }[] & Iterable<any>;
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G106: an Array<any> subtype with a typed index fails the build",
  async () => {
    const plant = `${imports}interface Sub extends Array<any> { [n: number]: { layer: number } }
declare const s: Sub;
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G107: Iterable<any> with a typed index fails the build",
  async () => {
    const plant = `${imports}declare const s: Iterable<any> & { [n: number]: { layer: number } };
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G108: Set<any> with a typed index fails the build",
  async () => {
    const plant = `${imports}declare const s: Set<any> & { [n: number]: { layer: number } };
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);

test(
  "G109: ArrayLike with Iterable<any> fails the build",
  async () => {
    const plant = `${imports}declare const s: ArrayLike<{ layer: number }> & Iterable<any>;
let layer;
for ({ layer } of s) {}\n`;
    expect(await guard({ "packages/react/src/plant.ts": plant }, ["layer"])).toContain(
      "layer: read without type checks in packages/react/src/plant.ts",
    );
  },
  BUILD_MS,
);
