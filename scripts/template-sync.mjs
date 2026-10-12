import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Write each starter variation from this tree, one folder per branch of the template repo.
 * With `--push <remote>`, commit each folder to its branch and tag it `<variation>-v<version>`.
 *
 *   node scripts/template-sync.mjs <out> [--push git@github.com:lagz0ne/tinker-app.git]
 */
const usage = "usage: template-sync.mjs <out> [--push <remote>]";
const [out, flag, remote] = process.argv.slice(2);

assert.ok(out, usage);
assert.ok(!flag || (flag === "--push" && remote), usage);

const root = resolve(import.meta.dirname, "..");
const app = join(root, "apps/start-scaffold");
const version = JSON.parse(readFileSync(join(root, "packages/start/package.json"), "utf8")).version;

/** Branch names: `main` is the small app, so the template button gives the smallest start. */
const variations = { small: "main", demo: "demo" };

/** Files that build the registry or prove the scaffold; a new app never needs them. */
const scaffoldOnly = [
  /^maintain\//,
  /^public\//,
  /^templates\//,
  /^registry\.json$/,
  /^app\.package\.json$/,
  /^starter\.package\.json$/,
  /^package\.json$/,
];

const write = (folder, path, content) => {
  mkdirSync(dirname(join(folder, path)), { recursive: true });
  writeFileSync(join(folder, path), content);
};

/** The small app is exactly what `shadcn add app.json` writes into an empty folder. */
function small(folder) {
  const item = JSON.parse(readFileSync(join(app, "public/r/app.json"), "utf8"));

  for (const file of item.files) write(folder, file.target.slice(2), file.content);

  cpSync(join(app, "components.json"), join(folder, "components.json"));
  const readme = readFileSync(join(app, "templates/template-README.md"), "utf8");
  write(folder, "README.md", readme.replaceAll("@VERSION@", version));
}

/** The demo is the scaffold app itself, with its release package file. */
function demo(folder) {
  const files = execFileSync("git", ["ls-files"], { cwd: app, encoding: "utf8" })
    .split("\n")
    .filter((path) => path && !scaffoldOnly.some((pattern) => pattern.test(path)));

  for (const path of files) write(folder, path, readFileSync(join(app, path)));

  const pkg = JSON.parse(readFileSync(join(app, "starter.package.json"), "utf8"));
  pkg.name = "tinker-app";
  write(folder, "package.json", JSON.stringify(pkg, null, 2) + "\n");
}

/** A committed lockfile pins the tree and lets npm skip the resolve step. */
function lock(folder) {
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit"], {
    cwd: folder,
    stdio: "inherit",
  });
}

/** Replace the branch's tree with the new one; history stays, so each release is one commit. */
function push(variation, folder) {
  const branch = variations[variation];
  const tag = `${variation}-v${version}`;
  const clone = mkdtempSync(join(tmpdir(), "tinker-app-"));
  const git = (...args) => execFileSync("git", args, { cwd: clone, stdio: "inherit" });

  git("init", "-q", "-b", branch);
  git("remote", "add", "origin", remote);

  const known = execFileSync("git", ["ls-remote", "--heads", "origin", branch], {
    cwd: clone,
    encoding: "utf8",
  });
  if (known) {
    git("fetch", "-q", "--depth", "1", "origin", branch);
    git("reset", "-q", "--soft", "FETCH_HEAD");
  }

  for (const name of readdirSync(clone)) {
    if (name !== ".git") rmSync(join(clone, name), { recursive: true });
  }

  cpSync(folder, clone, { recursive: true });

  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", `${variation} app for start-v${version}`);
  git("tag", tag);
  git("push", "-q", "origin", branch, tag);

  rmSync(clone, { recursive: true });
  console.log(`Pushed ${branch} and ${tag}.`);
}

for (const [variation, fill] of Object.entries({ small, demo })) {
  const folder = resolve(out, variation);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });

  fill(folder);
  lock(folder);

  if (remote) push(variation, folder);
  console.log(`Wrote ${variation} for start-v${version} to ${folder}.`);
}
