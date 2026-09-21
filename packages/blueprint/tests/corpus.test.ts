import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { cli, type Cli } from "@tinker/cli";
import { commands, corpus, corpusPath, explain, isError } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve the corpus under the shipped path. */
async function loadShipped() {
  const scope = createScope();
  try {
    return await scope.resolve(corpus);
  } finally {
    await scope.close({ graceful: true });
  }
}

/** Resolve the corpus with `corpusPath` rebound to one fixture folder. */
async function loadFixture(name: string) {
  const scope = createScope({ tags: [corpusPath(join(here, "fixtures", name))] });
  try {
    return await scope.resolve(corpus);
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

test("the shipped corpus holds 17 templates sorted by id", async () => {
  const loaded = await loadShipped();
  expect(loaded.templates.map((template) => template.id)).toEqual([
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

test("needs naming body fails the build with InvalidTemplate", async () => {
  const scope = createScope({ tags: [corpusPath(join(here, "fixtures", "corpus-bad"))] });
  try {
    await scope.resolve(corpus);
    throw new Error("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidTemplate")) throw error;
    expect(JSON.stringify(error.payload.issues)).toContain("body");
  } finally {
    await scope.close({ graceful: true });
  }
});

test("applies naming view fails the build with InvalidTemplate", async () => {
  const scope = createScope({
    tags: [corpusPath(join(here, "fixtures", "corpus-bad-views"))],
  });
  try {
    await scope.resolve(corpus);
    throw new Error("must throw");
  } catch (error: unknown) {
    if (!isError(error, "InvalidTemplate")) throw error;
    expect(JSON.stringify(error.payload.issues)).toContain("view");
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a pair template sits in pairs and in no forKind list", async () => {
  const loaded = await loadShipped();
  expect(loaded.pairs.map((template) => template.id)).toEqual(["whyDuplicate"]);
  for (const kind of ["data", "resource", "operation", "tag"] as const)
    expect(loaded.forKind(kind).map((template) => template.id)).not.toContain("whyDuplicate");
});

test("explain answers every template beside the flag", async () => {
  const scope = createScope();
  try {
    const report = await scope.run(explain, { input: { md: false } });
    expect(report.md).toBe(false);
    expect(report.templates).toHaveLength(17);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("explain prints each id once", async () => {
  const result = await answer(["explain"]);
  expect(result.code).toBe(0);
  for (const id of ["runForwardsToClosure", "unitFits", "whyDuplicate"])
    expect(result.stdout.match(new RegExp(`^id: ${id}$`, "m"))).not.toBeNull();
});

test("explain with md starts each item with a bold id", async () => {
  const result = await answer(["explain", "--md"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("- **runForwardsToClosure**");
});
