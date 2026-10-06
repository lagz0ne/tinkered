import { join } from "node:path";
import { installedBase, installedVersion, readJson } from "../paths.mjs";
import { fail, verdict } from "./result.mjs";

export const say = {
  missing: "@tinker/start does not resolve; add it to package.json and install",
  drift: (name, found, tested) => `${name} is ${found ?? "missing"}, tested with ${tested}`,
  passed: (version, count) => `@tinker/start ${version}; ${count} peers match the tested versions`,
};

/** Check 1: the base resolves, and its peers are the versions it was tested with. */
export function version(root) {
  const dir = installedBase(root);
  if (!dir) return fail([say.missing]);
  const pkg = readJson(join(dir, "package.json"));
  const tested = Object.entries(pkg.tinker.tested);
  const drift = tested
    .map(([name, want]) => [name, installedVersion(root, name), want])
    .filter(([, found, want]) => found !== want)
    .map(([name, found, want]) => say.drift(name, found, want));
  return verdict(drift, say.passed(pkg.version, tested.length));
}
