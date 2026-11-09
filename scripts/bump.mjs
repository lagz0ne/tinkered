import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { releaseNotes } from "./release-check.mjs";
import { releasePackages, releaseUrls } from "./release-urls.mjs";

/** Move every release package to one new version. */
const [version] = process.argv.slice(2);
releaseUrls(version);
const root = resolve(import.meta.dirname, "..");

for (const name of releasePackages) {
  const file = join(root, "packages", name, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
}

// The install lines name one release: its tag and each tarball name.
for (const name of releasePackages) {
  const file = join(root, "packages", name, "README.md");
  const text = readFileSync(file, "utf8")
    .replaceAll(/releases\/download\/v\d+\.\d+\.\d+/g, `releases/download/v${version}`)
    .replaceAll(/(tinker-(?:core|react|ws))-\d+\.\d+\.\d+\.tgz/g, `$1-${version}.tgz`);
  writeFileSync(file, text);
}

const changelog = join(root, "CHANGELOG.md");

if (!existsSync(changelog) || !releaseNotes(readFileSync(changelog, "utf8"), version)) {
  console.log(`TODO: add a "## ${version}" section to CHANGELOG.md.`);
}

console.log(`Bumped to ${version}. Land it on main; green CI publishes v${version}.`);
console.log("tinker-app takes the new Core and React through its own pin bump.");
