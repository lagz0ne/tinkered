import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope, preset, type Scope } from "@tinker/core";
import { run, type Process } from "@tinker/process";
import {
  corpus,
  corpusPath,
  engine,
  evals,
  evalsPath,
  evalSet,
  goldenCasesOf,
  gradeTemplate,
  isError,
  judge,
  median,
  readBlueprint,
  readEval,
  shell,
  type Blueprint,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const provisionalCorpus = join(here, "fixtures", "corpus-provisional");
const provisionalEvals = join(here, "fixtures", "evals-provisional");

/** The ADR example from `docs/roadmap/blueprint-v1/contributor-brief.md`'s "An eval file". */
const exampleEval = `target: saveIssue
expect: true
blueprint:
  - resource:
      name: tx
      promise: one transaction per session
      why: the request commit is the save
  - operation:
      name: saveIssue
      depends: [tx]
      promise: given input, one saved issue
      why: writes go through tx
      work: hand ctx to saveIssueImpl and return what it returns
`;

const probeTemplate: Blueprint.Template = {
  id: "probe",
  scope: "node",
  applies: ["operation"],
  needs: ["work"],
  status: "provisional",
  ask: "Does the work do its own steps?",
  kind: "boolean",
  true: "the work has its own steps",
  false: "the work hands the job away",
  threshold: 0.5,
};

/** A `body`-needing template — what a `source:` eval case (below) grades. */
const probeBodyTemplate: Blueprint.Template = {
  id: "probeBody",
  scope: "node",
  applies: ["operation"],
  needs: ["work", "body"],
  status: "provisional",
  ask: "Does the body do something work does not say?",
  kind: "boolean",
  true: "the body does something work does not say",
  false: "the body does exactly what work says",
  threshold: 0.5,
};

const pickTemplate: Blueprint.Template = {
  id: "pick",
  scope: "node",
  applies: ["data", "resource", "operation", "tag"],
  needs: [],
  status: "provisional",
  ask: "Which unit fits this node?",
  kind: "choice",
  choices: { data: "a value", resource: "connects", operation: "one call", tag: "a setting" },
  minConfidence: 0.6,
  compare: "kind",
};

/** One boolean eval case: `marker` sits in `promise` so a fake can score it without
 * caring which file or node name carries it. */
function booleanEval(marker: "BAD" | "CLEAN", n: number): Blueprint.Eval {
  return readEval(
    `target: op\nexpect: ${marker === "BAD"}\nblueprint:\n  - operation:\n      name: op\n      promise: ${marker} case ${n}\n      why: w\n      work: w\n`,
    `${marker}-${n}.yaml`,
  );
}

/** One choice eval case for `pickTemplate`: declared `data`, `expect` names the pick. */
function choiceEval(name: string, expect: string): Blueprint.Eval {
  return readEval(
    `target: ${name}\nexpect: ${expect}\nblueprint:\n  - data:\n      name: ${name}\n      promise: p\n      why: w\n`,
    `${name}.yaml`,
  );
}

/** One fake for both question shapes, driven by what the question itself says it is:
 * boolean (high on `BAD`, low on `CLEAN`, read off the state's `promise`, swapped when
 * `reversed`) or choice (picks `resource` for a `bad`-named node, `data` otherwise). */
function fakeJudge(reversed = false): Blueprint.Judge {
  return {
    ask: async (state, questions) => {
      const [id, question] = Object.entries(questions)[0];
      if (question.type === "boolean") {
        const bad = ("promise" in state ? state.promise : "").includes("BAD") !== reversed;
        return { [id]: { type: "boolean", probability: bad ? 0.9 : 0.1 } };
      }
      const bad = ("name" in state ? state.name : "").toLowerCase().startsWith("bad");
      const probabilities = bad
        ? { data: 0.1, resource: 0.9, operation: 0, tag: 0 }
        : { data: 0.9, resource: 0.05, operation: 0.05, tag: 0 };
      return { [id]: { type: "choice", choice: bad ? "resource" : "data", probabilities } };
    },
  };
}

const signal = new AbortController().signal;

test("readEval parses the ADR's eval-file example", () => {
  const parsed = readEval(exampleEval, "forwards.yaml");
  expect(parsed.file).toBe("forwards.yaml");
  expect(parsed.target).toEqual(["saveIssue"]);
  expect(parsed.expect).toBe(true);
  expect(parsed.graph.nodes.map((node) => node.name)).toEqual(["tx", "saveIssue"]);
});

test("an eval file missing expect fails InvalidEval", () => {
  try {
    readEval("target: saveIssue\nblueprint: []\n", "bad.yaml");
    expect.unreachable("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidEval")) throw error;
    expect(error.payload.file).toBe("bad.yaml");
  }
});

