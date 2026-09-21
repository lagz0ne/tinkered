import { expect, test } from "vite-plus/test";
import { createScope, operation, preset } from "@tinker/core";
import { createApp, describeError, fail, jsonLines, readIssues } from "../src/index.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "issues-observe-")), "db");
}

function readLines(written: string[]): Record<string, unknown>[] {
  return written.map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("describeError reads a registry error, a plain Error with a cause, and a non-error", () => {
  expect(describeError(fail("DraftFailed", { reason: "no answer" }))).toMatchObject({
    error: "DraftFailed",
    name: "Error",
    kind: "DraftFailed",
    payload: { reason: "no answer" },
  });
  const wrapped = new Error("outer", { cause: new TypeError("inner") });
  expect(describeError(wrapped)).toMatchObject({
    error: "outer",
    cause: { error: "inner", name: "TypeError" },
  });
  expect(typeof describeError(wrapped).stack).toBe("string");
  expect(describeError("plain")).toEqual({ error: "plain" });
});

test("jsonLines writes every log line and only the failed spans", async () => {
  const written: string[] = [];
  const logs = operation({
    label: "logs",
    run: (_deps, ctx) => {
      ctx.log("hello", { n: 1 });
      return "ok";
    },
  });
  const breaks = operation({
    label: "breaks",
    run: async () => {
      throw new Error("boom");
    },
  });
  const scope = createScope({ observe: jsonLines((line) => written.push(line)) });
  try {
    expect(scope.run(logs)).toBe("ok");
    await expect(scope.run(breaks)).rejects.toThrow("boom");
  } finally {
    await scope.close({ graceful: true });
  }
  const lines = readLines(written);
  expect(lines.filter((line) => line.kind === "log")).toMatchObject([{ message: "hello", n: 1 }]);
  const spans = lines.filter((line) => line.kind === "span");
  expect(spans.map((span) => span.name)).toEqual(["breaks"]);
  expect(spans[0]).toMatchObject({ status: "failed", unit: "operation" });
});

test("jsonLines survives a writer that throws: the scope keeps running", async () => {
  let calls = 0;
  const scope = createScope({
    observe: jsonLines(() => {
      calls += 1;
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
    expect(calls).toBe(1);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("an error no route maps answers 500 and one `request failed` line names it", async () => {
  const written: string[] = [];
  const { scope, app } = await createApp({
    dataPath: tempPath(),
    observe: jsonLines((line) => written.push(line)),
    presets: [
      preset(readIssues, () => {
        throw new Error("list exploded");
      }),
    ],
  });
  try {
    const res = await app.request("/api/issues");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("internal");
    const failed = readLines(written).filter((line) => line.message === "request failed");
    expect(failed).toMatchObject([
      { method: "GET", path: "/api/issues", error: "list exploded", name: "Error" },
    ]);
  } finally {
    await scope.close({ graceful: true });
  }
});
