import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { prepare, render } from "../prepare.mjs";
import { baseDir, basePackage, installedBase, lineAt, listFiles, readJson } from "../paths.mjs";
import { isRouteFile } from "../route-path.mjs";
import { exportsOf, parseSource } from "../source.mjs";
import { fail, verdict } from "./result.mjs";

export const say = {
  otherBase: (running, resolved) =>
    `this tinker is base ${running}, the app resolves ${resolved}; run the app's own tinker`,
  missing: ".tinker/ is missing; run tinker prepare",
  stale: (name) => `.tinker/${name} is stale; run tinker prepare`,
  noTree: ".tinker/routeTree.gen.ts is missing; run tinker prepare",
  gone: (line, path) =>
    `.tinker/routeTree.gen.ts:${line} imports ${path}, which does not exist; run tinker prepare`,
  misses: (file) => `.tinker/routeTree.gen.ts misses ${file}; run tinker prepare`,
  ignore: (entry) => `.gitignore does not list ${entry}`,
  passed: ".tinker/ matches this base and src/routes; .gitignore lists .tinker/ and .tanstack/",
  fixed: (added) =>
    `ran tinker prepare${added.length > 0 ? `; added ${added.join(" ")} to .gitignore` : ""}`,
};

/** Generated folders the app's .gitignore must list. */
const ignored = [".tinker/", ".tanstack/"];

/** @param {string} root - From the generated check; why: compare the running tinker with the app's base. */
function otherBase(root) {
  const dir = installedBase(root);
  const found = dir && readJson(join(dir, "package.json")).version;
  return found && found !== basePackage.version ? say.otherBase(basePackage.version, found) : null;
}

/**
 * Each relative import in the route tree, resolved to a file on disk (or not).
 * @param {string} tree - From routeTreeProblems; why: the generated file's path.
 */
function treeImports(tree) {
  const text = readFileSync(tree, "utf8");
  return [...text.matchAll(/from '(\.[^']+)'/g)].map((match) => {
    const base = resolve(dirname(tree), match[1]);
    const file = ["", ".tsx", ".ts", ".jsx", ".js"].map((ext) => base + ext).find(existsSync);
    return { path: match[1], line: lineAt(text, match.index), base, file };
  });
}

/** @param {string} root - From the generated check; why: its route files must all be in the tree. */
function routeTreeProblems(root) {
  const tree = join(root, ".tinker/routeTree.gen.ts");
  if (!existsSync(tree)) return [say.noTree];
  const imports = treeImports(tree);
  const gone = imports.filter(({ file }) => !file).map(({ line, path }) => say.gone(line, path));
  const listed = new Set(imports.map(({ base }) => base));
  const routes = join(root, "src/routes");
  const misses = listFiles(routes)
    .filter((file) => isRouteFile(file) && exportsOf(parseSource(join(routes, file))).has("Route"))
    .filter((file) => !listed.has(join(routes, file.replace(/\.[jt]sx?$/, ""))))
    .map((file) => say.misses(`src/routes/${file}`));
  return [...gone, ...misses];
}

/** @param {string} root - From the generated check; why: the folders its .gitignore lacks. */
function unignored(root) {
  const path = join(root, ".gitignore");
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  return ignored.filter((entry) => !lines.includes(entry));
}

/** @param {string} root - From the generated check; why: the app whose .tinker/ goes stale. */
function folderProblems(root) {
  const dir = join(root, ".tinker");
  if (!existsSync(dir)) return [say.missing];
  const stale = Object.entries(render(root))
    .filter(
      ([name, text]) =>
        !existsSync(join(dir, name)) || readFileSync(join(dir, name), "utf8") !== text,
    )
    .map(([name]) => say.stale(name));
  return [...stale, ...routeTreeProblems(root)];
}

/**
 * Check 3: `.tinker/` matches this base, the route tree has every route file and no
 * dead import, and .gitignore lists the generated folders. `--fix` rewrites `.tinker/`; only a
 * stale route tree needs `tinker prepare`, which loads the app's Vite config.
 */
export function generated(root) {
  const other = otherBase(root);
  if (other) return fail([other]);
  const missing = unignored(root);
  const problems = [...folderProblems(root), ...missing.map(say.ignore)];
  return verdict(problems, say.passed, () => {
    prepare(root);
    for (const entry of missing) appendFileSync(join(root, ".gitignore"), `${entry}\n`);
    if (routeTreeProblems(root).length > 0) {
      execFileSync(process.execPath, [join(baseDir, "bin/tinker.mjs"), "prepare"], {
        cwd: root,
        stdio: "ignore",
      });
    }
    return say.fixed(missing);
  });
}
