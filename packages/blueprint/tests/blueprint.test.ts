import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { isError, plainChecks, readBlueprint } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The ADR example off disk. */
const trackerPath = join(here, "..", "examples", "tracker.yaml");

test("the ADR example parses to 5 nodes in file order with edges both ways", () => {
  const graph = readBlueprint(readFileSync(trackerPath, "utf8"));
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
      source: "plain",
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
      source: "plain",
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
      source: "plain",
      check: "dataNoWriter",
      node: "issueList",
      detail: "no operation or resource depends on it",
      blocking: true,
    },
  ]);
});
