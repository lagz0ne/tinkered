import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope, isError as isCoreError, preset, type Scope } from "@tinker/core";
import { run, type Process } from "@tinker/process";
import {
  bodyJudge,
  corpusPath,
  isError,
  readBlueprint,
  readUnits,
  shell,
  verify,
  verifyChecks,
  type Blueprint,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The golden pair is the committed file and source, found through the repo root: under a
 * mutation run this test file lives in a sandbox whose `src` is instrumented, and the pair
 * must be the real one — the code under test is the sandbox's, the data is the repo's. */
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const blueprintYaml = join(repo, "packages", "blueprint", "blueprint.yaml");
const srcDir = join(repo, "packages", "blueprint", "src");

/** Run the shell in-process: argv in, exit code and streams out (`check.test.ts`'s
 * `answer`). `verify` depends on `corpus` and `bodyJudge`; a test that skips `tags`/`presets`
 * gets the shipped corpus and no engine — the "no key" path. */
async function answer(
  argv: readonly string[],
  options?: Omit<Scope.Options, "extensions">,
): Promise<Process.Result> {
  return run(shell(options), argv);
}

/** One operation node whose body never mentions "close" — a body-template hit for
 * `corpus-body-provisional`/`corpus-body-proven`'s `probeBody`, under a fresh temp dir. */
function writeBodyCase(): { readonly dir: string; readonly yamlPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "blueprint-verify-body-"));
  const yamlPath = join(dir, "case.yaml");
  writeFileSync(yamlPath, "- operation:\n    name: op\n    promise: p\n    why: w\n    work: w\n");
  writeFileSync(
    join(dir, "ops.ts"),
    'export const op = operation({ label: "op", run: () => { doWork(); } });\n',
  );
  return { dir, yamlPath };
}

test("readUnits reads an unexported const with quoted keys and a function body", () => {
  const units = readUnits(
    'const job = operation({ "label": "job", "depends": { "db": engine.optional, ...extra }, run: function () { return 1; } });',
    "ops.ts",
  );
  expect(units).toEqual([
    {
      kind: "operation",
      label: "job",
      file: "ops.ts",
      line: 1,
      depends: ["engine"],
      target: undefined,
      body: "function () { return 1; }",
    },
  ]);
});

test("readUnits skips calls that do not declare a named const unit", () => {
  const units = readUnits(
    [
      'import { operation } from "@tinker/core";',
      'let mutable = operation({ label: "mutable" });',
      'const wrong = make({ label: "wrong" });',
      'const member = factory.operation({ label: "member" });',
      "const spread = operation(...args);",
      "const empty = operation();",
      'function hidden() { return operation({ label: "hidden" }); }',
      'const found = operation({ label: "found" });',
    ].join("\n"),
    "ops.ts",
  );
  expect(units.map((unit) => unit.label)).toEqual(["found"]);
});

test("readUnits reads only a literal string label and a literal session target", () => {
  const units = readUnits(
    "const dynamic = resource({ label: variable });\n" +
      "const number = resource({ label: 12 });\n" +
      'const task = resource({ label: "task", target: currentTarget });\n' +
      'const session = resource({ label: "session", target: "session" });',
    "ops.ts",
  );
  expect(units.map((unit) => [unit.label, unit.target])).toEqual([
    ["task", "scope"],
    ["session", "session"],
  ]);
});

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

test("depends mismatch reports a replaced dependency even when counts match", () => {
  const graph = readBlueprint(
    "- operation:\n    name: save\n    depends: [store]\n    promise: p\n    why: w\n",
  );
  const units = readUnits(
    'export const save = operation({ label: "save", depends: { clock } });',
    "ops.ts",
  );
  expect(verifyChecks(graph, units).map((finding) => finding.check)).toEqual(["dependsMismatch"]);
});

