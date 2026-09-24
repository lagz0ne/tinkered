import { expect, test } from "vite-plus/test";
import { createScope, isError as isCoreError, preset, type Scope } from "@tinker/core";
import { run, type Process } from "@tinker/process";
import { isError, judge, readTemplate, shell, suggest, type Blueprint } from "../src/index.ts";

/** Run the shell in-process: argv in, exit code and streams out. */
async function answer(
  argv: readonly string[],
  options?: Omit<Scope.Options, "extensions">,
): Promise<Process.Result> {
  return run(shell(options), argv);
}

/** A fixed judge over the shipped corpus: one answer per template id, counting calls
 * when `calls` is given (a plain counter object the test reads after). */
function fake(
  table: Readonly<Record<string, Blueprint.Answer>>,
  calls?: { count: number },
): Blueprint.Judge {
  return {
    ask: async (_state, questions) => {
      if (calls) calls.count++;
      return Object.fromEntries(Object.keys(questions).map((id) => [id, table[id]]));
    },
  };
}

/** The shipped `unitFits` shape for `resource` (corpus/unitFits.yaml), copied here to
 * assert the print, not to re-derive it. */
const resourceShape =
  'const x = resource({ label: "x", target, depends, factory: (deps, { defer, signal }) => { …; defer(() => stop()); return api; } })';

test("a confident resource pick prints unit, shape, target, all", async () => {
  const result = await answer(["suggest", "poll the API every 10s and keep the latest list"], {
    presets: [
      preset(judge, () =>
        fake({
          unitFits: {
            type: "choice",
            choice: "resource",
            probabilities: { resource: 0.78, operation: 0.15, data: 0.05, tag: 0.02 },
          },
          target: {
            type: "choice",
            choice: "scope",
            probabilities: { scope: 0.81, session: 0.19 },
          },
        }),
      ),
    ],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    [
      "unit:    resource (78%)",
      `shape:   ${resourceShape}`,
      "target:  scope (81%)",
      "all:     resource 78%, operation 15%, data 5%, tag 2%",
      "",
    ].join("\n"),
  );
});

test("a pick at the confidence floor prints its shape and an unclear target", async () => {
  const result = await answer(["suggest", "hold the connection"], {
    presets: [
      preset(judge, () =>
        fake({
          unitFits: {
            type: "choice",
            choice: "resource",
            probabilities: { data: 0.1, operation: 0.2, resource: 0.6, tag: 0.1 },
          },
          target: {
            type: "choice",
            choice: "session",
            probabilities: { scope: 0.4, session: 0.6 },
          },
        }),
      ),
    ],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(`shape:   ${resourceShape}`);
  expect(result.stdout).toContain("target:  session (60%)");
  expect(result.stdout).toContain("all:     resource 60%, operation 20%");
});

test("an unconfident pick prints unclear, with no shape or target line", async () => {
  const result = await answer(["suggest", "poll the API every 10s and keep the latest list"], {
    presets: [
      preset(judge, () =>
        fake({
          unitFits: {
            type: "choice",
            choice: "resource",
            probabilities: { resource: 0.55, operation: 0.2, tag: 0.15, data: 0.1 },
          },
        }),
      ),
    ],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    [
      "unit:    unclear (resource only 55%) — decide with the one law",
      "all:     resource 55%, operation 20%, tag 15%, data 10%",
      "",
    ].join("\n"),
  );
});

test("a non-resource pick prints no target: line and makes one judge call", async () => {
  const calls = { count: 0 };
  const result = await answer(["suggest", "parse the input and return the total"], {
    presets: [
      preset(judge, () =>
        fake(
          {
            unitFits: {
              type: "choice",
              choice: "operation",
              probabilities: { operation: 0.8, resource: 0.1, data: 0.06, tag: 0.04 },
            },
          },
          calls,
        ),
      ),
    ],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).not.toContain("target:");
  expect(result.stdout).toContain("unit:    operation (80%)");
  expect(calls.count).toBe(1);
});

test("empty words raise NoWords, mapped to exit 2 through the cli", async () => {
  const scope = createScope({ presets: [preset(judge, () => fake({}))] });
  try {
    await scope.run(suggest, { rawInput: { words: "" } });
    expect.unreachable("the parse must fail");
  } catch (error: unknown) {
    if (!isCoreError(error, "DataValidationFailed")) throw error;
    if (!isError(error.payload.cause, "NoWords")) throw error;
  } finally {
    await scope.close({ graceful: true });
  }
  const result = await answer(["suggest"]);
  expect(result.code).toBe(2);
});

test("a shapes map with a key outside choices fails the corpus load", () => {
  const text = [
    "id: x",
    "applies: [data]",
    "kind: choice",
    "status: provisional",
    "ask: Which one?",
    "choices:",
    "  data: a value",
    "shapes:",
    "  resource: wrong key",
  ].join("\n");
  try {
    readTemplate(text, "bad.yaml");
    expect.unreachable("the load must fail");
  } catch (error: unknown) {
    if (!isError(error, "InvalidTemplate")) throw error;
    expect(JSON.stringify(error.payload.issues)).toContain("shapes");
  }
});
