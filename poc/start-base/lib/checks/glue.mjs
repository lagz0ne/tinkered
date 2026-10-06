import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lineAt, readJson, readText } from "../paths.mjs";
import { callsOf, parseSource, specifiers } from "../source.mjs";
import { verdict } from "./result.mjs";

export const say = {
  noVite: "vite.config.ts is missing; add one with plugins: [tinker()]",
  noImport: 'vite.config.ts:1 does not import tinker from "@tinker/start/vite"',
  calls: (line, count) =>
    `vite.config.ts:${line} calls tinker() ${count} times; call it once: plugins: [tinker()]`,
  start: (line) => `vite.config.ts:${line} adds tanstackStart(); tinker() adds it already`,
  tailwind: (line) =>
    `vite.config.ts:${line} imports @tailwindcss/vite; tinker() adds Tailwind already`,
  extends: 'tsconfig.json:1 does not extend "./.tinker/tsconfig.json"',
  paths: (line) =>
    `tsconfig.json:${line} sets compilerOptions.paths; it replaces the base's #tinker/* and @/* paths, so remove it`,
  strict: (line) => `tsconfig.json:${line} turns strict off; the base's files need strict`,
  postinstall:
    'package.json:1 has no "postinstall": "tinker prepare"; a fresh clone has no .tinker/',
  passed:
    "vite.config.ts calls tinker() once; tsconfig.json extends .tinker; postinstall runs tinker prepare",
  fixed: "set extends in tsconfig.json and postinstall in package.json",
};

/** @param {string} root - From the glue check; why: parse its vite.config.ts. */
function viteProblems(root) {
  const path = join(root, "vite.config.ts");
  if (!existsSync(path)) return [say.noVite];
  const source = parseSource(path);
  const imports = specifiers(source);
  const calls = callsOf(source, "tinker");
  const start = callsOf(source, "tanstackStart");
  const tailwind = imports.find(({ name }) => name === "@tailwindcss/vite");
  return [
    !imports.some(({ name }) => name === "@tinker/start/vite") && say.noImport,
    calls.length !== 1 && say.calls(calls[1] ?? 1, calls.length),
    start.length > 0 && say.start(start[0]),
    tailwind && say.tailwind(tailwind.line),
  ];
}

/** @param {string} path - From the glue check; why: a JSON file that may not parse. */
function readConfig(path) {
  try {
    return readJson(path);
  } catch {
    return {};
  }
}

/** @param {string} root - From the glue check; why: read its tsconfig.json. */
function tsconfigProblems(root) {
  const text = readText(join(root, "tsconfig.json"));
  const { extends: parent, compilerOptions = {} } = readConfig(join(root, "tsconfig.json"));
  return [
    parent !== "./.tinker/tsconfig.json" && say.extends,
    "paths" in compilerOptions && say.paths(lineAt(text, text.indexOf('"paths"'))),
    compilerOptions.strict === false && say.strict(lineAt(text, text.indexOf('"strict"'))),
  ];
}

/** @param {string} root - From the glue check; why: read its package.json scripts. */
function postinstallProblems(root) {
  const { scripts = {} } = readConfig(join(root, "package.json"));
  return [!/\btinker prepare\b/.test(scripts.postinstall ?? "") && say.postinstall];
}

/**
 * @param {string} root - From the glue fix; why: write the two lines the base owns.
 * @param {string} file - From fixGlue; why: tsconfig.json or package.json.
 * @param {(config: Record<string, any>) => Record<string, any>} change - From fixGlue; why: the edit.
 */
function editJson(root, file, change) {
  const path = join(root, file);
  writeFileSync(path, JSON.stringify(change(readConfig(path)), null, 2) + "\n");
}

/**
 * @param {string} root - From the glue check; why: the app whose two glue lines --fix writes.
 * @param {string[]} problems - From the glue check; why: write only the lines that are wrong.
 */
function fixGlue(root, problems) {
  if (problems.includes(say.extends))
    editJson(root, "tsconfig.json", (config) => ({
      ...config,
      extends: "./.tinker/tsconfig.json",
    }));
  if (problems.includes(say.postinstall))
    editJson(root, "package.json", (pkg) => ({
      ...pkg,
      scripts: { ...pkg.scripts, postinstall: "tinker prepare" },
    }));
  return say.fixed;
}

/**
 * Check 4: vite.config.ts calls tinker() once and adds nothing it owns; tsconfig.json extends
 * `.tinker/` and overrides no base option; postinstall runs `tinker prepare`.
 * `--fix` writes the extends line and the postinstall script; it never edits vite.config.ts.
 */
export function glue(root) {
  const problems = [
    ...viteProblems(root),
    ...tsconfigProblems(root),
    ...postinstallProblems(root),
  ].filter(Boolean);
  const fixable = problems.some((line) => line === say.extends || line === say.postinstall);
  return verdict(problems, say.passed, fixable ? () => fixGlue(root, problems) : undefined);
}
