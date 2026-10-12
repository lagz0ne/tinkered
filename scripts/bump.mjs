import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { releaseUrls } from "../packages/start/lib/release.mjs";
import { releaseNotes } from "./release-check.mjs";

/** Move Core, React, and Start to one new version, then rebuild the registry's release links. */
const [version] = process.argv.slice(2);
releaseUrls(version);
const root = resolve(import.meta.dirname, "..");

for (const name of ["core", "react", "start"]) {
  const file = join(root, "packages", name, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = version;
  if (name === "start") {
    pkg.tinker.tested["@tinker/core"] = version;
    pkg.tinker.tested["@tinker/react"] = version;
  }
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
}

for (const readme of ["apps/start-scaffold/README.md", "packages/start/README.md"]) {
  const file = join(root, readme);
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replaceAll(/(start-v|tinker upgrade )\d+\.\d+\.\d+/g, `$1${version}`));
}

execFileSync("pnpm", ["--dir", "apps/start-scaffold", "run", "registry:build"], {
  cwd: root,
  stdio: "inherit",
});

const upgrade = readFileSync(join(root, "packages/start/UPGRADE.md"), "utf8");

if (!releaseNotes(upgrade, version)) {
  console.log(`TODO: add a "## ${version}" section to packages/start/UPGRADE.md.`);
}

console.log(`Bumped to ${version}. Land it on main; green CI publishes start-v${version}.`);
console.log("The release job then refreshes tinker-app (with the TINKER_APP_DEPLOY_KEY secret).");
