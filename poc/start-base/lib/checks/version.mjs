import { join } from "node:path";
import { installedBase, installedVersion, lineAt, readJson, readText } from "../paths.mjs";
import { fail, verdict } from "./result.mjs";

export const say = {
  missing: "package.json:1 does not install @tinker/start; add it and install",
  drift: (at, name, found, tested) =>
    `${at} ${name} is ${found ?? "missing"}, tested with ${tested}`,
  passed: (version, count) => `@tinker/start ${version}; ${count} peers match the tested versions`,
};

/** Check 1: the base resolves, and its peers are the versions it was tested with. */
export function version(root) {
  const dir = installedBase(root);
  if (!dir) return fail([say.missing]);
  const pkg = readJson(join(dir, "package.json"));
  const text = readText(join(root, "package.json"));
  const tested = Object.entries(pkg.tinker.tested);
  const drift = tested
    .map(([name, want]) => [name, installedVersion(root, name), want])
    .filter(([, found, want]) => found !== want)
    .map(([name, found, want]) =>
      say.drift(`package.json:${lineAt(text, text.indexOf(`"${name}"`))}`, name, found, want),
    );
  return verdict(drift, say.passed(pkg.version, tested.length));
}
