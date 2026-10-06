import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { aliases, passThrough, startOptions } from "../lib/glue.mjs";
import { appFiles, ignoredFiles } from "../lib/named.mjs";
import { baseDir } from "../lib/paths.mjs";
import { fixture } from "./fixture.mjs";

/**
 * Where an import lands through the Vite aliases, the way Vite replaces it.
 * @param {string} root - From a test; why: the app the aliases point into.
 * @param {string} name - From a test; why: the import to resolve.
 */
function landing(root, name) {
  const alias = aliases(root).find(({ find }) => find.test(name));
  return alias && name.replace(alias.find, alias.replacement);
}

test("the glue picks up exactly five named files and two seam files", () => {
  expect(appFiles.map(({ file }) => file)).toEqual([
    "src/router.ts",
    "src/start.ts",
    "src/server.ts",
    "src/style.css",
    "src/lib/tinker.ts",
    "src/lib/tinker.server.ts",
  ]);
});

test("an alias points at the app's named file, else at the base default, and keeps ?url", () => {
  const root = fixture({ "src/start.ts": "", "src/style.css": "" });
  expect(landing(root, "#tinker/start")).toBe(join(root, "src/start.ts"));
  expect(landing(root, "#tinker/server")).toBe(join(baseDir, "src/defaults/server.ts"));
  expect(landing(root, "#tinker/style?url")).toBe(`${join(root, "src/style.css")}?url`);
  expect(landing(root, "#tinker/app.server")).toBe(join(baseDir, "src/defaults/app.server.ts"));
  expect(landing(root, "@/backend/greet.ts")).toBe(join(root, "src/backend/greet.ts"));
});

test("Start's usual files the glue does not read are listed, and the read ones are not", () => {
  const files = ignoredFiles.map(({ file }) => file);
  expect(files).toContain("src/router.tsx");
  expect(files).toContain("src/client.tsx");
  expect(files).toContain("src/routeTree.gen.ts");
  expect(files).not.toContain("src/router.ts");
  expect(files).not.toContain("src/start.ts");
  expect(files).not.toContain("src/server.ts");
});

test("Start's entries and base routes point into the base, relative to the app's src", () => {
  const root = fixture({ "src/routes/index.tsx": "" });
  const options = startOptions(root);
  expect(resolve(root, "src", options.server.entry)).toBe(join(baseDir, "src/entry/server.ts"));
  expect(resolve(root, "src", options.router.entry)).toBe(join(baseDir, "src/entry/router.tsx"));
  const { virtualRouteConfig: tree } = options.router;
  expect(resolve(root, "src/routes", tree.file)).toBe(join(baseDir, "src/routes/root.tsx"));
  expect(tree.children.map((child) => child.path ?? child.pathPrefix)).toEqual([
    "/api/health",
    "/tinker",
    "",
  ]);
});

test("the app's src/routes/__root.tsx replaces the base shell", () => {
  const root = fixture({ "src/routes/__root.tsx": "" });
  expect(startOptions(root).router.virtualRouteConfig.file).toBe("__root.tsx");
});

test("Start's static output options pass on; an unknown option fails the build", () => {
  expect(passThrough({ root: "/app", prerender: { enabled: true } })).toEqual({
    prerender: { enabled: true },
  });
  expect(() => passThrough({ prerendr: {} })).toThrow(
    "tinker(): unknown option prerendr; known: root, prerender, pages, spa, sitemap",
  );
});
