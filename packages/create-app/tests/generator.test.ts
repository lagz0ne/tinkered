import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { generate, isError } from "../src/index.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "tinker-create-"));
  roots.push(root);
  return root;
}

test("writes app-owned files under apps with the given name", async () => {
  const root = await workspace();
  const path = await generate({ root, name: "first-app" });
  expect(path).toBe(join(root, "apps", "first-app"));
  expect(JSON.parse(await readFile(join(path, "package.json"), "utf8"))).toMatchObject({
    name: "@tinker-app/first-app",
    dependencies: { "@tinker/core": "workspace:*" },
  });
  expect(await readFile(join(path, "src", "index.ts"), "utf8")).toContain("first-app");
});

test("refuses to overwrite an app's files", async () => {
  const root = await workspace();
  const path = await generate({ root, name: "saved" });
  await writeFile(join(path, "package.json"), "owned by the app");
  try {
    await generate({ root, name: "saved" });
    expect.unreachable("an existing app must be refused");
  } catch (error) {
    if (!isError(error, "AppExists")) throw error;
    expect(error.payload.path).toBe(path);
  }
  expect(await readFile(join(path, "package.json"), "utf8")).toBe("owned by the app");
});

test.each([undefined, 5, "", "../escape", "Upper", "has space", "bad-", "-bad", "two--parts"])(
  "refuses a name that is not one lowercase app directory: %s",
  async (name) => {
    const root = await workspace();
    try {
      await generate({ root, name });
      expect.unreachable("a bad name must be refused");
    } catch (error) {
      if (!isError(error, "BadAppName")) throw error;
      expect(error.payload.name).toBe(name);
    }
  },
);
