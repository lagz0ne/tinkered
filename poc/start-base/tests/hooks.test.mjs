import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { recordViolation, restartNote, startViolations, verifyBuild } from "../lib/hooks.mjs";
import { prepare } from "../lib/prepare.mjs";
import { say as typeSay } from "../lib/typecheck.mjs";
import { goodApp } from "./fixture.mjs";

const leak = {
  importer: "",
  importerLoc: { line: 6, column: 24 },
  specifier: "../lib/secret.server.ts",
  envType: "client",
  pattern: /\.server\./,
};

test("a build's boundary record starts empty, and keeps each violation once, at its spot", () => {
  const root = goodApp();
  const found = startViolations(root);
  const path = join(root, ".tinker/violations.json");
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([]);
  const info = { ...leak, importer: join(root, "src/routes/leak.tsx") };
  recordViolation(root, found, info);
  recordViolation(root, found, info);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([
    {
      env: "client",
      importer: "src/routes/leak.tsx:6:24",
      specifier: "../lib/secret.server.ts",
      rule: "/\\.server\\./",
    },
  ]);
});

test("tinker prepare and every tinker() load keep the last build's boundary record", () => {
  const root = goodApp();
  mkdirSync(join(root, ".tinker"));
  const kept = '[{"importer":"src/routes/leak.tsx:6:24"}]\n';
  writeFileSync(join(root, ".tinker/violations.json"), kept);
  prepare(root);
  expect(readFileSync(join(root, ".tinker/violations.json"), "utf8")).toBe(kept);
});

test("a build stops on doctor's lines first, and runs tsc only once they pass", () => {
  const broken = goodApp({ "src/router.tsx": "" });
  expect(verifyBuild(broken).errors).toEqual([
    "tinker doctor, named files: src/router.tsx:1 is a Start file the base does not read; router options go in src/router.ts",
  ]);
  expect(verifyBuild(goodApp()).errors).toEqual([typeSay.noTypescript]);
});

test("a build passes doctor's warnings on, and stops on nothing when tsc passes", () => {
  const root = goodApp({
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, noEmit: true },
      include: ["src"],
    }),
    "src/routes/index.tsx": 'export const Route = { path: "/" };\n',
  });
  const typescript = dirname(createRequire(import.meta.url).resolve("typescript/package.json"));
  symlinkSync(typescript, join(root, "node_modules/typescript"), "dir");
  expect(verifyBuild(root)).toEqual({
    errors: [],
    warnings: ['tinker doctor, glue: tsconfig.json:1 does not extend "./.tinker/tsconfig.json"'],
  });
});

test("dev restarts when the shell, a named file, or a seam file comes or goes, and not otherwise", () => {
  const root = "/app";
  expect(restartNote(root, "/app/src/routes/__root.tsx", "added")).toBe(
    "tinker: src/routes/__root.tsx added; restarting",
  );
  expect(restartNote(root, "/app/src/style.css", "removed")).toBe(
    "tinker: src/style.css removed; restarting",
  );
  expect(restartNote(root, "/app/src/lib/tinker.server.ts", "added")).toBe(
    "tinker: src/lib/tinker.server.ts added; restarting",
  );
  expect(restartNote(root, "/app/src/routes/index.tsx", "added")).toBeNull();
});
