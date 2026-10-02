import { cloneDatabase } from "./database.ts";
import { expect, test } from "vite-plus/test";
import { createScope, type Observe, type Operation, type Scope } from "@tinker/core";
import { preset } from "@tinker/core/testing";
import {
  addComment,
  createIssue,
  draftTags,
  fail,
  issueList,
  isError,
  parseComment,
  parseDraftInput,
  parseIssueDetail,
  publish,
  readDetail,
  src,
  startDraft,
  storeConfig,
  migrateIssues,
  issueServer,
  type DraftConfig,
} from "../src/index.ts";
import { claudeCode } from "@tinker/harness";
import { readDraftServer, reservePort } from "./draft-server.ts";

type Boot = {
  readonly draft?: DraftConfig;
  readonly observe?: Observe.Config;
  readonly presets?: readonly Scope.Preset[];
};

/** This file's root: every server part plus the draft tags, as `main.ts` lists
 * them, over a clone of the migrated test database. */
async function boot(path: { client: import("@electric-sql/pglite").PGlite }, options: Boot = {}) {
  const server = issueServer();
  const scope = createScope({
    tags: [storeConfig({ kind: "borrow", client: path.client }), draftTags(options.draft)],
    extensions: [server, migrateIssues, src, publish()],
    presets: options.presets,
    observe: options.observe,
  });
  await scope.ready;
  return { scope, app: scope.resolve(server) };
}

function via<T, I>(scope: Scope.Handle, op: Operation.Handle<T, I>, input: I) {
  return scope.session((s) => s.run(op, { input }));
}

function readEvents(text: string): { kind: string; [key: string]: unknown }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()));
}

test("the draft helper is off by default and needs no account", async () => {
  const path = await cloneDatabase();
  const booted = await boot(path);
  const app = booted.app;
  try {
    const capability = await app.request("/api/draft");
    expect(capability.status).toBe(200);
    expect(await capability.json()).toEqual({ enabled: false });

    const created = await via(booted.scope, createIssue, {
      title: "Plain",
      description: "no helper",
    });
    const refused = await app.request(`/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(404);
    const detail = await booted.scope.run(readDetail, { input: created.id });
    expect(detail.comments).toEqual([]);
    expect(detail.activity.length).toBe(1);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("a draft streams text and finishes without saving anything", async () => {
  const heard = await reservePort();
  const path = await cloneDatabase();
  const booted = await boot(path);
  const created = await via(booted.scope, createIssue, {
    title: "Streamed",
    description: "read me",
  });
  await via(booted.scope, addComment, {
    issueId: created.id,
    author: "Lin",
    text: "Discuss this.",
  });
  const before = await booted.scope.run(readDetail, { input: created.id });
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "A short summary." }]);
  const live = await boot(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(live.app);
  try {
    const res = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");
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
    expect(seen.at(-1)).toEqual({
      kind: "terminal",
      status: "done",
      draft: "A short summary.",
    });
    const published = live.scope.resolve(issueList);
    expect(await live.scope.run(readDetail, { input: created.id })).toEqual(before);
    expect(live.scope.resolve(issueList)).toBe(published);
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
  const path = await cloneDatabase();
  const booted = await boot(path);
  const created = await via(booted.scope, createIssue, { title: "Post me", description: "v1" });
  const before = await booted.scope.run(readDetail, { input: created.id });
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "Post this draft." }]);
  const live = await boot(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(live.app);
  try {
    const generated = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const seen = readEvents(await generated.text());
    const terminal = seen.at(-1);
    if (terminal === undefined || terminal.kind !== "terminal") {
      throw fail("DraftFailed", { reason: "expected a finished draft" });
    }
    expect(terminal.status).toBe("done");
    const posted = await fetch(`${heard.base}/api/issues/${created.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "Ada", text: terminal.draft }),
    });
    expect(posted.status).toBe(201);
    const comment = parseComment(await posted.json());
    expect(comment.text).toBe(terminal.draft);
    const after = await live.scope.run(readDetail, { input: created.id });
    expect(after.issue).toEqual({ ...before.issue, updatedAt: comment.createdAt });
    expect(after.comments).toEqual([...before.comments, comment]);
    expect(after.activity.map((entry) => entry.kind)).toEqual([
      ...before.activity.map((entry) => entry.kind),
      "commented",
    ]);
    expect(after.activity.at(-1)?.summary).toBe("Ada commented");
  } finally {
    await live.scope.close({ graceful: true });
    await heard.stop();
  }
});

