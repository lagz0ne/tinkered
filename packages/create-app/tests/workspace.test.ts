import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const packages = [
  "core",
  "drizzle",
  "hono",
  "http",
  "jobs",
  "mail",
  "auth",
  "nats",
  "react",
  "stack",
  "sync",
  "create-app",
];

test("the bin writes an app that installs, builds, checks, and passes its tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "tinker-workspace-"));
  try {
    for (const file of ["package.json", "pnpm-workspace.yaml", "vite.config.ts", ".gitignore"]) {
      await cp(join(repository, file), join(root, file));
    }
    for (const name of packages) {
      await cp(join(repository, "packages", name), join(root, "packages", name), {
        recursive: true,
        filter: (path) =>
          path !== join(repository, "packages", name, "tests") &&
          !/(?:^|\/)(?:node_modules|reports|\.stryker-tmp)(?:\/|$)/.test(path),
      });
    }
    execFileSync(process.execPath, [join(root, "packages/create-app/bin/index.ts"), "sample"], {
      cwd: root,
    });
    execFileSync("vp", ["install"], { cwd: root, stdio: "pipe" });
    execFileSync("vp", ["run", "-r", "build"], { cwd: root, stdio: "pipe" });
    execFileSync("vp", ["check"], { cwd: root, stdio: "pipe" });
    const output = execFileSync("vp", ["run", "@tinker-app/sample#test"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toMatch(/Tests\s+\d+ passed/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
