import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope, preset } from "@tinker/core";
import {
  corpus,
  corpusPath,
  engine,
  evals,
  evalsPath,
  evalSet,
  gradeTemplate,
  isError,
  judge,
  readEval,
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
  expect(parsed.target).toBe("saveIssue");
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

test("gradeTemplate grades proven with clear separation over at least two cases each side", async () => {
  const grade = await gradeTemplate(
    probeTemplate,
    {
      bad: [booleanEval("BAD", 1), booleanEval("BAD", 2)],
      clean: [booleanEval("CLEAN", 1), booleanEval("CLEAN", 2)],
    },
    fakeJudge(),
    signal,
  );
  expect(grade).toEqual({
    id: "probe",
    status: "proven",
    bad: [0.9, 0.9],
    clean: [0.1, 0.1],
    sep: 0.8,
    ordered: 1,
  });
});

test("gradeTemplate grades provisional with only one bad case", async () => {
  const grade = await gradeTemplate(
    probeTemplate,
    { bad: [booleanEval("BAD", 1)], clean: [booleanEval("CLEAN", 1), booleanEval("CLEAN", 2)] },
    fakeJudge(),
    signal,
  );
  expect(grade.status).toBe("provisional");
});

test("gradeTemplate grades noisy when the judge's answers are reversed", async () => {
  const grade = await gradeTemplate(
    probeTemplate,
    {
      bad: [booleanEval("BAD", 1), booleanEval("BAD", 2)],
      clean: [booleanEval("CLEAN", 1), booleanEval("CLEAN", 2)],
    },
    fakeJudge(true),
    signal,
  );
  expect(grade.status).toBe("noisy");
});

test("a choice template grades on 1 - probabilities[declaredKind]", async () => {
  const grade = await gradeTemplate(
    pickTemplate,
    {
      bad: [choiceEval("badOne", "resource"), choiceEval("badTwo", "resource")],
      clean: [choiceEval("cleanOne", "data"), choiceEval("cleanTwo", "data")],
    },
    fakeJudge(),
    signal,
  );
  for (const value of grade.bad) expect(value).toBeCloseTo(0.9);
  for (const value of grade.clean) expect(value).toBeCloseTo(0.1);
  expect(grade.status).toBe("proven");
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
              `${grade.id.padEnd(24)} ${grade.status.padEnd(11)} sep ${grade.sep.toFixed(2)} ordered ${grade.ordered.toFixed(2)}`,
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
);