test("readEval rejects a three-name target with InvalidEval", () => {
  try {
    readEval("target: [a, b, c]\nexpect: true\nblueprint: []\n", "bad.yaml");
    expect.unreachable("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidEval")) throw error;
    expect(error.payload.file).toBe("bad.yaml");
  }
});

test("gradeTemplate fails InvalidEval when a target names no node in its own blueprint", async () => {
  const missing = readEval(
    "target: missing\nexpect: true\nblueprint:\n  - operation:\n      name: op\n      promise: p\n      why: w\n",
    "missing-node.yaml",
  );
  try {
    await gradeTemplate(
      probeTemplate,
      { bad: [missing], clean: [], golden: [] },
      fakeJudge(),
      signal,
    );
    expect.unreachable("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidEval")) throw error;
    expect(error.payload.file).toBe("missing-node.yaml");
  }
});

test("gradeTemplate fails InvalidEval when a pair target has only one name", async () => {
  const onlyOneName = readEval(
    "target: solo\nexpect: true\nblueprint:\n  - tag:\n      name: solo\n      promise: p\n      why: w\n  - tag:\n      name: other\n      promise: p\n      why: w\n",
    "one-name.yaml",
  );
  const pairTemplate: Blueprint.Template = {
    id: "pair",
    scope: "pair",
    applies: ["tag"],
    needs: [],
    status: "provisional",
    ask: "?",
    kind: "boolean",
    true: "t",
    false: "f",
    threshold: 0.5,
  };
  try {
    await gradeTemplate(
      pairTemplate,
      { bad: [onlyOneName], clean: [], golden: [] },
      fakeJudge(),
      signal,
    );
    expect.unreachable("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidEval")) throw error;
    expect(error.payload.file).toBe("one-name.yaml");
  }
});

test("gradeTemplate sees the source-extracted body for a body template's eval", async () => {
  const evalCase = readEval(
    "target: op\nexpect: true\nblueprint:\n  - operation:\n" +
      "      name: op\n      promise: p\n      why: w\n      work: w\n" +
      'source: |\n  export const op = operation({ label: "op", run: () => doWork() });\n',
    "case.yaml",
  );
  const seen: (string | undefined)[] = [];
  const recording: Blueprint.Judge = {
    ask: async (state, questions) => {
      if ("kind" in state) seen.push(state.body);
      const [id] = Object.keys(questions);
      return { [id]: { type: "boolean", probability: 0 } };
    },
  };
  await gradeTemplate(
    probeBodyTemplate,
    { bad: [evalCase], clean: [], golden: [] },
    recording,
    signal,
  );
  expect(seen).toEqual(["() => doWork()"]);
});

test("gradeTemplate fails InvalidEval when source names no unit labeled target", async () => {
  const evalCase = readEval(
    "target: op\nexpect: true\nblueprint:\n  - operation:\n" +
      "      name: op\n      promise: p\n      why: w\n      work: w\n" +
      'source: |\n  export const other = operation({ label: "other", run: () => {} });\n',
    "case.yaml",
  );
  try {
    await gradeTemplate(
      probeBodyTemplate,
      { bad: [evalCase], clean: [], golden: [] },
      fakeJudge(),
      signal,
    );
    expect.unreachable("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidEval")) throw error;
    expect(error.payload.file).toBe("case.yaml");
  }
});

test("median sorts numerically before finding the middle, not lexicographically", () => {
  expect(median([])).toBeNaN();
  expect(median([10, 2, 1])).toBe(2);
  expect(median([1, 2, 3, 4])).toBe(2.5);
});

/** Five distinct cases each, so `enough` (≥ 5 a side) is met without repeating one case object. */
const fiveBad = [0, 1, 2, 3, 4].map((n) => booleanEval("BAD", n));
const fiveClean = [0, 1, 2, 3, 4].map((n) => booleanEval("CLEAN", n));

test("gradeTemplate grades proven with clear separation over at least five cases each side, golden cases clean", async () => {
  const grade = await gradeTemplate(
    probeTemplate,
    { bad: fiveBad, clean: fiveClean, golden: [booleanEval("CLEAN", 99)] },
    fakeJudge(),
    signal,
  );
  expect(grade).toEqual({
    id: "probe",
    status: "proven",
    bad: [0.9, 0.9, 0.9, 0.9, 0.9],
    clean: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    sep: 0.8,
    ordered: 1,
    goldenHits: [],
    goldenTotal: 1,
  });
});

test("gradeTemplate grades provisional with fewer than five cases on a side", async () => {
  const grade = await gradeTemplate(
    probeTemplate,
    {
      bad: [booleanEval("BAD", 1), booleanEval("BAD", 2)],
      clean: [booleanEval("CLEAN", 1), booleanEval("CLEAN", 2)],
      golden: [],
    },
    fakeJudge(),
    signal,
  );
  expect(grade.status).toBe("provisional");
});

