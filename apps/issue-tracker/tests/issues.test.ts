import { createScope } from "@tinker/core";
import { memoryPair, subscribe, sync } from "@tinker/sync";
import {
  bootScope,
  buildApp,
  isError,
  issueList,
  listIssues,
  parseIssueList,
} from "../src/index.ts";
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

    const saved = await booted.save.create({ title: "First", description: "hello" });
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
    await first.save.create({ title: "Kept", description: "survives restart" });
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

test("an edit saves with the opened revision and records activity", async () => {
  const booted = await bootScope(tempPath());
  try {
    const created = await booted.save.create({ title: "Draft", description: "v1" });
    const updated = await booted.save.edit({
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

    const detail = await booted.detail(created.id);
    expect(detail.issue.title).toBe("Final");
    expect(detail.activity.length).toBe(2);
    expect(detail.activity[0]?.kind).toBe("created");
    expect(detail.activity[1]?.kind).toBe("edited");

    const cleared = await booted.save.edit({
      id: created.id,
      baseRevision: updated.revision,
      assignee: null,
    });
    expect(cleared.assignee).toBe(null);
    expect(cleared.revision).toBe(updated.revision + 1);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("a stale edit is rejected with the current saved issue and writes nothing", async () => {
  const booted = await bootScope(tempPath());
  try {
    const created = await booted.save.create({ title: "Race", description: "v1" });
    const first = await booted.save.edit({
      id: created.id,
      baseRevision: created.revision,
      title: "Winner",
    });
    expect(first.revision).toBe(1);

    let current: unknown;
    try {
      await booted.save.edit({ id: created.id, baseRevision: 0, title: "Loser" });
    } catch (error: unknown) {
      if (!isError(error, "IssueConflict")) throw error;
      expect(error.payload.currentRevision).toBe(1);
      current = error.payload.current;
    }
    expect(current).toMatchObject({ id: created.id, title: "Winner", revision: 1 });

    const detail = await booted.detail(created.id);
    expect(detail.issue.title).toBe("Winner");
    expect(detail.issue.revision).toBe(1);
    expect(detail.activity.length).toBe(2);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("comments append without a revision and show with activity", async () => {
  const booted = await bootScope(tempPath());
  try {
    const created = await booted.save.create({ title: "Talk", description: "discuss" });
    const comment = await booted.save.comment({
      issueId: created.id,
      author: "Lin",
      text: "Looks good",
    });
    expect(comment.author).toBe("Lin");
    expect(comment.text).toBe("Looks good");
    expect(comment.createdAt).toBeGreaterThan(1_700_000_000_000);

    const detail = await booted.detail(created.id);
    expect(detail.issue.revision).toBe(0);
    expect(detail.comments.length).toBe(1);
    expect(detail.comments[0]?.text).toBe("Looks good");
    expect(detail.activity.length).toBe(2);
    expect(detail.activity[1]?.kind).toBe("commented");
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("two back-to-back comments both survive in the detail", async () => {
  const booted = await bootScope(tempPath());
  try {
    const created = await booted.save.create({ title: "Fast talk", description: "v1" });
    await booted.save.comment({ issueId: created.id, author: "Ada", text: "first" });
    await booted.save.comment({ issueId: created.id, author: "Lin", text: "second" });
    const detail = await booted.detail(created.id);
    expect(detail.comments.length).toBe(2);
    expect(detail.comments.map((comment) => comment.text).sort()).toEqual(["first", "second"]);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("a stale edit publishes no new snapshot to a live viewer", async () => {
  const booted = await bootScope(tempPath());
  const { scope, src } = booted;
  const [near, far] = memoryPair();
  const served = scope.resolve(src).connect(near);
  const sub = subscribe(far);
  const guest = createScope({ tags: [sync(issueList)], extensions: [sub] });
  try {
    await guest.ready;
    const created = await booted.save.create({ title: "Watched", description: "v1" });
    expect(guest.resolve(issueList).length).toBe(1);
    const before = guest.resolve(issueList);
    try {
      await booted.save.edit({ id: created.id, baseRevision: 41, title: "Stale" });
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
  const booted = await bootScope(tempPath());
  const app = buildApp(booted);
  try {
    const created = await booted.save.create({ title: "Quiet", description: "no noise" });
    const rejected = await app.request(`/api/issues/${created.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "Nope", text: "junk" }),
    });
    expect(rejected.status).toBe(400);
    const detail = await booted.detail(created.id);
    expect(detail.comments).toEqual([]);
    expect(detail.activity.length).toBe(1);
  } finally {
    await booted.scope.close({ graceful: true });
  }
});

test("edited details, comments, and activity survive a restart", async () => {
  const path = tempPath();
  const first = await bootScope(path);
  try {
    const created = await first.save.create({ title: "Kept talk", description: "v1" });
    await first.save.edit({
      id: created.id,
      baseRevision: created.revision,
      status: "done",
      assignee: "Sam",
    });
    await first.save.comment({ issueId: created.id, author: "Ada", text: "Shipped" });
  } finally {
    await first.scope.close({ graceful: true });
  }

  const second = await bootScope(path);
  try {
    const issues = await second.scope.run(listIssues);
    const detail = await second.detail(issues[0]?.id ?? "");
    expect(detail.issue.status).toBe("done");
    expect(detail.issue.assignee).toBe("Sam");
    expect(detail.issue.revision).toBe(1);
    expect(detail.comments.length).toBe(1);
    expect(detail.comments[0]?.text).toBe("Shipped");
    expect(detail.activity.length).toBe(3);
  } finally {
    await second.scope.close({ graceful: true });
  }
});

test("the detail and conflict routes answer through app.request", async () => {
  const booted = await bootScope(tempPath());
  const app = buildApp(booted);
  try {
    const created = await booted.save.create({ title: "Routed", description: "v1" });

    const detail = await app.request(`/api/issues/${created.id}`);
    expect(detail.status).toBe(200);

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
    await booted.scope.close({ graceful: true });
  }
});
