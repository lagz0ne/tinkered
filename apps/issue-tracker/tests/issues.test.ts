import { cloneDatabase } from "./database.ts";
import {
  createScope,
  makeTestRandom,
  originOf,
  preset,
  resource,
  type Observe,
  type Operation,
  type Scope,
} from "@tinker/core";
import { hono, route, type HonoScope } from "@tinker/hono";
import { memoryPair, subscribe } from "@tinker/sync";
import {
  addComment,
  createIssue,
  editIssue,
  fail,
  isError,
  issueList,
  listIssues,
  parseIssueList,
  parseIssue,
  publishIssues,
  readDetail,
  readIssues,
  publish,
  recordActivity,
  src,
  storeConfig,
  migrateIssues,
  issueServer,
  type Issues,
} from "../src/index.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "issues-")), "db");
}

type Boot = {
  readonly observe?: Observe.Config;
  readonly presets?: readonly Scope.Preset[];
  readonly serve?: HonoScope.Serve;
};

/** This file's full root: every server part, as `main.ts` lists them. A test
 * that needs less builds its own smaller root. */
async function boot(options: Boot = {}) {
  const server = issueServer({ serve: options.serve });
  const scope = createScope({
    tags: [storeConfig({ kind: "borrow", ...(await cloneDatabase()) })],
    extensions: [server, migrateIssues, src, publish()],
    presets: options.presets,
    observe: options.observe,
  });
  await scope.ready;
  return { scope, app: scope.resolve(server) };
}

function save<T, I>(scope: Scope.Handle, op: Operation.Handle<T, I>, input: I) {
  return scope.session((s) => s.run(op, { input }));
}

function detail(scope: Scope.Handle, id: string) {
  return scope.run(readDetail, { input: id });
}