test("gradeTemplate grades provisional when only one side reaches five cases", async () => {
  const grade = await gradeTemplate(
    probeTemplate,
    { bad: fiveBad, clean: [booleanEval("CLEAN", 1), booleanEval("CLEAN", 2)], golden: [] },
    fakeJudge(),
    signal,
  );
  expect(grade.status).toBe("provisional");
});

test("gradeTemplate scores 0 when the judge's answer is missing for that template id", async () => {
  const answersNothing: Blueprint.Judge = { ask: async () => ({}) };
  const grade = await gradeTemplate(
    probeTemplate,
    { bad: [booleanEval("BAD", 1)], clean: [booleanEval("CLEAN", 1)], golden: [] },
    answersNothing,
    signal,
  );
  expect(grade.bad).toEqual([0]);
  expect(grade.clean).toEqual([0]);
});

test("gradeTemplate grades noisy when the judge's answers are reversed", async () => {
  const grade = await gradeTemplate(
    probeTemplate,
    { bad: fiveBad, clean: fiveClean, golden: [] },
    fakeJudge(true),
    signal,
  );
  expect(grade.status).toBe("noisy");
});

test("gradeTemplate's ordered share kills the ordering arithmetic: one clean case outranking a bad one drops ordered below the bar", async () => {
  const oneCleanScoresHigh: Blueprint.Judge = {
    ask: async (state, questions) => {
      const [id] = Object.entries(questions)[0];
      const promise = "promise" in state ? state.promise : "";
      const probability = promise.includes("BAD") ? 0.9 : promise.includes("case 4") ? 0.95 : 0.1;
      return { [id]: { type: "boolean", probability } };
    },
  };
  const grade = await gradeTemplate(
    probeTemplate,
    { bad: fiveBad, clean: fiveClean, golden: [] },
    oneCleanScoresHigh,
    signal,
  );
  expect(grade.ordered).toBeCloseTo(0.8);
  expect(grade.status).toBe("noisy");
});

test("gradeTemplate grades noisy when a golden case hits, naming it, whatever the case count", async () => {
  const goldenCase = booleanEval("CLEAN", 99);
  const hitsGolden: Blueprint.Judge = {
    ask: async (state, questions) => {
      const [id] = Object.entries(questions)[0];
      const promise = "promise" in state ? state.promise : "";
      const probability = promise.includes("case 99") ? 0.6 : promise.includes("BAD") ? 0.9 : 0.1;
      return { [id]: { type: "boolean", probability } };
    },
  };
  const grade = await gradeTemplate(
    probeTemplate,
    { bad: fiveBad.slice(0, 2), clean: fiveClean.slice(0, 2), golden: [goldenCase] },
    hitsGolden,
    signal,
  );
  expect(grade.status).toBe("noisy");
  expect(grade.goldenHits).toEqual(["op"]);
});

test("a choice template grades on 1 - probabilities[declaredKind]", async () => {
  const grade = await gradeTemplate(
    pickTemplate,
    {
      bad: [0, 1, 2, 3, 4].map((n) => choiceEval(`bad${n}`, "resource")),
      clean: [0, 1, 2, 3, 4].map((n) => choiceEval(`clean${n}`, "data")),
      golden: [],
    },
    fakeJudge(),
    signal,
  );
  for (const value of grade.bad) expect(value).toBeCloseTo(0.9);
  for (const value of grade.clean) expect(value).toBeCloseTo(0.1);
  expect(grade.status).toBe("proven");
});

test("goldenCasesOf yields every matching unordered pair, in file order, and none for a kind it does not apply to", () => {
  const golden = readBlueprint(
    "- tag:\n    name: a\n    promise: p\n    why: w\n" +
      "- tag:\n    name: b\n    promise: p\n    why: w\n" +
      "- resource:\n    name: r\n    promise: p\n    why: w\n" +
      "- tag:\n    name: c\n    promise: p\n    why: w\n",
  );
  const pairTemplate: Blueprint.Template = {
    id: "pair",
    scope: "pair",
    applies: ["tag"],
    needs: [],
    status: "provisional",
    ask: "?",
    kind: "boolean",
    true: "t",
    false: "f",
    threshold: 0.5,
  };
  const cases = goldenCasesOf(pairTemplate, golden, "golden.yaml");
  expect(cases.map((c) => c.target)).toEqual([
    ["a", "b"],
    ["a", "c"],
    ["b", "c"],
  ]);
  expect(cases.every((c) => c.expect === false)).toBe(true);
  expect(cases.every((c) => c.file === "golden.yaml")).toBe(true);
});

