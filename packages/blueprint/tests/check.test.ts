import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope, isError as isCoreError, preset, type Scope } from "@tinker/core";
import { cli, type Cli } from "@tinker/cli";
import {
  check,
  commands,
  corpusPath,
  isError,
  judge,
  readBlueprint,
  type Blueprint,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const trackerPath = join(here, "..", "examples", "tracker.yaml");
const provisionalCorpus = join(here, "fixtures", "corpus-provisional");
const provenCorpus = join(here, "fixtures", "corpus-proven");

/** A no-op answer: a boolean under every threshold, and (by type mismatch) never a choice hit. */
const no: Blueprint.Answer = { type: "boolean", probability: 0 };

/** A fixed judge: one answer per question id, `no` for anything the table omits. */
function fake(table: Readonly<Record<string, Blueprint.Answer>>): Blueprint.Judge {
  return {
    ask: async (_state, questions) =>
      Object.fromEntries(Object.keys(questions).map((id) => [id, table[id] ?? no])),
  };
}

/** Run the wiring in-process and close the root, like the real cli `run`. */
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

/** Write one throwaway yaml file under a temp dir; the caller removes the dir. */
function writeTemp(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "blueprint-"));
  const path = join(dir, "case.yaml");
  writeFileSync(path, text);
  return path;
}

/** One operation node with a `work` line — what `probe` (corpus-provisional/corpus-proven) asks about. */
const oneOperation =
  "- operation:\n    name: saveIssue\n    promise: p\n    why: w\n    work: parses input, inserts the row\n";

/** One resource node — what `pick` (corpus-provisional) asks about; no `probe` match (not an operation). */
const oneResource = "- resource:\n    name: db\n    promise: p\n    why: w\n";

/** A resource used by an operation — the neighbour edges `uses`/`usedBy` read. */
const linkedPair =
  "- resource:\n    name: db\n    promise: p\n    why: w\n- operation:\n    name: op\n    depends: [db]\n    promise: p\n    why: w\n    work: uses db\n";

/** Two operations and a tag — one operation pair for a pair template that applies to operations. */
const twoOpsOneTag =
  "- operation:\n    name: first\n    promise: p\n    why: w\n- tag:\n    name: t\n    promise: p\n    why: w\n- operation:\n    name: second\n    promise: p\n    why: w\n";

/** Three tag nodes — three unordered pairs for the pair-scope template. */
const threeTags =
  "- tag:\n    name: a\n    promise: p\n    why: w\n- tag:\n    name: b\n    promise: p\n    why: w\n- tag:\n    name: c\n    promise: p\n    why: w\n";

