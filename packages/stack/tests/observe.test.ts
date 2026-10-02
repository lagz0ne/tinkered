import { createScope, operation } from "@tinker/core";
import { makeTestClock } from "@tinker/core/testing";
import { expect, test } from "vite-plus/test";
import { describeError, jsonLines } from "../src/index.ts";

function readLines(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line));
}

test("error logs retain registry fields, stack, nested causes, and non-errors", () => {
  const cause = Object.assign(new Error("inner"), { kind: "Broken", payload: { key: "x" } });
  const wrapped = new Error("outer", { cause });
  expect(describeError(wrapped)).toEqual({
    error: "outer",
    name: "Error",
    stack: wrapped.stack,
    cause: {
      error: "inner",
      name: "Error",
      kind: "Broken",
      payload: { key: "x" },
      stack: cause.stack,
    },
  });
  expect(describeError("plain")).toEqual({ error: "plain" });
  const noStack = new Error("no stack");
  delete noStack.stack;
  expect(describeError(noStack)).toEqual({ error: "no stack", name: "Error" });
});

test("JSON lines carry scope logs and failed spans with their fields", async () => {
  const written: string[] = [];
  const clock = makeTestClock({ now: 10 });
  const logs = operation({
    label: "logs",
    run: (_deps, ctx) => {
      ctx.log.warn("hello", { n: 1 });
      return "ok";
    },
  });
  const breaks = operation({
    label: "breaks",
    run: async (_deps, ctx) => {
      ctx.obs.event("failed here", { key: "x" });
      clock.advance(5);
      throw new Error("boom");
    },
  });
  const scope = createScope({
    clock,
    observe: { ...jsonLines((line) => written.push(line)), history: 10 },
  });
  try {
    scope.run(logs);
    const failed = await scope.settle(breaks);
    if (failed.status !== "failed") return expect.unreachable();
  } finally {
    await scope.close({ graceful: true });
  }
  const lines = readLines(written);
  const hello = lines.find((line) => line.message === "hello");
  expect(hello).toEqual({
    kind: "log",
    time: 10,
    level: 40,
    message: "hello",
    span: expect.any(Number),
    n: 1,
  });
  const spans = scope.spans().filter((span) => span.status === "failed");
  expect(lines.filter((line) => line.kind === "span")).toEqual(
    spans.map((span) => ({
      kind: "span",
      id: span.id,
      parent: span.parentId,
      name: span.name,
      unit: span.kind,
      start: span.start,
      end: span.end,
      status: span.status,
      ...span.attributes,
      events: span.events,
    })),
  );
});

test("a JSON writer failure does not stop scope work", async () => {
  const scope = createScope({
    observe: jsonLines(() => {
      throw new Error("disk full");
    }),
  });
  const logs = operation({
    label: "logs",
    run: (_deps, ctx) => {
      ctx.log("one");
      return 1;
    },
  });
  try {
    expect(scope.run(logs)).toBe(1);
  } finally {
    await scope.close({ graceful: true });
  }
});
