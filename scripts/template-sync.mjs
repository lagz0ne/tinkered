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
 * Write the template repo from this tree: `main` is a router README, each variation is a branch.
 * With `--push <remote>`, commit each folder to its branch and tag each variation
 * `<variation>-v<version>`.
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
}

/** `main` holds only the README that sends each reader to a variation, so a shared link works. */
function router(folder) {
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

  // The scaffold's own ignore file leans on the monorepo root; a lone app needs the full one.
  cpSync(join(app, "templates/gitignore"), join(folder, ".gitignore"));
}

/** A committed lockfile pins the tree and lets npm skip the resolve step. */
function lock(folder) {
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit"], {
    cwd: folder,
    stdio: "inherit",
  });
}

/** Replace the branch's tree with the new one; history stays, so each release is one commit. */
function push(branch, folder) {
  const tag = branch === "main" ? undefined : `${branch}-v${version}`;
  const tags = tag
    ? execFileSync("git", ["ls-remote", "--tags", remote, tag], { encoding: "utf8" })
    : "";
  assert.equal(tags, "", `${tag} exists; a release tag never moves`);

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
  git("commit", "-q", "--allow-empty", "-m", `${branch} for start-v${version}`);
  if (tag) git("tag", tag);
  git("push", "-q", "--atomic", "origin", branch, ...(tag ? [tag] : []));

  rmSync(clone, { recursive: true });
  console.log(`Pushed ${[branch, tag].filter(Boolean).join(" and ")}.`);
}

for (const [branch, fill] of Object.entries({ small, demo, main: router })) {
  const folder = resolve(out, branch);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });

  fill(folder);

  if (fill !== router) {
    const ignored = readFileSync(join(folder, ".gitignore"), "utf8").split("\n");
    assert.ok(
      ignored.includes(".env") && ignored.includes("node_modules/"),
      `${branch} .gitignore`,
    );
    lock(folder);
  }

  if (remote) push(branch, folder);
  console.log(`Wrote ${branch} for start-v${version} to ${folder}.`);
}
