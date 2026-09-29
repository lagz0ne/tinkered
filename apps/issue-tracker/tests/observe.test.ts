import { expect, test } from "vite-plus/test";
import { createScope, preset } from "@tinker/core";
import { readIssues, store, issueServer } from "../src/index.ts";
import { jsonLines } from "@tinker/stack";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "issues-observe-")), "db");
}

function readLines(written: string[]): Record<string, unknown>[] {
  return written.map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("an error no route maps answers 500 and one `request failed` line names it", async () => {
  const written: string[] = [];
  const observe = jsonLines((line) => written.push(line));
  const server = issueServer();
  const scope = createScope({
    tags: [store.config(tempPath())],
    extensions: [server],
    observe,
    presets: [
      preset(readIssues, () => {
        throw new Error("list exploded");
      }),
    ],
  });
  try {
    await scope.ready;
    const app = scope.resolve(server);
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
