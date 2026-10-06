import { existsSync } from "node:fs";
import { join } from "node:path";
import { shellFile } from "../named.mjs";
import { installedBase, listFiles, readJson } from "../paths.mjs";
import { isRouteFile, routeClash, routePath } from "../route-path.mjs";
import {
  callsOf,
  exportsOf,
  importedNames,
  parseSource,
  propertiesOf,
  usesOf,
} from "../source.mjs";
import { fail, verdict } from "./result.mjs";

export const say = {
  missing: "src/routes/ is missing; create src/routes/index.tsx",
  export: (at, path) => `${at} does not export Route; TanStack skips the file, so ${path} is a 404`,
  outlet: (at) => `${at} sets component without <Outlet />; no page renders inside the shell`,
  clash: (at, why) => `${at} ${why}`,
  passed: (owned) => `route files export Route; none takes a base path (${owned.join(", ")})`,
};

/** @param {string} root - From a check; why: read the paths the app's base mounts. */
export function ownedPaths(root) {
  const base = installedBase(root);
  return base ? Object.keys(readJson(join(base, "package.json")).tinker.routes) : [];
}

/**
 * @param {string} dir - From the routes check; why: the app's src/routes folder.
 * @param {string} file - From the route walk; why: one route file.
 * @param {string[]} owned - From ownedPaths; why: the base's own paths.
 */
function routeProblems(dir, file, owned) {
  const source = parseSource(join(dir, file));
  const at = `src/routes/${file}:${callsOf(source, "createFileRoute")[0] ?? 1}`;
  const clash = routeClash(file, owned);
  return [
    !exportsOf(source).has("Route") && say.export(at, routePath(file)),
    clash && say.clash(at, clash),
  ];
}

/**
 * A shell's `component` must render `<Outlet />`, unless it comes from another file.
 * @param {string} root - From the routes check; why: the app's shell lives there.
 */
function shellProblems(root) {
  const path = join(root, shellFile);
  if (!existsSync(path)) return [];
  const source = parseSource(path);
  const imported = importedNames(source);
  const component = propertiesOf(source, "component").find(
    ({ value }) =>
      !(value.type === "Identifier" && imported.has(value.name) && value.name !== "Outlet"),
  );
  if (!component || usesOf(source, "Outlet").length > 0) return [];
  return [say.outlet(`${shellFile}:${source.line(component)}`)];
}

/**
 * Check 7: src/routes exists, each route file exports `Route`, the shell renders an outlet,
 * and no route takes or nests under a path the base mounts. No fix.
 */
export function routes(root) {
  const dir = join(root, "src/routes");
  if (!existsSync(dir)) return fail([say.missing]);
  const owned = ownedPaths(root);
  const problems = listFiles(dir)
    .filter(isRouteFile)
    .flatMap((file) => routeProblems(dir, file, owned));
  return verdict([...problems, ...shellProblems(root)].filter(Boolean), say.passed(owned));
}