test("a model error result and a thrown model error both fail without a draft", async () => {
  for (const script of [{ errorResult: true }, { fail: true }]) {
    const heard = await reservePort();
    const path = await cloneDatabase();
    const booted = await boot(path);
    const created = await via(booted.scope, createIssue, { title: "Failing", description: "v1" });
    const before = await booted.scope.run(readDetail, { input: created.id });
    await booted.scope.close({ graceful: true });
    const fixture = readDraftServer([{ id: created.id, text: "never shown", ...script }]);
    const lines: Observe.Log[] = [];
    const live = await boot(path, {
      draft: { enabled: true, baseUrl: heard.base },
      presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
      observe: { log: (entry) => lines.push(entry) },
    });
    heard.serve(live.app);
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
      expect(await live.scope.run(readDetail, { input: created.id })).toEqual(before);
      const logged = lines.filter((line) => line.message === "draft failed");
      expect(logged).toHaveLength(1);
      expect(logged[0]?.attributes).toMatchObject({ id: created.id });
      expect(typeof logged[0]?.attributes.error).toBe("string");
    } finally {
      await live.scope.close({ graceful: true });
      await heard.stop();
    }
  }
});

test("a draft for a missing issue answers gone and runs no model", async () => {
  const fixture = readDraftServer([{ text: "never used" }]);
  const path = await cloneDatabase();
  const booted = await boot(path, {
    draft: { enabled: true, baseUrl: "http://127.0.0.1:1" },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = booted.app;
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

test("a draft prompt that is not text answers 400 and runs no model", async () => {
  const fixture = readDraftServer([{ text: "never used" }]);
  const path = await cloneDatabase();
  const booted = await boot(path, {
    draft: { enabled: true, baseUrl: "http://127.0.0.1:1" },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  try {
    const created = await via(booted.scope, createIssue, { title: "Asked", description: "x" });
    const res = await booted.app.request(`/api/issues/${created.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: 42 }),
    });
    expect(res.status).toBe(400);
    expect(fixture.turnCount()).toBe(0);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("parseDraftInput raises BadDraftInput for a prompt that is not text", () => {
  try {
    parseDraftInput({ id: "i1", prompt: null });
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "BadDraftInput")) throw error;
    expect(error.payload.reason).toBe("prompt must be text");
  }
  expect(parseDraftInput({ id: "i1" })).toEqual({ id: "i1", prompt: "" });
  expect(parseDraftInput({ id: "i1", prompt: " " })).toEqual({ id: "i1", prompt: " " });
});

test("an aborted caller runs no model turn", async () => {
  const fixture = readDraftServer([{ text: "never used" }]);
  const path = await cloneDatabase();
  const booted = await boot(path, {
    draft: { enabled: true, baseUrl: "http://127.0.0.1:1" },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = booted.app;
  try {
    const stopper = new AbortController();
    stopper.abort();
    const res = await app.request("/api/issues/missing-id/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      signal: stopper.signal,
    });
    expect([404, 499].includes(res.status)).toBe(true);
    expect(fixture.turnCount()).toBe(0);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("ordinary saves continue while a draft turn holds", async () => {
  const heard = await reservePort();
  const path = await cloneDatabase();
  const booted = await boot(path);
  const created = await via(booted.scope, createIssue, { title: "Held", description: "v1" });
  const before = await booted.scope.run(readDetail, { input: created.id });
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "Held draft.", hold: true }]);
  const live = await boot(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(live.app);
  const tracked = (async () => {
    try {
      const res = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      return { events: readEvents(await res.text()) };
    } catch (error: unknown) {
      return { error };
    }
  })();
  try {
    await fixture.started();
    const other = await via(live.scope, createIssue, {
      title: "Concurrent",
      description: "no block",
    });
    expect(other.title).toBe("Concurrent");
    fixture.release();
    const seen = await tracked;
    if ("error" in seen) throw seen.error;
    expect(seen.events.at(-1)).toEqual({ kind: "terminal", status: "done", draft: "Held draft." });
    expect(
      parseIssueDetail(await (await fetch(`${heard.base}/api/issues/${created.id}`)).json()),
    ).toEqual(before);
  } finally {
    fixture.release();
    await live.scope.close();
    await heard.stop();
    await tracked;
  }
});

test("an HTTP disconnect cancels the model and saves nothing", async () => {
  const heard = await reservePort();
  const path = await cloneDatabase();
  const booted = await boot(path);
  const created = await via(booted.scope, createIssue, { title: "Held cancel", description: "v1" });
  const before = await booted.scope.run(readDetail, { input: created.id });
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "never finishes", hold: true }]);
  const live = await boot(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(live.app);
  const stopper = new AbortController();
  const tracked = (async () => {
    try {
      const res = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        signal: stopper.signal,
      });
      return { text: await res.text() };
    } catch (error: unknown) {
      return { error };
    }
  })();
  try {
    await fixture.started();
    stopper.abort();
    const end = await tracked;
    if ("text" in end) throw fail("DraftFailed", { reason: "disconnect settled a body" });
    await fixture.aborted();
    const detail = await live.scope.run(readDetail, { input: created.id });
    expect(detail).toEqual(before);
    expect(fixture.turnCount()).toBe(1);
  } finally {
    stopper.abort();
    fixture.release();
    await live.scope.close();
    await heard.stop();
    await tracked;
  }
});

test("root close with a live caller aborts the model and settles cancelled", async () => {
  const heard = await reservePort();
  const path = await cloneDatabase();
  const booted = await boot(path);
  const created = await via(booted.scope, createIssue, { title: "Held root", description: "v1" });
  const before = await booted.scope.run(readDetail, { input: created.id });
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([{ id: created.id, text: "never finishes", hold: true }]);
  const live = await boot(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(live.app);
  const caller = new AbortController();
  const tracked = (async () => {
    try {
      const res = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        signal: caller.signal,
      });
      return { text: await res.text() };
    } catch (error: unknown) {
      return { error };
    }
  })();
  try {
    await fixture.started();
    expect(caller.signal.aborted).toBe(false);
    const closing = live.scope.close();
    await fixture.aborted();
    const closed = await closing;
    expect(closed.teardownErrors ?? []).toEqual([]);
    expect(closed.status).toBe("cancelled");
    const end = await tracked;
    if ("text" in end && end.text !== undefined) {
      const seen = readEvents(end.text);
      expect(seen.some((event) => event.kind === "done")).toBe(false);
    }
    const restarted = await boot(path);
    try {
      expect(await restarted.scope.run(readDetail, { input: created.id })).toEqual(before);
    } finally {
      await restarted.scope.close({ graceful: true });
    }
  } finally {
    caller.abort();
    fixture.release();
    await live.scope.close();
    await heard.stop();
    await tracked;
  }
});

test("overlapping drafts on two issues stay isolated through one live app", async () => {
  const heard = await reservePort();
  const path = await cloneDatabase();
  const booted = await boot(path);
  const one = await via(booted.scope, createIssue, { title: "One", description: "v1" });
  const two = await via(booted.scope, createIssue, { title: "Two", description: "v1" });
  await booted.scope.close({ graceful: true });
  const fixture = readDraftServer([
    { id: one.id, text: "First held draft.", hold: true },
    { id: two.id, text: "Second draft." },
  ]);
  const live = await boot(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(live.app);
  const firstFlight = new AbortController();
  const tracked = (async () => {
    try {
      const res = await fetch(`${heard.base}/api/issues/${one.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        signal: firstFlight.signal,
      });
      return { events: readEvents(await res.text()) };
    } catch (error: unknown) {
      return { error };
    }
  })();
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
    expect(secondSeen.at(-1)).toEqual({
      kind: "terminal",
      status: "done",
      draft: "Second draft.",
    });
    fixture.release();
    const first = await tracked;
    if ("error" in first) throw first.error;
    const firstSeen = first.events;
    expect(
      firstSeen
        .filter((event) => event.kind === "text")
        .map((event) => event.text)
        .join(""),
    ).toBe("First held draft.");
    expect(firstSeen.at(-1)).toEqual({
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
    await tracked;
  }
});

test("startDraft runs without Hono: off answers DraftOff, a missing issue answers gone", async () => {
  const path = await cloneDatabase();
  const booted = await boot(path);
  const live = await boot(path, { draft: { enabled: true, baseUrl: "http://127.0.0.1:1" } });
  try {
    const created = await via(booted.scope, createIssue, { title: "Seam", description: "v1" });
    try {
      await booted.scope.session((s) =>
        s.run(startDraft, { input: { id: created.id, prompt: "" } }),
      );
      throw fail("DraftFailed", { reason: "expected DraftOff" });
    } catch (error: unknown) {
      if (!isError(error, "DraftOff")) throw error;
    }
    try {
      await live.scope.session((s) =>
        s.run(startDraft, { input: { id: "missing-id", prompt: "" } }),
      );
      throw fail("DraftFailed", { reason: "expected IssueNotFound" });
    } catch (error: unknown) {
      if (!isError(error, "IssueNotFound")) throw error;
    }
  } finally {
    await live.scope.close({ graceful: true });
    await booted.scope.close({ graceful: true });
  }
});
