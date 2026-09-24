import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope, type Scope } from "@tinker/core";
import { run, type Process } from "@tinker/process";
import {
  corpus,
  corpusPath,
  explain,
  isError,
  readCorpus,
  readTemplate,
  shell,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve the corpus under the shipped path. */
async function loadShipped() {
  const scope = createScope();
  try {
    return scope.resolve(corpus);
  } finally {
    await scope.close({ graceful: true });
  }
}

/** Resolve the corpus with `corpusPath` rebound to one fixture folder. */
async function loadFixture(name: string) {
  const scope = createScope({ tags: [corpusPath(join(here, "fixtures", name))] });
  try {
    return scope.resolve(corpus);
  } finally {
    await scope.close({ graceful: true });
  }
}

test("corpus sorts author files by id even when supplied in reverse order", async () => {
  const loaded = await loadFixture("corpus-print");
  const ordered = readCorpus([...loaded.templates].reverse());
  expect(ordered.templates.map((template) => template.id)).toEqual(["pick", "probe"]);
});

test("malformed template YAML reports the file and parser issue", () => {
  try {
    readTemplate("id: [broken\n", "broken.yaml");
    expect.unreachable("must reject bad YAML");
  } catch (error: unknown) {
    if (!isError(error, "InvalidTemplate")) throw error;
    expect(error.payload.file).toBe("broken.yaml");
    expect(error.payload.issues[0]).toHaveProperty("code", "BAD_INDENT");
    expect(error.message).toContain("broken.yaml");
  }
});

test("the shipped corpus holds 18 templates sorted by id", async () => {
  const loaded = await loadShipped();
  expect(loaded.templates.map((template) => template.id)).toEqual([
    "bodyStraysFromWork",
    "configNotTag",
    "dataManyWriters",
    "effectWithoutDefer",
    "handRolledLifetime",
    "hiddenNode",
    "manualSession",
    "needsDefer",
    "parseNotAtDoor",
    "publishTwice",
    "runForwardsToClosure",
    "scopeInsideUnit",
    "stateOutsideCell",
    "stopOnlyInDefer",
    "target",
    "unitFits",
    "whyDuplicate",
    "whyUnfulfilled",
  ]);
});

test("forKind answers the operation templates without the resource-only target", async () => {
  const loaded = await loadShipped();
  const ids = loaded.forKind("operation").map((template) => template.id);
  expect(ids).toContain("runForwardsToClosure");
  expect(ids).not.toContain("target");
});

test("one fixture template loads through a rebound corpusPath", async () => {
  const loaded = await loadFixture("corpus-ok");
  expect(loaded.templates.map((template) => template.id)).toEqual(["probeCheck"]);
});

test("needs naming an unknown field fails the build with InvalidTemplate", async () => {
  const scope = createScope({ tags: [corpusPath(join(here, "fixtures", "corpus-bad"))] });
  try {
    scope.resolve(corpus);
    throw new Error("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidTemplate")) throw error;
    expect(JSON.stringify(error.payload.issues)).toContain('["needs",0]');
  } finally {
    await scope.close({ graceful: true });
  }
});

test("applies naming view fails the build with InvalidTemplate", async () => {
  const scope = createScope({
    tags: [corpusPath(join(here, "fixtures", "corpus-bad-views"))],
  });
  try {
    scope.resolve(corpus);
    throw new Error("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidTemplate")) throw error;
    expect(JSON.stringify(error.payload.issues)).toContain('["applies",0]');
  } finally {
    await scope.close({ graceful: true });
  }
});

test("forKind answers a body template only with { body: true }", async () => {
  const loaded = await loadShipped();
  expect(loaded.forKind("operation").map((template) => template.id)).not.toContain(
    "bodyStraysFromWork",
  );
  expect(loaded.forKind("operation", { body: true }).map((template) => template.id)).toEqual([
    "bodyStraysFromWork",
  ]);
  expect(loaded.forKind("data", { body: true })).toEqual([]);
});

test("a pair template sits in pairs and in no forKind list", async () => {
  const loaded = await loadShipped();
  expect(loaded.pairs.map((template) => template.id)).toEqual(["whyDuplicate"]);
  for (const kind of ["data", "resource", "operation", "tag"] as const)
    expect(loaded.forKind(kind).map((template) => template.id)).not.toContain("whyDuplicate");
});

