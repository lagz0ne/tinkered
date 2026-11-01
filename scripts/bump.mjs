import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { releaseNotes } from "./release-check.mjs";
import { releaseUrls } from "./release-urls.mjs";

/** Move Core and React to one new version. */
const [version] = process.argv.slice(2);
releaseUrls(version);
const root = resolve(import.meta.dirname, "..");

for (const name of ["core", "react"]) {
  const file = join(root, "packages", name, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
}

const changelog = join(root, "CHANGELOG.md");

if (!existsSync(changelog) || !releaseNotes(readFileSync(changelog, "utf8"), version)) {
  console.log(`TODO: add a "## ${version}" section to CHANGELOG.md.`);
}

console.log(`Bumped to ${version}. Land it on main; green CI publishes v${version}.`);
console.log("tinker-app takes the new Core and React through its own pin bump.");
