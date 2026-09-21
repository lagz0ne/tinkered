import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope, type Scope } from "@tinker/core";
import { cli, type Cli } from "@tinker/cli";
import { commands, readBlueprint, readUnits, verifyChecks } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const blueprintYaml = join(here, "..", "blueprint.yaml");
const srcDir = join(here, "..", "src");

/** Run the wiring in-process and close the root, like the real cli `run` (`check.test.ts`'s
 * `answer`). `verify` depends on nothing, so no tags or presets are ever needed. */
async function answer(
  argv: readonly string[],
  options?: Omit<Scope.Options, "extensions">,
): Promise<Cli.Result> {
  const ext = cli({ name: "blueprint", version: "0.0.0", commands });
  const scope = createScope({ ...options, extensions: [ext] });
  await scope.ready;
  try {
    return await scope.resolve(ext)(argv);
  } finally {
    await scope.close({ graceful: true });
  }
}

test("readUnits reads a resource's depends value, target, and factory body", () => {
  const src = [
    'export const corpusPath = tag({ label: "corpusPath" });',
    "export const corpus = resource({",
    '  label: "corpus",',
    "  depends: { dir: corpusPath },",
    '  target: "session",',
    "  factory: (deps, ctx) => deps.dir,",
    "});",
  ].join("\n");
  const corpus = readUnits(src, "a.ts").find((unit) => unit.label === "corpus");
  expect(corpus?.depends).toEqual(["corpusPath"]);
  expect(corpus?.target).toBe("session");
  expect(corpus?.body?.startsWith("(deps, ctx)")).toBe(true);
});

test("readUnits resolves engine.optional to engine and keeps store.tx as written", () => {
  const src = [
    "export const judge = resource({",
    '  label: "judge",',
    "  depends: { engine: engine.optional, tx: store.tx },",
    "  factory: () => {},",
    "});",
  ].join("\n");
  const judge = readUnits(src, "a.ts").find((unit) => unit.label === "judge");
  expect(judge?.depends).toEqual(["engine", "store.tx"]);
});

test("a unit without a literal label is skipped", () => {
  const units = readUnits('export const x = data({ promise: "p" });\n', "a.ts");
  expect(units).toEqual([]);
});

test("missingUnit: a node with no unit of that label", () => {
  const graph = readBlueprint(
    "- data:\n    name: box\n    promise: p\n    why: w\n- data:\n    name: other\n    promise: p\n    why: w\n",
  );
  const units = readUnits('export const other = data({ label: "other" });\n', "a.ts");
  expect(verifyChecks(graph, units)).toEqual([
    {
      source: "plain",
      check: "missingUnit",
      node: "box",
      detail: 'no unit labeled "box"',
      blocking: true,
    },
  ]);
});

test("undeclaredUnit: a declared unit with no node of that label, named by file:line", () => {
  const graph = readBlueprint("- data:\n    name: other\n    promise: p\n    why: w\n");
  const src = [
    'export const other = data({ label: "other" });',
    'export const issueList = data({ label: "issueList" });',
  ].join("\n");
  const units = readUnits(src, "cells.ts");
  expect(verifyChecks(graph, units)).toEqual([
    {
      source: "plain",
      check: "undeclaredUnit",
      node: "issueList",
      detail: 'data labeled "issueList" at cells.ts:2 has no node',
      blocking: true,
    },
  ]);
});

test("kindMismatch: the file's kind differs from the code's", () => {
  const graph = readBlueprint("- operation:\n    name: saveIssue\n    promise: p\n    why: w\n");
  const units = readUnits('export const saveIssue = resource({ label: "saveIssue" });\n', "ops.ts");
  expect(verifyChecks(graph, units)).toEqual([
    {
      source: "plain",
      check: "kindMismatch",
      node: "saveIssue",
      detail: "the file says operation; ops.ts:1 declares a resource",
      blocking: true,
    },
  ]);
});

test("dependsMismatch: the file's depends set differs from the code's, both sorted", () => {
  const graph = readBlueprint(
    "- operation:\n    name: saveIssue\n    depends: [tx, issueList]\n    promise: p\n    why: w\n",
  );
  const src = [
    "export const saveIssue = operation({",
    '  label: "saveIssue",',
    "  depends: { tx, issueList, clock },",
    "  run: () => {},",
    "});",
  ].join("\n");
  const units = readUnits(src, "ops.ts");
  expect(verifyChecks(graph, units)).toEqual([
    {
      source: "plain",
      check: "dependsMismatch",
      node: "saveIssue",
      detail: "the file names [issueList, tx]; the code names [clock, issueList, tx]",
      blocking: true,
    },
  ]);
});

test("targetMismatch: the file's target differs from the code's", () => {
  const graph = readBlueprint(
    "- resource:\n    name: tx\n    target: session\n    promise: p\n    why: w\n",
  );
  const units = readUnits(
    'export const tx = resource({ label: "tx", factory: () => {} });\n',
    "store.ts",
  );
  expect(verifyChecks(graph, units)).toEqual([
    {
      source: "plain",
      check: "targetMismatch",
      node: "tx",
      detail: "the file says session; store.ts:1 declares scope",
      blocking: true,
    },
  ]);
});

test("verify on the golden pair prints zero findings through the cli extension", async () => {
  const result = await answer(["verify", blueprintYaml, srcDir]);
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("ok: 11 nodes, 11 units, 0 findings\n");
  expect(result.stderr).toBe("");
});

test("a dir with no *.ts file answers exit 2, NoSource", async () => {
  const dir = mkdtempSync(join(tmpdir(), "blueprint-verify-"));
  const yamlPath = join(dir, "empty.yaml");
  writeFileSync(yamlPath, "[]\n");
  try {
    const result = await answer(["verify", yamlPath, dir]);
    expect(result.code).toBe(2);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("--json prints the report and nothing else", async () => {
  const result = await answer(["verify", blueprintYaml, srcDir, "--json"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({ nodes: 11, units: 11, findings: [] });
});
