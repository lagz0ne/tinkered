import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope, preset, type Scope } from "@tinker/core";
import { cli, type Cli } from "@tinker/cli";
import { check, commands, corpusPath, judge, readBlueprint, type Blueprint } from "../src/index.ts";

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
      "~probe  saveIssue  the work has its own steps\nok: 1 nodes, 1 findings\n",
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
    expect(opState?.uses.map((node) => node.name)).toEqual(["db"]);
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
