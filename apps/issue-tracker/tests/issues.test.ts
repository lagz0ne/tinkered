import { createScope, type Operation, type Scope } from "@tinker/core";
import { hono, route } from "@tinker/hono";
import { memoryPair, subscribe, sync } from "@tinker/sync";
import {
  addComment,
  createApp,
  createIssue,
  editIssue,
  isError,
  issueList,
  listIssues,
  parseIssueList,
  publishIssues,
  readDetail,
  readIssues,
  store,
} from "../src/index.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "issues-")), "db");
}

async function boot(): Promise<Awaited<ReturnType<typeof createApp>>> {
  return createApp({ dataPath: tempPath() });
}

function save<T, I>(scope: Scope.Handle, op: Operation.Handle<T, I>, input: I) {
  return scope.session((s) => s.run(op, { input }));
}

function detail(scope: Scope.Handle, id: string) {
  return scope.run(readDetail, { input: id });
}

test("a session save commits a row the root list read sees", async () => {
  const scope = createScope({ tags: [store.config(undefined)] });
  try {
    await scope.session((s) => s.run(createIssue, { input: { title: "First", description: "x" } }));
    const all = await scope.run(listIssues);
    expect(all.map((i) => i.title)).toEqual(["First"]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("creating a valid issue saves it and a second viewer sees it", async () => {
  const { scope, src } = await boot();
  const [near, far] = memoryPair();
  const served = scope.resolve(src).connect(near);
  const sub = subscribe(far);
  const guest = createScope({ tags: [sync(issueList)], extensions: [sub] });
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
    await served;
    await guest.close({ graceful: true });
    await scope.close({ graceful: true });
  }
});

test("reopening against the same database restores the saved issue", async () => {
  const path = tempPath();
  const first = await createApp({ dataPath: path });
  try {
    await save(first.scope, createIssue, { title: "Kept", description: "survives restart" });
  } finally {
    await first.scope.close({ graceful: true });
  }

  const second = await createApp({ dataPath: path });
  try {
    expect(second.scope.resolve(issueList).length).toBe(1);
    expect(second.scope.resolve(issueList)[0]?.title).toBe("Kept");
  } finally {
    await second.scope.close({ graceful: true });
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

test("one row plus one extension answers a read with no composition root", async () => {
  const web = hono({ routes: [route.get("/api/issues", () => readIssues)] });
  const scope = createScope({
    tags: [store.config(undefined)],
    extensions: [web],
  });
  try {
    await scope.ready;
    const res = await scope.resolve(web).request("/api/issues");
    expect(res.status).toBe(200);
    expect(parseIssueList(await res.json())).toEqual([]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("publishAfterCommit republishes after a POST and keeps the cell on a 400", async () => {
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
  const { scope, src } = await boot();
  const [near, far] = memoryPair();
  const served = scope.resolve(src).connect(near);
  const sub = subscribe(far);
  const guest = createScope({ tags: [sync(issueList)], extensions: [sub] });
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
    await served;
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
  const first = await createApp({ dataPath: path });
  try {
    const created = await save(first.scope, createIssue, { title: "Kept talk", description: "v1" });
    await save(first.scope, editIssue, {
      id: created.id,
      baseRevision: created.revision,
      status: "done",
      assignee: "Sam",
    });
    await save(first.scope, addComment, { issueId: created.id, author: "Ada", text: "Shipped" });
  } finally {
    await first.scope.close({ graceful: true });
  }

  const second = await createApp({ dataPath: path });
  try {
    const issues = await second.scope.run(listIssues);
    const found = await detail(second.scope, issues[0]?.id ?? "");
    expect(found.issue.status).toBe("done");
    expect(found.issue.assignee).toBe("Sam");
    expect(found.issue.revision).toBe(1);
    expect(found.comments.length).toBe(1);
    expect(found.comments[0]?.text).toBe("Shipped");
    expect(found.activity.length).toBe(3);
  } finally {
    await second.scope.close({ graceful: true });
  }
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

test("a register for a gone tab answers gone and a bad message answers bad", async () => {
  const { scope, app } = await boot();
  try {
    const gone = await app.request("/sync?client=nobody", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "register", keys: [] }),
    });
    expect(gone.status).toBe(410);

    const bad = await app.request("/sync?client=nobody", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "register", keys: [42] }),
    });
    expect(bad.status).toBe(400);
  } finally {
    await scope.close({ graceful: true });
  }
});
