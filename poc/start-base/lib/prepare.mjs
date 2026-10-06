import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basePackage } from "./paths.mjs";

const compilerOptions = {
  target: "esnext",
  lib: ["es2024", "dom", "dom.iterable"],
  module: "esnext",
  moduleResolution: "bundler",
  types: ["node", "vite/client"],
  jsx: "react-jsx",
  strict: true,
  noUnusedLocals: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  esModuleInterop: true,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  skipLibCheck: true,
  resolveJsonModule: true,
};

/**
 * @param {string} root - From the app folder; why: a missing seam file maps to the base default.
 * @param {string} file - From the alias list; why: the app's own seam file name.
 */
function seamPath(root, file) {
  if (existsSync(join(root, "src/lib", file))) return `../src/lib/${file}`;
  return `../node_modules/@tinker/start/src/defaults/${file.replace("tinker", "app")}`;
}

/** @param {unknown} value - From render; why: one JSON style for every generated file. */
function json(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

/**
 * What `.tinker/` must hold for this app and this base version.
 * @param {string} root - From the app folder; why: seam paths depend on its files.
 */
export function render(root) {
  const paths = {
    "@/*": ["../src/*"],
    "#tinker/app": [seamPath(root, "tinker.ts")],
    "#tinker/app.server": [seamPath(root, "tinker.server.ts")],
    "#tinker/routes": ["./routeTree.gen.ts"],
  };
  return {
    "tsconfig.json": json({
      compilerOptions: { ...compilerOptions, paths },
      include: ["../src", "../tests", "./routeTree.gen.ts"],
      exclude: ["../dist", "../node_modules"],
    }),
    "base.json": json({ base: basePackage.version }),
  };
}

/** @param {string} root - From the plugin or the CLI; why: write `.tinker/` in that app. */
export function prepare(root) {
  const dir = join(root, ".tinker");
  mkdirSync(dir, { recursive: true });
  const files = render(root);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return Object.keys(files);
}
