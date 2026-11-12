import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
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

// A skill says which version it teaches (ADR 0143): `intent stale` reads it.
for (const name of releasePackages) {
  for (const file of globSync("skills/**/SKILL.md", { cwd: join(root, "packages", name) })) {
    const path = join(root, "packages", name, file);
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.replace(/(library_version: )'[^']*'/, `$1'${version}'`));
  }
}

const changelog = join(root, "CHANGELOG.md");

if (!existsSync(changelog) || !releaseNotes(readFileSync(changelog, "utf8"), version)) {
  console.log(`TODO: add a "## ${version}" section to CHANGELOG.md.`);
}

console.log(`Bumped to ${version}. Land it on main; green CI publishes v${version}.`);
console.log("tinker-app takes the new packages through its own pin bump.");
