import { createScope } from "@tinker/core";
import { memoryPair, subscribe, sync } from "@tinker/sync";
import { bootScope, buildApp, issueList, parseIssueList } from "../src/index.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "issues-")), "db");
}

test("creating a valid issue saves it and a second viewer sees it", async () => {
  const booted = await bootScope(tempPath());
  const { scope, src } = booted;
  const [near, far] = memoryPair();
  const served = scope.resolve(src).connect(near);
  const sub = subscribe(far);
  const guest = createScope({ tags: [sync(issueList)], extensions: [sub] });
  try {
    await guest.ready;
    expect(guest.resolve(issueList)).toEqual([]);

    const saved = await booted.save({ title: "First", description: "hello" });
    expect(saved.title).toBe("First");
    expect(guest.resolve(issueList).length).toBe(1);
    expect(guest.resolve(issueList)[0]?.title).toBe("First");
  } finally {
    guest.resolve(sub).close();
    await served;
    await guest.close({ graceful: true });
    await scope.close({ graceful: true });
  }
});

test("reopening against the same database restores the saved issue", async () => {
  const path = tempPath();
  const first = await bootScope(path);
  try {
    await first.save({ title: "Kept", description: "survives restart" });
  } finally {
    await first.scope.close({ graceful: true });
  }

  const second = await bootScope(path);
  try {
    expect(second.scope.resolve(issueList).length).toBe(1);
    expect(second.scope.resolve(issueList)[0]?.title).toBe("Kept");
  } finally {
    await second.scope.close({ graceful: true });
  }
});

test("the HTTP routes save through app.request", async () => {
  const booted = await bootScope(tempPath());
  const { scope } = booted;
  const app = buildApp(booted);
  try {
    const bad = await app.request("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "", description: "x" }),
    });
    expect(bad.status).toBe(400);
    expect(scope.resolve(issueList)).toEqual([]);

    const good = await app.request("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Via HTTP", description: "real route" }),
    });
    expect(good.status).toBe(201);
    expect(scope.resolve(issueList).length).toBe(1);

    const list = await app.request("/api/issues");
    expect(list.status).toBe(200);
    const saved = parseIssueList(await list.json());
    expect(saved.length).toBe(1);
    expect(saved[0]?.title).toBe("Via HTTP");
  } finally {
    await scope.close({ graceful: true });
  }
});