test("a session save commits a row the root list read sees", async () => {
  const scope = createScope({
    tags: [storeConfig({ kind: "borrow", ...(await cloneDatabase()) })],
  });
  try {
    await scope.session((s) => s.run(createIssue, { input: { title: "First", description: "x" } }));
    const all = await scope.run(listIssues);
    expect(all.map((i) => i.title)).toEqual(["First"]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a seeded random replays the same issue, comment, and activity ids", async () => {
  async function ids(): Promise<readonly string[]> {
    const scope = createScope({
      tags: [storeConfig({ kind: "borrow", ...(await cloneDatabase()) })],
      random: makeTestRandom({ seed: 7 }),
    });
    try {
      const created = await save(scope, createIssue, { title: "Ids", description: "x" });
      const comment = await save(scope, addComment, {
        issueId: created.id,
        author: "Ada",
        text: "hi",
      });
      const found = await detail(scope, created.id);
      return [created.id, comment.id, ...found.activity.map((row) => row.id)];
    } finally {
      await scope.close({ graceful: true });
    }
  }
  const first = await ids();
  expect(first.length).toBe(4);
  expect(new Set(first).size).toBe(4);
  expect(await ids()).toEqual(first);
});

test("creating a valid issue saves it and a second viewer sees it", async () => {
  const { scope } = await boot();
  const [near, far] = memoryPair();
  const served = scope.resolve(src).connect(near);
  const pipe = resource({ label: "pipe", factory: () => far });
  const sub = subscribe(pipe, { cells: [[issueList, "issues"]] });
  const guest = createScope({ extensions: [sub] });
  try {
    await guest.ready;
    expect(guest.resolve(issueList)).toEqual([]);

    const saved = await save(scope, createIssue, { title: "First", description: "hello" });
    expect(saved.title).toBe("First");
    await scope.run(publishIssues);
    expect(guest.resolve(issueList).length).toBe(1);
    expect(guest.resolve(issueList)[0]?.title).toBe("First");
  } finally {
    guest.resolve(sub).close();
    expect((await served).status).toBe("success");
    await guest.close({ graceful: true });
    await scope.close({ graceful: true });
  }
});

test("reopening against the same database restores the saved issue", async () => {
  const path = tempPath();
  const first = createScope({
    tags: [storeConfig({ kind: "open", url: path })],
    extensions: [migrateIssues],
  });
  await first.ready;
  try {
    await save(first, createIssue, { title: "Kept", description: "survives restart" });
  } finally {
    await first.close({ graceful: true });
  }

  const second = createScope({
    tags: [storeConfig({ kind: "open", url: path })],
    extensions: [migrateIssues, publish()],
  });
  try {
    await second.ready;
    expect(second.resolve(issueList).length).toBe(1);
    expect(second.resolve(issueList)[0]?.title).toBe("Kept");
  } finally {
    await second.close({ graceful: true });
  }
});

test("the HTTP routes save through app.request", async () => {
  const { scope, app } = await boot();
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

test("a failed activity write rolls back the request's issue insert", async () => {
  const { scope, app } = await boot({
    presets: [
      preset(recordActivity, () => {
        throw fail("BadCreateInput", { reason: "activity write rejected" });
      }),
    ],
  });
  try {
    const response = await app.request("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Rolled back", description: "activity failed" }),
    });
    expect(response.status).toBe(400);
    expect(await scope.run(listIssues)).toEqual([]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a route reads the published list without a database", async () => {
  const saved = parseIssue({
    id: "published",
    title: "Already published",
    description: "no database",
    status: "open",
    assignee: null,
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  });
  const { extension: web } = hono([route.get("/api/issues", readIssues)]);
  const scope = createScope({
    extensions: [web],
    presets: [preset(issueList, [saved])],
  });
  try {
    await scope.ready;
    const res = await scope.resolve(web).request("/api/issues");
    expect(res.status).toBe(200);
    expect(parseIssueList(await res.json())).toEqual([saved]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("publish republishes after a POST and keeps the cell on a 400 or a GET", async () => {
  const { scope, app } = await boot();
  try {
    const before = scope.resolve(issueList);
    const rejected = await app.request("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "", description: "x" }),
    });
    expect(rejected.status).toBe(400);
    expect(scope.resolve(issueList)).toBe(before);

    const saved = await app.request("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hooked", description: "via hook" }),
    });
    expect(saved.status).toBe(201);
    expect(scope.resolve(issueList).map((i) => i.title)).toEqual(["Hooked"]);
    expect(scope.resolve(issueList)).not.toBe(before);

    const published = scope.resolve(issueList);
    await save(scope, createIssue, { title: "Quiet", description: "no request" });
    const listed = await app.request("/api/issues");
    expect(listed.status).toBe(200);
    expect(scope.resolve(issueList)).toBe(published);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("an edit saves with the opened revision and records activity", async () => {
  const { scope } = await boot();
  try {
    const created = await save(scope, createIssue, { title: "Draft", description: "v1" });
    const updated = await save(scope, editIssue, {
      id: created.id,
      baseRevision: created.revision,
      title: "Final",
      status: "in_progress",
      assignee: "Ada",
    });
    expect(updated.title).toBe("Final");
    expect(updated.status).toBe("in_progress");
    expect(updated.assignee).toBe("Ada");
    expect(updated.revision).toBe(created.revision + 1);

    const found = await detail(scope, created.id);
    expect(found.issue.title).toBe("Final");
    expect(found.activity.length).toBe(2);
    expect(found.activity[0]?.kind).toBe("created");
    expect(found.activity[1]?.kind).toBe("edited");

    const cleared = await save(scope, editIssue, {
      id: created.id,
      baseRevision: updated.revision,
      assignee: null,
    });
    expect(cleared.assignee).toBe(null);
    expect(cleared.revision).toBe(updated.revision + 1);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a stale edit is rejected with the current saved issue and writes nothing", async () => {
  const { scope } = await boot();
  try {
    const created = await save(scope, createIssue, { title: "Race", description: "v1" });
    const first = await save(scope, editIssue, {
      id: created.id,
      baseRevision: created.revision,
      title: "Winner",
    });
    expect(first.revision).toBe(1);

    let current: unknown;
    try {
      await save(scope, editIssue, { id: created.id, baseRevision: 0, title: "Loser" });
    } catch (error: unknown) {
      if (!isError(error, "IssueConflict")) throw error;
      expect(error.payload.currentRevision).toBe(1);
      current = error.payload.current;
    }
    expect(current).toMatchObject({ id: created.id, title: "Winner", revision: 1 });

    const found = await detail(scope, created.id);
    expect(found.issue.title).toBe("Winner");
    expect(found.issue.revision).toBe(1);
    expect(found.activity.length).toBe(2);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("an edit of a missing issue fails with an origin that names the loadSaved step", async () => {
  const scope = createScope({
    tags: [storeConfig({ kind: "borrow", ...(await cloneDatabase()) })],
  });
  try {
    let origin: ReturnType<typeof originOf>;
    try {
      await save(scope, editIssue, { id: "gone", baseRevision: 0, title: "x" });
    } catch (error: unknown) {
      if (!isError(error, "IssueNotFound")) throw error;
      origin = originOf(error);
    }
    expect(origin?.label).toBe("loadSaved");
    expect(origin?.path.slice(-2)).toEqual(["editIssue", "loadSaved"]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a preset recordActivity receives every activity write a create and an edit make", async () => {
  const written: Issues.Activity[] = [];
  const scope = createScope({
    tags: [storeConfig({ kind: "borrow", ...(await cloneDatabase()) })],
    presets: [
      preset(recordActivity, async (_deps, ctx) => {
        written.push(ctx.input);
      }),
    ],
  });
  try {
    const created = await save(scope, createIssue, { title: "Draft", description: "v1" });
    await save(scope, editIssue, { id: created.id, baseRevision: 0, title: "Final" });
    expect(written.map((row) => [row.issueId, row.kind, row.summary])).toEqual([
      [created.id, "created", "created"],
      [created.id, "edited", "edited title"],
    ]);
    expect((await detail(scope, created.id)).activity).toEqual([]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("two concurrent edits on one revision settle exactly one winner", async () => {
  const { scope, app } = await boot();
  try {
    const created = await save(scope, createIssue, { title: "Race", description: "v1" });
    const request = {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: created.revision, title: "Winner" }),
    };
    const [one, two] = await Promise.all([
      app.request(`/api/issues/${created.id}`, request),
      app.request(`/api/issues/${created.id}`, request),
    ]);
    expect([one.status, two.status].sort((a, b) => a - b)).toEqual([200, 409]);

    const found = await detail(scope, created.id);
    expect(found.issue.revision).toBe(1);
    expect(found.activity.length).toBe(2);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("comments append without a revision and show with activity", async () => {
  const { scope } = await boot();
  try {
    const created = await save(scope, createIssue, { title: "Talk", description: "discuss" });
    const comment = await save(scope, addComment, {
      issueId: created.id,
      author: "Lin",
      text: "Looks good",
    });
    expect(comment.author).toBe("Lin");
    expect(comment.text).toBe("Looks good");
    expect(comment.createdAt).toBeGreaterThan(1_700_000_000_000);

    const found = await detail(scope, created.id);
    expect(found.issue.revision).toBe(0);
    expect(found.comments.length).toBe(1);
    expect(found.comments[0]?.text).toBe("Looks good");
    expect(found.activity.length).toBe(2);
    expect(found.activity[1]?.kind).toBe("commented");
  } finally {
    await scope.close({ graceful: true });
  }
});

test("two back-to-back comments both survive in the detail", async () => {
  const { scope } = await boot();
  try {
    const created = await save(scope, createIssue, { title: "Fast talk", description: "v1" });
    await save(scope, addComment, { issueId: created.id, author: "Ada", text: "first" });
    await save(scope, addComment, { issueId: created.id, author: "Lin", text: "second" });
    const found = await detail(scope, created.id);
    expect(found.comments.length).toBe(2);
    expect(found.comments.map((comment) => comment.text).sort()).toEqual(["first", "second"]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a stale edit publishes no new snapshot to a live viewer", async () => {
  const { scope } = await boot();
  const [near, far] = memoryPair();
  const served = scope.resolve(src).connect(near);
  const pipe = resource({ label: "pipe", factory: () => far });
  const sub = subscribe(pipe, { cells: [[issueList, "issues"]] });
  const guest = createScope({ extensions: [sub] });
  try {
    await guest.ready;
    const created = await save(scope, createIssue, { title: "Watched", description: "v1" });
    await scope.run(publishIssues);
    expect(guest.resolve(issueList).length).toBe(1);
    const before = guest.resolve(issueList);
    try {
      await save(scope, editIssue, { id: created.id, baseRevision: 41, title: "Stale" });
    } catch (error: unknown) {
      if (!isError(error, "IssueConflict")) throw error;
    }
    expect(guest.resolve(issueList)).toBe(before);
    expect(guest.resolve(issueList)[0]?.title).toBe("Watched");
    expect(guest.resolve(issueList)[0]?.revision).toBe(0);
  } finally {
    guest.resolve(sub).close();
    expect((await served).status).toBe("success");
    await guest.close({ graceful: true });
    await scope.close({ graceful: true });
  }
});

test("a rejected comment writes nothing and records no activity", async () => {
  const { scope, app } = await boot();
  try {
    const created = await save(scope, createIssue, { title: "Quiet", description: "no noise" });
    const rejected = await app.request(`/api/issues/${created.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "Nope", text: "junk" }),
    });
    expect(rejected.status).toBe(400);
    const found = await detail(scope, created.id);
    expect(found.comments).toEqual([]);
    expect(found.activity.length).toBe(1);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("edited details, comments, and activity survive a restart", async () => {
  const path = tempPath();
  const first = createScope({
    tags: [storeConfig({ kind: "open", url: path })],
    extensions: [migrateIssues],
  });
  await first.ready;
  try {
    const created = await save(first, createIssue, { title: "Kept talk", description: "v1" });
    await save(first, editIssue, {
      id: created.id,
      baseRevision: created.revision,
      status: "done",
      assignee: "Sam",
    });
    await save(first, addComment, { issueId: created.id, author: "Ada", text: "Shipped" });
  } finally {
    await first.close({ graceful: true });
  }

  const second = createScope({
    tags: [storeConfig({ kind: "open", url: path })],
    extensions: [migrateIssues],
  });
  await second.ready;
  try {
    const issues = await second.run(listIssues);
    const found = await detail(second, issues[0]?.id ?? "");
    expect(found.issue.status).toBe("done");
    expect(found.issue.assignee).toBe("Sam");
    expect(found.issue.revision).toBe(1);
    expect(found.comments.length).toBe(1);
    expect(found.comments[0]?.text).toBe("Shipped");
    expect(found.activity.length).toBe(3);
  } finally {
    await second.close({ graceful: true });
  }
});

test("a publish that fails after the commit keeps the 201, saves the row, and logs one line", async () => {
  const lines: Observe.Log[] = [];
  let publishes = 0;
  const { scope, app } = await boot({
    observe: { log: (entry) => lines.push(entry) },
    presets: [
      preset(publishIssues, async () => {
        publishes += 1;
        if (publishes > 1) throw new Error("read after commit broke");
      }),
    ],
  });
  try {
    const res = await app.request("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Saved anyway", description: "x" }),
    });
    expect(res.status).toBe(201);
    expect((await scope.run(listIssues)).map((i) => i.title)).toEqual(["Saved anyway"]);
    const failed = lines.filter((line) => line.message === "publish failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.attributes).toMatchObject({ error: "read after commit broke" });
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a failed boot rejects and never opens the port", async () => {
  let binds = 0;
  const failure = new Error("saved list would not load");
  let failed: unknown;
  try {
    await boot({
      serve: () => {
        binds += 1;
      },
      presets: [
        preset(publishIssues, async () => {
          throw failure;
        }),
      ],
    });
  } catch (error: unknown) {
    failed = error;
  }
  expect(failed).toBe(failure);
  expect(binds).toBe(0);
});

test("the detail and conflict routes answer through app.request", async () => {
  const { scope, app } = await boot();
  try {
    const created = await save(scope, createIssue, { title: "Routed", description: "v1" });

    const found = await app.request(`/api/issues/${created.id}`);
    expect(found.status).toBe(200);

    const edited = await app.request(`/api/issues/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: created.revision, status: "in_progress" }),
    });
    expect(edited.status).toBe(200);

    const stale = await app.request(`/api/issues/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: created.revision, title: "Late" }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ currentRevision: 1 });

    const commented = await app.request(`/api/issues/${created.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "Sam", text: "On it" }),
    });
    expect(commented.status).toBe(201);

    const again = await app.request(`/api/issues/${created.id}`);
    expect(again.status).toBe(200);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a sync GET with keys registers and streams each key's snapshot after the retry frame", async () => {
  const { scope, app } = await boot();
  const res = await app.request("/sync?keys=issues");
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    while (reader !== undefined && !text.includes("\n\ndata: ")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toBe(
      `retry: 1000\n\ndata: ${JSON.stringify({ type: "snapshot", key: "issues", version: 0, value: [] })}\n\n`,
    );
  } finally {
    await reader?.cancel();
    await scope.close({ graceful: true });
  }
});

test("a sync GET with no keys or an unknown key answers 400 before any stream", async () => {
  const { scope, app } = await boot();
  try {
    expect((await app.request("/sync")).status).toBe(400);
    expect((await app.request("/sync?keys=issues&keys=nope")).status).toBe(400);
  } finally {
    await scope.close({ graceful: true });
  }
});