test("explain uses plain text when no markdown flag is given", async () => {
  const scope = createScope();
  try {
    const report = scope.run(explain, { rawInput: null });
    expect(report.md).toBe(false);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("explain answers every template beside the flag", async () => {
  const scope = createScope();
  try {
    const report = scope.run(explain, { input: { md: false } });
    expect(report.md).toBe(false);
    expect(report.templates).toHaveLength(18);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a template's omitted fields read as their defaults", async () => {
  const loaded = await loadFixture("corpus-print");
  expect(loaded.templates).toEqual([
    {
      id: "pick",
      scope: "node",
      applies: ["data"],
      needs: [],
      status: "provisional",
      ask: "Which one?",
      kind: "choice",
      choices: { data: "a value", tag: "a setting" },
      minConfidence: 0.6,
    },
    {
      id: "probe",
      scope: "pair",
      applies: ["operation"],
      needs: ["work"],
      status: "proven",
      ask: "Is it so?",
      kind: "boolean",
      true: "yes it is",
      false: "no it is not",
      threshold: 0.7,
    },
  ]);
});

/** Run the shell in-process: argv in, exit code and streams out. */
async function answer(
  argv: readonly string[],
  options?: Omit<Scope.Options, "extensions">,
): Promise<Process.Result> {
  return run(shell(options), argv);
}

test("explain prints choice comparison, both shapes, and lists of fields", async () => {
  const result = await answer(["explain"], {
    tags: [corpusPath(join(here, "fixtures", "corpus-detail"))],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("applies: resource, operation\nneeds: kind, body\n");
  expect(result.stdout).toContain("compare: kind\n");
  expect(result.stdout).toContain(
    "resource: holds a connection\nshape.resource: resource with factory\n" +
      "operation: performs a call\nshape.operation: operation with run\n",
  );
});

test("explain --md includes the choice comparison and both shapes", async () => {
  const result = await answer(["explain", "--md"], {
    tags: [corpusPath(join(here, "fixtures", "corpus-detail"))],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("  applies: resource, operation\n  needs: kind, body\n");
  expect(result.stdout).toContain("  compare: kind\n");
  expect(result.stdout).toContain(
    "  resource: holds a connection\n  shape.resource: resource with factory\n" +
      "  operation: performs a call\n  shape.operation: operation with run\n",
  );
});

test("explain prints a template as its file's fields, one per line", async () => {
  const options = { tags: [corpusPath(join(here, "fixtures", "corpus-print"))] };
  {
    const result = await answer(["explain"], options);
    expect(result.stdout).toBe(
      [
        "id: pick",
        "scope: node",
        "applies: data",
        "needs: ",
        "status: provisional",
        "ask: Which one?",
        "kind: choice",
        "minConfidence: 0.6",
        "data: a value",
        "tag: a setting",
        "",
        "id: probe",
        "scope: pair",
        "applies: operation",
        "needs: work",
        "status: proven",
        "ask: Is it so?",
        "kind: boolean",
        "threshold: 0.7",
        "true: yes it is",
        "false: no it is not",
        "",
      ].join("\n"),
    );
  }
});

test("explain --md prints a template as one list item with indented fields", async () => {
  const options = { tags: [corpusPath(join(here, "fixtures", "corpus-print"))] };
  {
    const result = await answer(["explain", "--md"], options);
    expect(result.stdout).toBe(
      [
        "- **pick** — Which one?",
        "  applies: data",
        "  needs: ",
        "  status: provisional",
        "  data: a value",
        "  tag: a setting",
        "",
        "- **probe** — Is it so?",
        "  applies: operation",
        "  needs: work",
        "  status: proven",
        "  true: yes it is",
        "  false: no it is not",
        "",
      ].join("\n"),
    );
  }
});

test("an InvalidTemplate message names the file and the issue path", async () => {
  try {
    await loadFixture("corpus-bad");
    expect.unreachable("the build must fail");
  } catch (error: unknown) {
    if (!isError(error, "InvalidTemplate")) throw error;
    expect(error.message).toMatch(/^badNeeds\.yaml: needs\.0: /);
  }
});
