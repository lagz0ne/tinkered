import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createScope, preset } from "@tinker/core";
import {
  bootScope,
  buildApp,
  fail,
  parseComment,
  parseIssueDetail,
  runDraft,
} from "../src/index.ts";
import { claudeCode } from "@tinker/harness";
import { readDraftServer, reservePort } from "./draft-server.ts";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "issues-draft-")), "db");
}

function readEvents(text: string): { kind: string; [key: string]: unknown }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()));
}

function readTerminal(events: { kind: string; [key: string]: unknown }[]) {
  return events.at(-1);
}

test("the draft helper is off by default and needs no account", async () => {
  const booted = await bootScope(tempPath());
  const app = buildApp(booted);
  try {
    const capability = await app.request("/api/draft");
    expect(capability.status).toBe(200);
    expect(await capability.json()).toEqual({ enabled: false });

    const created = await booted.save.create({ title: "Plain", description: "no helper" });
    const refused = await app.request(`/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(404);
    const detail = await booted.detail(created.id);
    expect(detail.comments).toEqual([]);
    expect(detail.activity.length).toBe(1);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("a draft streams text and finishes without saving anything", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const created = await booted.save.create({ title: "Streamed", description: "read me" });
  await booted.save.comment({ issueId: created.id, author: "Lin", text: "Discuss this." });
  const before = await booted.detail(created.id);
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "A short summary." }]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  try {
    const res = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const seen = readEvents(await res.text());
    expect(
      seen
        .filter((event) => event.kind === "text")
        .map((event) => event.text)
        .join(""),
    ).toBe("A short summary.");
    expect(seen.filter((event) => event.kind === "done")).toEqual([
      { kind: "done", draft: "A short summary." },
    ]);
    expect(readTerminal(seen)).toEqual({
      kind: "terminal",
      status: "done",
      draft: "A short summary.",
    });
    expect(await live.detail(created.id)).toEqual(before);
    expect(fixture.toolsCalled.sort()).toEqual(["get", "list"]);
    expect(fixture.decisions).toEqual([
      { behavior: "deny", message: "only issue reads are allowed" },
    ]);
    expect(fixture.saved).toEqual([before]);
    expect(fixture.readGuardrails()).toEqual({
      allowedTools: ["mcp__triage__list", "mcp__triage__get"],
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
    });
  } finally {
    await live.scope.close({ graceful: true });
    await heard.stop();
  }
});

test("an explicit post sends the generated draft and appends once", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const created = await booted.save.create({ title: "Post me", description: "v1" });
  const before = await booted.detail(created.id);
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "Post this draft." }]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  try {
    const generated = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const seen = readEvents(await generated.text());
    const terminal = readTerminal(seen);
    expect(terminal).toEqual({ kind: "terminal", status: "done", draft: "Post this draft." });
    const posted = await fetch(`${heard.base}/api/issues/${created.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "Ada", text: "Post this draft." }),
    });
    expect(posted.status).toBe(201);
    expect(parseComment(await posted.json()).text).toBe("Post this draft.");
    const after = await live.detail(created.id);
    expect({ ...after.issue, updatedAt: 0 }).toEqual({ ...before.issue, updatedAt: 0 });
    expect(after.comments).toEqual([
      ...before.comments,
      { ...after.comments.at(-1), author: "Ada", text: "Post this draft." },
    ]);
    expect(after.comments.at(-1)?.author).toBe("Ada");
    expect(after.comments.at(-1)?.text).toBe("Post this draft.");
    expect(after.activity).toEqual([
      ...before.activity,
      { ...after.activity.at(-1), kind: "commented", summary: "Ada commented" },
    ]);
  } finally {
    await live.scope.close({ graceful: true });
    await heard.stop();
  }
});

test("a model error result and a thrown model error both fail without a draft", async () => {
  for (const script of [{ errorResult: true }, { fail: true }]) {
    const heard = await reservePort();
    const path = tempPath();
    const booted = await bootScope(path);
    const created = await booted.save.create({ title: "Failing", description: "v1" });
    const before = await booted.detail(created.id);
    await booted.scope.close({ graceful: true });
    const fixture = readDraftServer([{ id: created.id, text: "never shown", ...script }]);
    const live = await bootScope(path, {
      draft: { enabled: true, baseUrl: heard.base },
      presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
    });
    heard.serve(buildApp(live));
    try {
      const res = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const seen = readEvents(await res.text());
      expect(seen.some((event) => event.kind === "done")).toBe(false);
      expect(seen.some((event) => event.kind === "status" && event.status === "failed")).toBe(true);
      expect(await live.detail(created.id)).toEqual(before);
    } finally {
      await live.scope.close({ graceful: true });
      await heard.stop();
    }
  }
});

