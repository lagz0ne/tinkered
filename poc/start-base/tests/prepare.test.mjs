import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { basePackage } from "../lib/paths.mjs";
import { prepare, render } from "../lib/prepare.mjs";
import { fixture, goodApp } from "./fixture.mjs";

/** @param {string} root - From a test; why: the app whose rendered paths to read. */
const pathsOf = (root) => JSON.parse(render(root)["tsconfig.json"]).compilerOptions.paths;

test("every alias in the generated tsconfig is absolute, so shadcn writes inside the app", () => {
  const root = fixture({ "package.json": "{}" });
  const paths = pathsOf(root);
  expect(paths["@/*"]).toEqual([`${root}/src/*`]);
  expect(
    Object.values(paths)
      .flat()
      .every((path) => isAbsolute(path)),
  ).toBe(true);
});

test("a named file the app has wins; a missing one maps to the base default", () => {
  const root = goodApp({
    "src/router.ts": "export const router = () => ({});\n",
    "src/lib/tinker.server.ts": "export const extensions = [];\n",
  });
  const paths = pathsOf(root);
  expect(paths["#tinker/router"]).toEqual([join(root, "src/router.ts")]);
  expect(paths["#tinker/app.server"]).toEqual([join(root, "src/lib/tinker.server.ts")]);
  expect(paths["#tinker/start"]).toEqual([
    join(root, "node_modules/@tinker/start/src/defaults/start.ts"),
  ]);
  expect(paths["#tinker/routes"]).toEqual([join(root, ".tinker/routeTree.gen.ts")]);
});

test("prepare writes the tsconfig and the base version into .tinker/", () => {
  const root = fixture({ "package.json": "{}" });
  expect(prepare(root)).toEqual(["tsconfig.json", "base.json"]);
  expect(JSON.parse(readFileSync(join(root, ".tinker/base.json"), "utf8"))).toEqual({
    base: basePackage.version,
  });
  expect(existsSync(join(root, ".tinker/tsconfig.json"))).toBe(true);
});