test("a provisional hit prints with ~ and the run exits 0", async () => {
  const path = writeTemp(oneOperation);
  try {
    const result = await answer(["check", path], {
      tags: [corpusPath(provisionalCorpus)],
      presets: [preset(judge, () => fake({ probe: { type: "boolean", probability: 0.9 } }))],
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      "~probe  saveIssue  the work has its own steps (90%)\nok: 1 nodes, 1 findings\n",
    );
    expect(result.stderr).toBe("");
  } finally {
    rmSync(dirname(path), { recursive: true });
  }
});

test("a proven hit blocks: BlueprintRejected, exit 1, the line on stderr without ~", async () => {
  const path = writeTemp(oneOperation);
  try {
    const result = await answer(["check", path], {
      tags: [corpusPath(provenCorpus)],
      presets: [preset(judge, () => fake({ probe: { type: "boolean", probability: 0.9 } }))],
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("probe  saveIssue  the work has its own steps");
    expect(result.stderr).not.toContain("~probe");
  } finally {
    rmSync(dirname(path), { recursive: true });
  }
});

test("a choice below minConfidence makes no finding", async () => {
  const scope = createScope({
    tags: [corpusPath(provisionalCorpus)],
    presets: [
      preset(judge, () =>
        fake({ pick: { type: "choice", choice: "operation", probabilities: { operation: 0.5 } } }),
      ),
    ],
  });
  try {
    const result = await scope.run(check, {
      input: { graph: readBlueprint(oneResource), json: false },
    });
    expect(result.report.findings).toEqual([]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a choice equal to the compared field makes no finding", async () => {
  const scope = createScope({
    tags: [corpusPath(provisionalCorpus)],
    presets: [
      preset(judge, () =>
        fake({ pick: { type: "choice", choice: "resource", probabilities: { resource: 0.9 } } }),
      ),
    ],
  });
  try {
    const result = await scope.run(check, {
      input: { graph: readBlueprint(oneResource), json: false },
    });
    expect(result.report.findings).toEqual([]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("the judge sees the node with its neighbours", async () => {
  const seen: Blueprint.NodeState[] = [];
  const recording: Blueprint.Judge = {
    ask: async (state, questions) => {
      if ("kind" in state) seen.push(state);
      return Object.fromEntries(Object.keys(questions).map((id) => [id, no]));
    },
  };
  const scope = createScope({
    tags: [corpusPath(provisionalCorpus)],
    presets: [preset(judge, () => recording)],
  });
  try {
    await scope.run(check, { input: { graph: readBlueprint(linkedPair), json: false } });
    const opState = seen.find((state) => state.name === "op");
    const dbState = seen.find((state) => state.name === "db");
    expect(opState?.uses.map((node) => node.name)).toEqual(["db"]);
    expect(dbState?.usedBy.map((node) => node.name)).toEqual(["op"]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a pair template is asked once per unordered pair of matching nodes", async () => {
  let pairCalls = 0;
  const recording: Blueprint.Judge = {
    ask: async (_state, questions) => {
      if ("pair" in questions) pairCalls++;
      return Object.fromEntries(Object.keys(questions).map((id) => [id, no]));
    },
  };
  const scope = createScope({
    tags: [corpusPath(provisionalCorpus)],
    presets: [preset(judge, () => recording)],
  });
  try {
    await scope.run(check, { input: { graph: readBlueprint(threeTags), json: false } });
    expect(pairCalls).toBe(3);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("--json prints the report as one JSON object and nothing else", async () => {
  const path = writeTemp(oneOperation);
  try {
    const result = await answer(["check", path, "--json"], {
      tags: [corpusPath(provisionalCorpus)],
      presets: [preset(judge, () => fake({}))],
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ nodes: 1, findings: [] });
  } finally {
    rmSync(dirname(path), { recursive: true });
  }
});

test("with no engine bound, check fails NoKey and explain still answers", async () => {
  const path = writeTemp(readFileSync(trackerPath, "utf8"));
  try {
    const checkResult = await answer(["check", path]);
    expect(checkResult.code).toBe(1);
    expect(checkResult.stderr).toContain("AI_GATEWAY_API_KEY");
    const explainResult = await answer(["explain"]);
    expect(explainResult.code).toBe(0);
  } finally {
    rmSync(dirname(path), { recursive: true });
  }
});

test("a plain finding still blocks, regardless of any template", async () => {
  const path = writeTemp(
    "- operation:\n    name: saveIssue\n    depends: [issueLst]\n    promise: p\n    why: w\n    work: w\n",
  );
  try {
    const result = await answer(["check", path], {
      tags: [corpusPath(provisionalCorpus)],
      presets: [preset(judge, () => fake({}))],
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      'unknownDepends  saveIssue  depends on "issueLst": no such node',
    );
  } finally {
    rmSync(dirname(path), { recursive: true });
  }
});

test("check skips --key-file's value when locating the file argument", async () => {
  const path = writeTemp(oneOperation);
  try {
    const result = await answer(["check", "--key-file", "/nonexistent/key", path], {
      tags: [corpusPath(provisionalCorpus)],
      presets: [preset(judge, () => fake({}))],
    });
    expect(result.code).toBe(0);
  } finally {
    rmSync(dirname(path), { recursive: true });
  }
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

test("the shipped corpus and a judge answering no to everything finds nothing for tracker.yaml", async () => {
  const scope = createScope({ presets: [preset(judge, () => fake({}))] });
  try {
    const graph = readBlueprint(readFileSync(trackerPath, "utf8"));
    const result = await scope.run(check, { input: { graph, json: false } });
    expect(result.report).toEqual({ nodes: 5, findings: [] });
  } finally {
    await scope.close({ graceful: true });
  }
});

test("the judge is asked each template as its own question, keyed by id", async () => {
  const seen: Readonly<Record<string, Blueprint.Question>>[] = [];
  const recording: Blueprint.Judge = {
    ask: async (state, questions) => {
      if ("kind" in state) seen.push(questions);
      return Object.fromEntries(Object.keys(questions).map((id) => [id, no]));
    },
  };
  const scope = createScope({
    tags: [corpusPath(provisionalCorpus)],
    presets: [preset(judge, () => recording)],
  });
  try {
    await scope.run(check, { input: { graph: readBlueprint(oneOperation), json: false } });
    expect(seen).toEqual([
      {
        pick: {
          type: "choice",
          instructions: "Which unit fits this node?",
          criteria: {
            data: "a value read over time",
            resource: "something that subscribes or connects",
            operation: "something asked for once per call",
            tag: "an environment choice",
          },
        },
        probe: {
          type: "boolean",
          instructions: "Does the work do its own steps?",
          criteria: { true: "the work has its own steps", false: "the work hands the job away" },
        },
      },
    ]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a pair template is asked only about pairs whose kinds it applies to, named a, b", async () => {
  const seen: string[] = [];
  const recording: Blueprint.Judge = {
    ask: async (state, questions) => {
      if ("a" in state) seen.push(`${state.a.name}, ${state.b.name}`);
      return Object.fromEntries(
        Object.keys(questions).map((id) => [id, { type: "boolean", probability: 1 }]),
      );
    },
  };
  const scope = createScope({
    tags: [corpusPath(join(here, "fixtures", "corpus-pair-ops"))],
    presets: [preset(judge, () => recording)],
  });
  try {
    const value = await scope.run(check, {
      input: { graph: readBlueprint(twoOpsOneTag), json: false },
    });
    expect(seen).toEqual(["first, second"]);
    expect(value.report.findings.map((finding) => finding.node)).toEqual(["first, second"]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("check rejects a call without the file text as its parse failure", async () => {
  const scope = createScope({
    tags: [corpusPath(provisionalCorpus)],
    presets: [preset(judge, () => fake({}))],
  });
  try {
    await scope.run(check, { rawInput: { json: true } });
    expect.unreachable("the parse must fail");
  } catch (error: unknown) {
    if (!isCoreError(error, "DataValidationFailed")) throw error;
    if (!isError(error.payload.cause, "InvalidBlueprint")) throw error;
    expect(error.payload.cause.payload.issues).toHaveLength(1);
  } finally {
    await scope.close({ graceful: true });
  }
});