test("a resource missing from source is reported without a target check", () => {
  const graph = readBlueprint(
    "- resource:\n    name: tx\n    target: session\n    promise: p\n    why: w\n",
  );
  expect(verifyChecks(graph, [])).toEqual([
    {
      source: "plain",
      check: "missingUnit",
      node: "tx",
      detail: 'no unit labeled "tx"',
      blocking: true,
    },
  ]);
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

test("a rejected verify carries each mismatch as a separate line", async () => {
  const scope = createScope();
  try {
    await scope.run(verify, {
      input: {
        graph: readBlueprint(
          "- resource:\n    name: box\n    target: session\n    depends: [db]\n    promise: p\n    why: w\n",
        ),
        units: readUnits('const box = resource({ label: "box" });', "box.ts"),
        json: false,
      },
    });
    expect.unreachable("must reject mismatches");
  } catch (error: unknown) {
    if (!isError(error, "BlueprintRejected")) throw error;
    expect(error.payload.findings).toEqual([
      "dependsMismatch  box  the file names [db]; the code names []",
      "targetMismatch  box  the file says session; box.ts:1 declares scope",
    ]);
    expect(error.message).toContain(error.payload.findings.join("\n"));
  } finally {
    await scope.close({ graceful: true });
  }
});

test("verify on the golden pair with no key prints zero findings and the skip note, exit 0", async () => {
  const result = await answer(["verify", blueprintYaml, srcDir]);
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "ok: 12 nodes, 12 units, 0 findings\nbody templates skipped: no key\n",
  );
  expect(result.stderr).toBe("");
});

test("verify walks nested source and ignores test and declaration files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "blueprint-verify-walk-"));
  const yamlPath = join(dir, "case.yaml");
  mkdirSync(join(dir, "nested"));
  writeFileSync(yamlPath, "- data:\n    name: box\n    promise: p\n    why: w\n");
  writeFileSync(join(dir, "nested", "box.ts"), 'export const box = data({ label: "box" });');
  writeFileSync(join(dir, "extra.test.ts"), 'export const extra = data({ label: "extra" });');
  writeFileSync(join(dir, "extra.d.ts"), 'export const extra = data({ label: "extra" });');
  writeFileSync(join(dir, "extra.js"), 'export const extra = data({ label: "extra" });');
  try {
    const result = await answer(["verify", yamlPath, dir, "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ nodes: 1, units: 1, findings: [] });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a dir with no *.ts file answers exit 2, NoSource", async () => {
  const dir = mkdtempSync(join(tmpdir(), "blueprint-verify-"));
  const yamlPath = join(dir, "empty.yaml");
  writeFileSync(yamlPath, "[]\n");
  try {
    const result = await answer(["verify", yamlPath, dir]);
    expect(result.code).toBe(2);
    const scope = createScope();
    try {
      await scope.run(verify, { rawInput: { text: "[]", units: [], dir } });
      expect.unreachable("must reject empty source");
    } catch (error: unknown) {
      if (!isCoreError(error, "DataValidationFailed")) throw error;
      if (!isError(error.payload.cause, "NoSource")) throw error;
      expect(error.payload.cause.payload.dir).toBe(dir);
    } finally {
      await scope.close({ graceful: true });
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("--json prints the report and nothing else", async () => {
  const result = await answer(["verify", blueprintYaml, srcDir, "--json"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({ nodes: 12, units: 12, findings: [] });
});

test("verify asks a body template with state.body equal to the unit's body text", async () => {
  const { dir, yamlPath } = writeBodyCase();
  const seen: (string | undefined)[] = [];
  const recording: Blueprint.Judge = {
    ask: async (state, questions) => {
      if ("kind" in state) seen.push(state.body);
      return Object.fromEntries(
        Object.keys(questions).map((id) => [id, { type: "boolean", probability: 0 }]),
      );
    },
  };
  try {
    const result = await answer(["verify", yamlPath, dir], {
      tags: [corpusPath(join(here, "fixtures", "corpus-body-provisional"))],
      presets: [preset(bodyJudge, () => recording)],
    });
    expect(result.code).toBe(0);
    expect(seen).toEqual(["() => { doWork(); }"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a body-template hit prints with ~ and exits 0", async () => {
  const hot: Blueprint.Judge = {
    ask: async (_state, questions) =>
      Object.fromEntries(
        Object.keys(questions).map((id) => [id, { type: "boolean", probability: 0.9 }]),
      ),
  };
  const { dir, yamlPath } = writeBodyCase();
  try {
    const result = await answer(["verify", yamlPath, dir], {
      tags: [corpusPath(join(here, "fixtures", "corpus-body-provisional"))],
      presets: [preset(bodyJudge, () => hot)],
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "~probeBody  op  the body does something work does not say (90%)",
    );
    expect(result.stdout).not.toContain("body templates skipped: no key");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("the same body template proven blocks: exit 1, the line on stderr without ~", async () => {
  const hot: Blueprint.Judge = {
    ask: async (_state, questions) =>
      Object.fromEntries(
        Object.keys(questions).map((id) => [id, { type: "boolean", probability: 0.9 }]),
      ),
  };
  const { dir, yamlPath } = writeBodyCase();
  try {
    const result = await answer(["verify", yamlPath, dir], {
      tags: [corpusPath(join(here, "fixtures", "corpus-body-proven"))],
      presets: [preset(bodyJudge, () => hot)],
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("probeBody  op  the body does something work does not say");
    expect(result.stderr).not.toContain("~probeBody");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("verify skips --key-file's value when locating the file and dir arguments", async () => {
  const result = await answer(["verify", "--key-file", "/nonexistent/key", blueprintYaml, srcDir]);
  expect(result.code).toBe(0);
  expect(result.stdout.startsWith("ok: 12 nodes, 12 units, 0 findings")).toBe(true);
});
