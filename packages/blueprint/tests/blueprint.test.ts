import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { cli, type Cli } from "@tinker/cli";
import { check, commands, isError, plainChecks, readBlueprint } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The ADR example off disk: one reader, used by the parse and cli tests. */
function readTracker(): string {
  return readFileSync(join(here, "..", "examples", "tracker.yaml"), "utf8");
}

/** Run `check` in a scope with the file text as input, like the cli row does. */
async function runCheck(text: string) {
  const scope = createScope();
  try {
    return scope.run(check, { rawInput: text });
  } finally {
    await scope.close({ graceful: true });
  }
}

/** Run the wiring in-process and close the root, like today’s cli `run`. */
async function answer(argv: readonly string[]): Promise<Cli.Result> {
  const ext = cli({ name: "blueprint", version: "0.0.0", commands });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  try {
    return await scope.resolve(ext)(argv);
  } finally {
    await scope.close({ graceful: true });
  }
}

/** Write one throwaway yaml file under a temp dir; the caller removes the dir. */
function writeTemp(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "blueprint-"));
  const path = join(dir, "case.yaml");
  writeFileSync(path, text);
  return path;
}

test("the ADR example parses to 5 nodes in file order with edges both ways", () => {
  const graph = readBlueprint(readTracker());
  expect(graph.nodes.map((node) => node.name)).toEqual([
    "dbPath",
    "db",
    "tx",
    "issueList",
    "saveIssue",
  ]);
  expect(graph.uses("saveIssue").map((node) => node.name)).toEqual(["tx", "issueList"]);
  expect(graph.usedBy("db").map((node) => node.name)).toEqual(["tx"]);
});

test("a dotted name is rejected with InvalidBlueprint and an issue that names the dot", () => {
  try {
    readBlueprint("- data:\n    name: a.b\n    promise: p\n    why: w\n");
    throw new Error("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidBlueprint")) throw error;
    expect(JSON.stringify(error.payload.issues)).toContain(".");
  }
});

test("a missing why is rejected with InvalidBlueprint", () => {
  try {
    readBlueprint("- data:\n    name: box\n    promise: p\n");
    throw new Error("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidBlueprint")) throw error;
    expect(error.payload.issues.length).toBe(1);
  }
});

test("an unknown key is rejected with InvalidBlueprint", () => {
  try {
    readBlueprint("- data:\n    name: box\n    promise: p\n    why: w\n    extra: 1\n");
    throw new Error("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidBlueprint")) throw error;
    expect(error.payload.issues.length).toBe(1);
  }
});

test("a resource without target reads as scope", () => {
  const graph = readBlueprint(
    "- resource:\n    name: db\n    promise: p\n    why: w\n- operation:\n    name: op\n    depends: [db]\n    promise: p\n    why: w\n",
  );
  expect(graph.nodes[0].target).toBe("scope");
});

test("unknownDepends produces one finding line", () => {
  const graph = readBlueprint(
    "- operation:\n    name: saveIssue\n    depends: [issueLst]\n    promise: p\n    why: w\n",
  );
  expect(plainChecks(graph)).toEqual([
    {
      check: "unknownDepends",
      node: "saveIssue",
      detail: 'depends on "issueLst": no such node',
      blocking: true,
    },
  ]);
});

test("duplicateName produces one finding per repeated name", () => {
  const graph = readBlueprint(
    "- tag:\n    name: dbPath\n    promise: p\n    why: w\n- tag:\n    name: dbPath\n    promise: q\n    why: x\n",
  );
  expect(plainChecks(graph)).toEqual([
    {
      check: "duplicateName",
      node: "dbPath",
      detail: 'the name "dbPath" names 2 nodes',
      blocking: true,
    },
  ]);
});

test("dataNoWriter produces one finding per data node with no writer", () => {
  const graph = readBlueprint("- data:\n    name: issueList\n    promise: p\n    why: w\n");
  expect(plainChecks(graph)).toEqual([
    {
      check: "dataNoWriter",
      node: "issueList",
      detail: "no operation or resource depends on it",
      blocking: true,
    },
  ]);
});

test("a clean blueprint returns no findings", async () => {
  expect(await runCheck(readTracker())).toEqual([]);
});

test("a blocking finding throws BlueprintRejected and the message holds the line", async () => {
  try {
    await runCheck(
      "- operation:\n    name: saveIssue\n    depends: [issueLst]\n    promise: p\n    why: w\n",
    );
    throw new Error("must throw");
  } catch (error: unknown) {
    if (!isError(error, "BlueprintRejected")) throw error;
    expect(error.payload.findings).toEqual([
      'unknownDepends  saveIssue  depends on "issueLst": no such node',
    ]);
  }
});

test("a breaking file answers exit 1 with the line on stderr", async () => {
  const path = writeTemp(
    "- operation:\n    name: saveIssue\n    depends: [issueLst]\n    promise: p\n    why: w\n",
  );
  try {
    const result = await answer(["check", path]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      'unknownDepends  saveIssue  depends on "issueLst": no such node',
    );
  } finally {
    rmSync(dirname(path), { recursive: true });
  }
});

test("a clean file answers ok with exit 0", async () => {
  const result = await answer(["check", join(here, "..", "examples", "tracker.yaml")]);
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("ok: 5 nodes\n");
});

test("a non-blueprint file answers exit 2", async () => {
  const path = writeTemp("- data:\n    name: box\n");
  try {
    const result = await answer(["check", path]);
    expect(result.code).toBe(2);
  } finally {
    rmSync(dirname(path), { recursive: true });
  }
});
