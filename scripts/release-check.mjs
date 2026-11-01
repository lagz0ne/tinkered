import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The checks a tag passes before its release is published. Read-only; no GitHub client. */

/**
 * The CHANGELOG.md section for one version, or null.
 * @param {string} text - From the root CHANGELOG.md; why: the release notes.
 * @param {string} version - From the tag; why: the section to cut.
 */
export function releaseNotes(text, version) {
  const section = text
    .split(/^## /m)
    .slice(1)
    .find((part) => part.split("\n")[0].trim() === version);

  return section ? `## ${section.trim()}\n` : null;
}

/**
 * Each way the tree at `root` is not release `version`.
 * @param {string} root - From argv or a test; why: the tree the tag names.
 * @param {string} version - From the tag; why: the version both packages must carry.
 */
export function releaseProblems(root, version) {
  const versions = ["core", "react"]
    .map((name) => [
      `@tinker/${name}`,
      JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")).version,
    ])
    .filter(([, value]) => value !== version)
    .map(([name, value]) => `${name} is ${value}, not ${version}`);

  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const notes = releaseNotes(changelog, version)
    ? []
    : [`CHANGELOG.md has no "## ${version}" section`];

  return [...versions, ...notes];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version] = process.argv.slice(2);
  const root = resolve(import.meta.dirname, "..");

  const problems = releaseProblems(root, version);
  for (const problem of problems) console.error(`FAIL: ${problem}`);
  if (problems.length > 0) process.exit(1);

  process.stdout.write(releaseNotes(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version));
}