test("evalSet attaches golden cases from evals/golden.yaml to every template it applies to", async () => {
  const scope = createScope({
    tags: [corpusPath(provisionalCorpus), evalsPath(join(here, "fixtures", "evals-golden"))],
  });
  try {
    const set = scope.resolve(evalSet);
    expect(set.get("probe")?.golden.map((c) => c.target[0])).toEqual(["g3", "g4"]);
    expect(set.get("probe")?.golden.map((c) => c.expect)).toEqual([false, false]);
    expect(set.get("pick")?.golden.map((c) => c.target[0])).toEqual(["g1", "g2", "g3", "g4"]);
    expect(set.get("pick")?.golden.map((c) => c.expect)).toEqual([
      "tag",
      "resource",
      "operation",
      "operation",
    ]);
    expect(set.get("pair")?.golden).toHaveLength(6);
  } finally {
    await scope.close({ graceful: true });
  }
});

/** Run the shell in-process: argv in, exit code and streams out. */
async function answer(
  argv: readonly string[],
  options?: Omit<Scope.Options, "extensions">,
): Promise<Process.Result> {
  return run(shell(options), argv);
}

test("evals through the cli prints exactly the expected line for proven, provisional, and a golden hit", async () => {
  const gradesJudge: Blueprint.Judge = {
    ask: async (state, questions) => {
      const [id] = Object.entries(questions)[0];
      const promise = "promise" in state ? state.promise : "";
      const probability = promise.includes("BAD") || promise.includes("GOLDENHIT") ? 1 : 0;
      return { [id]: { type: "boolean", probability } };
    },
  };
  const options = {
    tags: [
      corpusPath(join(here, "fixtures", "corpus-grades")),
      evalsPath(join(here, "fixtures", "evals-grades")),
    ],
    presets: [preset(judge, () => gradesJudge)],
  };
  {
    const result = await answer(["evals"], options);
    expect(result.stdout).toBe(
      [
        "✗ noisy        noisy        bad 2 (med 100%)  clean 3 (med 0%)  sep 100%  ordered 67%  golden 1/1",
        "✓ proven       proven       bad 5 (med 100%)  clean 5 (med 0%)  sep 100%  ordered 100%  golden 0/0",
        "~ provisional  provisional  bad 2 (med 100%)  clean 2 (med 0%)  sep 100%  ordered 100%  golden 0/0",
        "",
      ].join("\n"),
    );
  }
});

test("evals returns one grade per template in the fixture corpus", async () => {
  const scope = createScope({
    tags: [corpusPath(provisionalCorpus), evalsPath(provisionalEvals)],
    presets: [preset(judge, () => fakeJudge())],
  });
  try {
    const grades = await scope.run(evals);
    expect(grades.map((grade) => grade.id)).toEqual(["pair", "pick", "probe"]);
    for (const grade of grades) {
      expect(grade.bad).toHaveLength(2);
      expect(grade.clean).toHaveLength(2);
    }
  } finally {
    await scope.close({ graceful: true });
  }
});

test("the shipped evals folder has at least 2 bad and 2 clean files for every shipped template", async () => {
  const scope = createScope();
  try {
    const loadedCorpus = scope.resolve(corpus);
    const loadedEvals = scope.resolve(evalSet);
    for (const template of loadedCorpus.templates) {
      const set = loadedEvals.get(template.id);
      expect(set, `${template.id} has no evals folder`).toBeDefined();
      expect(set?.bad.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(set?.clean.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  } finally {
    await scope.close({ graceful: true });
  }
});

test.skipIf(!process.env.AI_GATEWAY_API_KEY)(
  "every proven template grades proven against the shipped evals",
  async () => {
    const scope = createScope({
      tags: [engine({ model: "typesafe-ai/jev", apiKey: process.env.AI_GATEWAY_API_KEY ?? "" })],
    });
    try {
      const grades = await scope.run(evals);
      const loadedCorpus = scope.resolve(corpus);
      console.log(
        grades
          .map(
            (grade) =>
              `${grade.id.padEnd(24)} ${grade.status.padEnd(11)} sep ${grade.sep.toFixed(2)} ordered ${grade.ordered.toFixed(2)} golden ${grade.goldenHits.length}/${grade.goldenTotal}${grade.goldenHits.length ? ` (${grade.goldenHits.join(", ")})` : ""}`,
          )
          .join("\n"),
      );
      const proven = new Set(
        loadedCorpus.templates.filter((template) => template.status === "proven").map((t) => t.id),
      );
      for (const grade of grades) if (proven.has(grade.id)) expect(grade.status).toBe("proven");
    } finally {
      await scope.close({ graceful: true });
    }
  },
  600_000,
);
