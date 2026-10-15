import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite-plus";
import { expect, test } from "vite-plus/test";

const core = fileURLToPath(new URL("..", import.meta.url));

const stryker = JSON.parse(readFileSync(join(core, "stryker.config.json"), "utf8")) as {
  tempDirName: string;
  ignorePatterns?: string[];
};

/** True when Stryker's sandbox leaves this package-relative path out of its copy. */
const skipped = (rel: string) =>
  ["node_modules", ".git", stryker.tempDirName, ...(stryker.ignorePatterns ?? [])].some((pattern) =>
    matchesGlob(rel, pattern),
  );

/** Copies the package the way Stryker's sandbox does: every file it does not skip. */
function copyPackage(from: string, to: string, dir = ""): void {
  mkdirSync(join(to, dir), { recursive: true });
  for (const entry of readdirSync(join(from, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (skipped(rel)) continue;
    if (entry.isDirectory()) copyPackage(from, to, rel);
    else copyFileSync(join(from, rel), join(to, rel));
  }
}

/** Asks Vite which files the tests' two imports resolve to, from inside the sandbox. */
async function resolveImports(root: string) {
  const server = await createServer({
    root,
    configFile: join(root, "vite.config.ts"),
    logLevel: "silent",
    server: { middlewareMode: true, watch: null, hmr: false },
  });
  try {
    const importer = join(root, "tests", "random.test.ts");
    const index = await server.pluginContainer.resolveId("@/index", importer);
    const testing = await server.pluginContainer.resolveId("@tinker/core/testing", importer);
    return { index: index?.id, testing: testing?.id };
  } finally {
    await server.close();
  }
}

test("a Stryker sandbox resolves @/ and the testing entry to its own src", async () => {
  const sandboxes = join(core, stryker.tempDirName);
  mkdirSync(sandboxes, { recursive: true });
  const root = mkdtempSync(join(sandboxes, "paths-"));
  try {
    copyPackage(core, root);
    symlinkSync(join(core, "node_modules"), join(root, "node_modules"), "dir");

    const real = realpathSync(root);
    expect(await resolveImports(real)).toEqual({
      index: join(real, "src", "index.ts"),
      testing: join(real, "src", "testing.ts"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
