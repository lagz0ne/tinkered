import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { generated, staleTree } from "../../lib/checks/generated.mjs";
import { runCheck } from "../../lib/doctor.mjs";
import { basePackage } from "../../lib/paths.mjs";
import { prepare, render } from "../../lib/prepare.mjs";
import { fixture, goodApp, write } from "../fixture.mjs";

const tree = "import { Route as IndexRouteImport } from './../src/routes/index'\n";

/** A good app after `tinker prepare`: .tinker/ written, the route tree naming its one route. */
function preparedApp(files = {}) {
  const root = goodApp(files);
  prepare(root);
  write(root, { ".tinker/routeTree.gen.ts": tree });
  return root;
}

test("passes when .tinker/ matches, the tree has every route, and .gitignore lists both folders", () => {
  expect(generated(preparedApp())).toEqual({
    status: "ok",
    lines: [".tinker/ matches this base and src/routes; .gitignore lists .tinker/ and .tanstack/"],
  });
});

test("fails when .tinker/ is missing", () => {
  expect(generated(goodApp()).lines).toEqual([".tinker/ is missing; run tinker prepare"]);
});

test("names a stale generated file and a missing route tree", () => {
  const root = goodApp();
  prepare(root);
  write(root, { ".tinker/tsconfig.json": "{}" });
  expect(generated(root).lines).toEqual([
    ".tinker/tsconfig.json is stale; run tinker prepare",
    ".tinker/routeTree.gen.ts is missing; run tinker prepare",
  ]);
});

test("names a route file the tree misses, but not a file that exports no Route", () => {
  const root = preparedApp({
    "src/routes/later.tsx": 'export const Route = createFileRoute("/later")({});\n',
    "src/routes/broken.tsx": "export const route = 1;\n",
  });
  expect(generated(root).lines).toEqual([
    ".tinker/routeTree.gen.ts misses src/routes/later.tsx; run tinker prepare",
  ]);
});

test("leaves a route that clashes with the base to check 7, not to tinker prepare", () => {
  const root = preparedApp({
    "src/routes/tinker.tsx": 'export const Route = createFileRoute("/tinker")({});\n',
  });
  expect(generated(root).status).toBe("ok");
});

test("after the generator stops on a clash, tinker prepare names the gap and the clash", () => {
  const root = preparedApp({
    "src/routes/tinker.tsx": 'export const Route = createFileRoute("/tinker")({});\n',
  });
  expect(staleTree(root)).toEqual([
    "tinker prepare: the route generator left the tree stale; fix the lines below:",
    ".tinker/routeTree.gen.ts misses src/routes/tinker.tsx; run tinker prepare",
    "src/routes/tinker.tsx:1 takes /tinker, a base route",
  ]);
  expect(staleTree(preparedApp())).toEqual([]);
});

test("names a tree import that points at a base folder that moved", () => {
  const root = preparedApp();
  write(root, {
    ".tinker/routeTree.gen.ts": `${tree}import { Route as R } from './../../old-base/src/routes/root'\n`,
  });
  expect(generated(root).lines).toEqual([
    ".tinker/routeTree.gen.ts:2 imports ./../../old-base/src/routes/root, which does not exist; run tinker prepare",
  ]);
});

test("names each generated folder .gitignore does not list", () => {
  const root = preparedApp({ ".gitignore": "dist/\n" });
  expect(generated(root).lines).toEqual([
    ".gitignore does not list .tinker/",
    ".gitignore does not list .tanstack/",
  ]);
});

test("refuses to judge with another base's tinker", () => {
  const root = fixture({
    "package.json": "{}",
    "node_modules/@tinker/start/package.json": JSON.stringify({
      version: "0.0.9",
      exports: { "./package.json": "./package.json" },
    }),
  });
  expect(generated(root).lines).toEqual([
    `this tinker is base ${basePackage.version}, the app resolves 0.0.9; run the app's own tinker`,
  ]);
});

test("--fix rewrites .tinker/ and adds the missing .gitignore lines", () => {
  const root = preparedApp({ ".gitignore": "" });
  write(root, { ".tinker/tsconfig.json": "{}" });
  expect(runCheck(root, generated, true)).toEqual({
    status: "fixed",
    lines: ["ran tinker prepare; added .tinker/ .tanstack/ to .gitignore"],
  });
  expect(readFileSync(join(root, ".tinker/tsconfig.json"), "utf8")).toBe(
    render(root)["tsconfig.json"],
  );
});