test("a draft for a missing issue answers gone and runs no model", async () => {
  const fixture = readDraftServer([{ text: "never used" }]);
  const booted = await bootScope(tempPath(), {
    draft: { enabled: true, baseUrl: "http://127.0.0.1:1" },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = buildApp(booted);
  try {
    const res = await app.request("/api/issues/missing-id/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(fixture.turnCount()).toBe(0);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("an aborted caller runs no model turn", async () => {
  const fixture = readDraftServer([{ text: "never used" }]);
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fixture.sdk)] });
  try {
    const stopper = new AbortController();
    stopper.abort();
    const done = await runDraft(scope, { id: "x", prompt: "" }, () => undefined, stopper.signal);
    expect(done).toEqual({ status: "cancelled", draft: "" });
    expect(fixture.turnCount()).toBe(0);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("ordinary saves continue while a draft turn holds", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const created = await booted.save.create({ title: "Held", description: "v1" });
  const before = await booted.detail(created.id);
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "Held draft.", hold: true }]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  const pending = fetch(`${heard.base}/api/issues/${created.id}/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  pending.then(
    () => undefined,
    () => undefined,
  );
  try {
    await fixture.started();
    const other = await live.save.create({ title: "Concurrent", description: "no block" });
    expect(other.title).toBe("Concurrent");
    fixture.release();
    const seen = readEvents(await (await pending).text());
    expect(readTerminal(seen)).toEqual({ kind: "terminal", status: "done", draft: "Held draft." });
    expect(
      parseIssueDetail(await (await fetch(`${heard.base}/api/issues/${created.id}`)).json()),
    ).toEqual(before);
  } finally {
    fixture.release();
    await live.scope.close();
    await heard.stop();
    const { rmSync } = await import("node:fs");
    rmSync(path, { recursive: true, force: true });
  }
});

test("an HTTP disconnect cancels the model and saves nothing", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const created = await booted.save.create({ title: "Held cancel", description: "v1" });
  const before = await booted.detail(created.id);
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "never finishes", hold: true }]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  const stopper = new AbortController();
  const pending = fetch(`${heard.base}/api/issues/${created.id}/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
    signal: stopper.signal,
  }).then(
    (res) => res.text().then((text) => ({ text })),
    (error: unknown) => ({ error }),
  );
  pending.then(
    () => undefined,
    () => undefined,
  );
  try {
    await fixture.started();
    stopper.abort();
    let end: { readonly text: string } | { readonly error: unknown };
    try {
      end = await pending;
    } catch (error: unknown) {
      end = { error };
    }
    if ("text" in end) throw fail("DraftFailed", { reason: "disconnect settled a body" });
    await fixture.aborted();
    const detail = await live.detail(created.id);
    expect(detail).toEqual(before);
    expect(fixture.turnCount()).toBe(1);
  } finally {
    stopper.abort();
    fixture.release();
    await live.scope.close();
    await heard.stop();
    const { rmSync } = await import("node:fs");
    rmSync(path, { recursive: true, force: true });
  }
});

test("root close with a live caller aborts the model and settles cancelled", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const created = await booted.save.create({ title: "Held root", description: "v1" });
  const before = await booted.detail(created.id);
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "never finishes", hold: true }]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  const caller = new AbortController();
  const pending = fetch(`${heard.base}/api/issues/${created.id}/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
    signal: caller.signal,
  }).then(
    (res) => res.text().then((text) => ({ text })),
    (error: unknown) => ({ error }),
  );
  pending.then(
    () => undefined,
    () => undefined,
  );
  try {
    await fixture.started();
    expect(caller.signal.aborted).toBe(false);
    const closing = live.scope.close();
    await fixture.aborted();
    const closed = await closing;
    expect(closed.teardownErrors ?? []).toEqual([]);
    expect(closed.status).toBe("cancelled");
    const end = await pending;
    if ("text" in end) {
      const seen = readEvents(end.text);
      expect(seen.some((event) => event.kind === "done")).toBe(false);
    }
    const restarted = await bootScope(path);
    try {
      expect(await restarted.detail(created.id)).toEqual(before);
    } finally {
      await restarted.scope.close({ graceful: true });
    }
  } finally {
    caller.abort();
    fixture.release();
    await live.scope.close();
    await heard.stop();
    const { rmSync } = await import("node:fs");
    rmSync(path, { recursive: true, force: true });
  }
});

test("overlapping drafts on two issues stay isolated through one live app", async () => {
  const heard = await reservePort();
  const path = tempPath();
  const booted = await bootScope(path);
  const one = await booted.save.create({ title: "One", description: "v1" });
  const two = await booted.save.create({ title: "Two", description: "v1" });
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([
    { id: one.id, text: "First held draft.", hold: true },
    { id: two.id, text: "Second draft." },
  ]);
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  const firstFlight = new AbortController();
  const first = fetch(`${heard.base}/api/issues/${one.id}/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
    signal: firstFlight.signal,
  }).then((res) => res.text());
  first.then(
    () => undefined,
    () => undefined,
  );
  try {
    await fixture.started();
    const secondSeen = readEvents(
      await (
        await fetch(`${heard.base}/api/issues/${two.id}/draft`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      ).text(),
    );
    expect(
      secondSeen
        .filter((event) => event.kind === "text")
        .map((event) => event.text)
        .join(""),
    ).toBe("Second draft.");
    expect(readTerminal(secondSeen)).toEqual({
      kind: "terminal",
      status: "done",
      draft: "Second draft.",
    });
    fixture.release();
    const firstSeen = readEvents(await first);
    expect(
      firstSeen
        .filter((event) => event.kind === "text")
        .map((event) => event.text)
        .join(""),
    ).toBe("First held draft.");
    expect(readTerminal(firstSeen)).toEqual({
      kind: "terminal",
      status: "done",
      draft: "First held draft.",
    });
    expect(fixture.turnCount()).toBe(2);
  } finally {
    firstFlight.abort();
    fixture.release();
    await live.scope.close();
    await heard.stop();
    const { rmSync } = await import("node:fs");
    rmSync(path, { recursive: true, force: true });
  }
});
