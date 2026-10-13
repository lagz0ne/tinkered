import { readdirSync } from "node:fs";
import { join, dirname, resolve, sep, isAbsolute, posix } from "node:path";

import { readItemModules } from "../item-modules.mjs";
import { isRoleFile } from "../joins.mjs";
import { installedBase, listFiles } from "../paths.mjs";
import { parseSource, specifiers } from "../source.mjs";
import { verdict } from "./result.mjs";

export const say = {
  extension: (at, name) =>
    `${at} "${name}" ends in a TypeScript file extension; remove .ts, .tsx, or .mts from the import`,
  seam: (at, name) => `${at} "${name}" is a base-only name; app code cannot import it`,
  entry: (at, name) =>
    `${at} "${name}" is not a base entry; use @tinker/start, @tinker/start/server, @tinker/start/client, or @tinker/start/vite`,
  path: (at, name) => `${at} "${name}" reaches into the base by path; use a base entry`,
  serverEntry: (at, name) =>
    `${at} "${name}" skips the base's scope; use createServerEntry from @tinker/start/server`,
  passed: (count) => `${count} files in src/ import the base only through its entries`,
};

const skipped = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".tinker",
  ".tanstack",
  ".stryker-tmp",
]);

/** App source, tests, and config files; dependencies and generated output are not app code. */
function appSources(root, dir = "") {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (skipped.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return appSources(root, path);
    return /\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  });
}

/** A finding at the module path's own line, including a dynamic or type-only import. */
function extensionImports(root) {
  return appSources(root).flatMap((file) =>
    specifiers(parseSource(join(root, file)))
      .filter(({ name }) => /\.(ts|tsx|mts)$/.test(name))
      .map(({ name, line }) => say.extension(`${file}:${line}`, name)),
  );
}

const entries = new Set([
  "@tinker/start",
  "@tinker/start/server",
  "@tinker/start/client",
  "@tinker/start/vite",
]);

/**
 * @param {string} name - From an import; why: a relative path may point into the base.
 * @param {string} file - From the src walk; why: resolve the path from it.
 * @param {string | null} base - From installedBase; why: a linked base folder.
 */
function reachesBase(name, file, base) {
  const target = name.startsWith(".") || isAbsolute(name) ? resolve(dirname(file), name) : "";
  if (target.includes(`${sep}node_modules${sep}@tinker${sep}start${sep}`)) return true;
  return Boolean(base && target.startsWith(base + sep));
}

/**
 * Which message a module path earns, or null when the import is fine.
 * @param {string} name - From an import; why: judge that one path.
 * @param {string} file - From the src walk; why: resolve a relative path from it.
 * @param {string | null} base - From installedBase; why: a relative path must not reach it.
 */
function badImport(name, file, base) {
  if (name.startsWith("#tinker/")) return say.seam;
  if (name === "@tanstack/react-start/server-entry") return say.serverEntry;
  if (name.startsWith("@tinker/start") && !entries.has(name)) return say.entry;
  return reachesBase(name, file, base) ? say.path : null;
}

/** Test files may reach private files, as with the package barrel rule. */
function isTest(file) {
  return /(?:^|\/)tests\//.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/** Public entries have fixed names; tests may import any file. */
function isPrivate(path, file) {
  return Boolean(path) && !["index", "index.server"].includes(path) && !isTest(file);
}

/** Import paths, including re-exports and dynamic imports, obey one item's public entry. */
function itemImport(name, file, line, folders) {
  const target = /^@\/items\/([^/]+)(?:\/(.*))?$/.exec(posix.normalize(name));
  if (!target) return [];
  const [, item, path] = target;
  const owner = /^src\/items\/([^/]+)\//.exec(file)?.[1];
  if (owner === item) return [];
  const at = `${file}:${line}`;
  const problems = [];

  if (isPrivate(path, file)) {
    problems.push(
      `${at} "${name}" is private to item ${item}; use "@/items/${item}" or "@/items/${item}/index.server"`,
    );
  }
  const from = folders.find((folder) => folder.name === owner);
  if (owner && !from?.requires.includes(item)) {
    problems.push(`${at} "${name}" needs "${item}" in src/items/${owner}/item.json requires`);
  }
  return problems;
}

/** Graph errors belong to named files; check 6 reports import boundaries without loading items. */
function itemImports(root) {
  const { declared: folders } = readItemModules(root, isRoleFile);
  return appSources(root).flatMap((file) =>
    specifiers(parseSource(join(root, file))).flatMap(({ name, line }) =>
      itemImport(name, file, line, folders),
    ),
  );
}

/**
 * Check 6: app code reaches the base only through its entries, and never by a base-only
 * `#tinker/*` name or a path into the package. App imports omit TypeScript file endings.
 * No fix: doctor never edits app code.
 */
export function imports(root) {
  const base = installedBase(root);
  const files = listFiles(join(root, "src")).filter((file) => /\.[jt]sx?$/.test(file));
  const bad = files.flatMap((file) => {
    const path = join(root, "src", file);
    return specifiers(parseSource(path))
      .map(({ name, line }) => ({
        name,
        at: `src/${file}:${line}`,
        message: badImport(name, path, base),
      }))
      .filter(({ message }) => message)
      .map(({ name, at, message }) => message(at, name));
  });
  return verdict(
    [...bad, ...extensionImports(root), ...itemImports(root)],
    say.passed(files.length),
  );
}
