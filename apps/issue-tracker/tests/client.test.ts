import { setImmediate as nextTurn } from "node:timers/promises";
import { createScope, extension, preset } from "@tinker/core";
import { isError as isSyncError, subscribe } from "@tinker/sync";
import { expect, test } from "vite-plus/test";
import {
  api,
  beginDraft,
  capability,
  checkCapability,
  commentDraft,
  connection,
  detail,
  discardDraft,
  draftCapability,
  detailRefresh,
  draftRun,
  drafter,
  editDraft,
  fail,
  getCapability,
  getDetail,
  isError,
  issueList,
  loadDetail,
  newIssue,
  openDraft,
  openSource,
  patchIssue,
  postComment,
  postDraft,
  postIssue,
  reconnect,
  saveEdit,
  selectIssue,
  submitComment,
  submitNewIssue,
  typeComment,
  typeEdit,
  typeNewIssue,
  wire,
  type Issues,
  type Wire,
} from "../src/index.ts";

/** Every test presets the endpoint node it needs (`postIssue`, `getDetail`, …) and reads the
 * cells; no shared boot. The wire tests boot a tab the way `main.tsx` does, over fake streams. */

const ISSUE: Issues.Issue = {
  id: "i1",
  title: "First",
  description: "hello",
  status: "open",
  assignee: null,
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
};

const DETAIL: Issues.Detail = { issue: ISSUE, comments: [], activity: [] };

const COMMENT: Issues.Comment = {
  id: "c1",
  issueId: "i1",
  author: "Ada",
  text: "hi",
  createdAt: 2,
};

const TAGS = [api.config({ baseUrl: "http://x" })];

const SNAPSHOT = JSON.stringify({ type: "snapshot", key: "issues", version: 1, value: [ISSUE] });

/** A fake server-sent stream: the wire drives it like an `EventSource`; the test fires its
 * open, error, and message events and moves its `readyState` the way the browser does. */
class FakeSource implements Wire.Source {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  drop(): void {
    this.readyState = 0;
    this.onerror?.(new Event("error"));
  }
  refuse(): void {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }
  push(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

/** Boot one tab on the wire as `main.tsx` does, over fake streams. The wire opens its first
 * stream while the scope starts; the boot waits one turn so sync listens on the wire before a
 * test fires a stream event, as a real stream's events come on a later task. */
async function bootTab() {
  const sources: FakeSource[] = [];
  const scope = createScope({
    tags: [
      ...TAGS,
      openSource((url) => {
        const source = new FakeSource(url);
        sources.push(source);
        return source;
      }),
    ],
    extensions: [subscribe(wire, { cells: [[issueList, "issues"]] })],
  });
  await nextTurn();
  return { scope, sources, transport: scope.resolve(wire) };
}

/** One `data:` SSE frame for one draft event. */
function readFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** An SSE body: the frames joined into one byte stream, like the real server writes; with
 * `hold`, the stream stays open after its frames until `release` — the held turn. */
function readStream(
  frames: readonly string[],
  hold = false,
): { readonly stream: ReadableStream<Uint8Array>; readonly release: () => void } {
  const encoder = new TextEncoder();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      if (hold) await held;
      controller.close();
    },
  });
  return { stream, release };
}

const DRAFT_FRAMES = [
  readFrame({ kind: "status", status: "running" }),
  readFrame({ kind: "text", text: "A " }),
  readFrame({ kind: "text", text: "draft." }),
  readFrame({ kind: "done", draft: "A draft." }),
  readFrame({ kind: "terminal", status: "done", draft: "A draft." }),
];

test("typing then submitting the create form posts once and clears the draft", async () => {
  let posts = 0;
  const scope = createScope({
    tags: TAGS,
    presets: [
      preset(postIssue, () => {
        posts += 1;
        return Promise.resolve(ISSUE);
      }),
    ],
    extensions: [],
  });
  try {
    scope.run(typeNewIssue, { input: { title: "First" } });
    scope.run(typeNewIssue, { input: { description: "hello" } });
    expect(scope.resolve(newIssue)).toEqual({ title: "First", description: "hello" });
    const saved = await scope.run(submitNewIssue);
    expect(saved.title).toBe("First");
    expect(posts).toBe(1);
    expect(scope.resolve(newIssue)).toEqual({ title: "", description: "" });
  } finally {
    await scope.close();
  }
});

test("selecting an issue with a preset detail fills the detail cell and seeds the edit draft", async () => {
  const scope = createScope({
    tags: TAGS,
    presets: [preset(getDetail, () => Promise.resolve(DETAIL))],
    extensions: [],
  });
  try {
    scope.run(selectIssue, { input: "i1" });
    const found = await scope.run(loadDetail, { input: "i1" });
    expect(found?.issue.title).toBe("First");
    expect(scope.resolve(detail)?.issue.id).toBe("i1");
    expect(scope.resolve(editDraft)).toMatchObject({ id: "i1", baseRevision: 0 });
  } finally {
    await scope.close();
  }
});

test("saving an edit over a stale revision keeps the draft and stores the conflict", async () => {
  const current: Issues.Issue = { ...ISSUE, title: "Winner", revision: 1, updatedAt: 2 };
  let patches = 0;
  const scope = createScope({
    tags: TAGS,
    presets: [
      preset(getDetail, () => Promise.resolve(DETAIL)),
      preset(patchIssue, () => {
        patches += 1;
        return Promise.reject(fail("IssueConflict", { id: "i1", currentRevision: 1, current }));
      }),
    ],
    extensions: [],
  });
  try {
    scope.run(selectIssue, { input: "i1" });
    await scope.run(loadDetail, { input: "i1" });
    scope.run(typeEdit, { input: { title: "Loser" } });
    try {
      await scope.run(saveEdit);
      expect.unreachable();
    } catch (error: unknown) {
      if (!isError(error, "IssueConflict")) throw error;
      expect(error.payload.currentRevision).toBe(1);
    }
    const draft = scope.resolve(editDraft);
    expect(draft?.title).toBe("Loser");
    expect(draft?.conflict?.title).toBe("Winner");
    expect(patches).toBe(1);
  } finally {
    await scope.close();
  }
});

test("posting a comment clears the draft text", async () => {
  const posted: Issues.CommentInput[] = [];
  const scope = createScope({
    tags: TAGS,
    presets: [
      preset(getDetail, () => Promise.resolve(DETAIL)),
      preset(postComment, (_deps, ctx) => {
        posted.push(ctx.input);
        return Promise.resolve(COMMENT);
      }),
    ],
    extensions: [],
  });
  try {
    scope.run(selectIssue, { input: "i1" });
    await scope.run(loadDetail, { input: "i1" });
    scope.run(typeComment, { input: { text: "hi" } });
    expect(scope.resolve(commentDraft)).toBe("hi");
    await scope.run(submitComment);
    expect(scope.resolve(commentDraft)).toBe("");
    expect(posted).toEqual([{ issueId: "i1", author: "Ada", text: "hi" }]);
  } finally {
    await scope.close();
  }
});

test("checking the helper writes off when it answers disabled", async () => {
  const scope = createScope({
    tags: TAGS,
    presets: [preset(getCapability, () => Promise.resolve({ enabled: false }))],
    extensions: [],
  });
  try {
    expect(scope.resolve(draftCapability)).toBe("loading");
    await scope.run(checkCapability);
    expect(scope.resolve(draftCapability)).toBe("off");
  } finally {
    await scope.close();
  }
});

test("checking the helper writes failed when it answers an error", async () => {
  const scope = createScope({
    tags: TAGS,
    presets: [preset(getCapability, () => Promise.reject(fail("DraftFailed", { reason: "down" })))],
    extensions: [],
  });
  try {
    expect(await scope.run(checkCapability)).toEqual({ enabled: false });
    expect(scope.resolve(draftCapability)).toBe("failed");
  } finally {
    expect((await scope.close()).status).not.toBe("failed");
  }
});

test("a panic while checking the helper writes failed and rejects the check", async () => {
  const bug = new TypeError("bug");
  const scope = createScope({
    tags: TAGS,
    presets: [preset(getCapability, () => Promise.reject(bug))],
    extensions: [],
  });
  try {
    const checked = await scope.settle(checkCapability);
    expect(checked).toMatchObject({ status: "failed", kind: "panic", error: bug });
    expect(scope.resolve(draftCapability)).toBe("failed");
  } finally {
    await scope.close();
  }
});

test("a panic in the boot helper check shows failed and fails the scope", async () => {
  const bug = new TypeError("bug");
  const scope = createScope({
    tags: TAGS,
    presets: [preset(getCapability, () => Promise.reject(bug))],
    extensions: [],
  });
  scope.resolve(capability);
  await scope.settled();
  expect(scope.resolve(draftCapability)).toBe("failed");
  const closed = await scope.close();
  expect(closed).toMatchObject({ status: "failed", error: bug });
});

test("a panic in a background detail load fails the scope", async () => {
  const bug = new TypeError("bug");
  const scope = createScope({
    tags: TAGS,
    presets: [preset(issueList, [ISSUE]), preset(loadDetail, () => Promise.reject(bug))],
    extensions: [],
  });
  scope.resolve(detailRefresh);
  scope.run(selectIssue, { input: "i1" });
  await scope.settled();
  const closed = await scope.close();
  expect(closed).toMatchObject({ status: "failed", error: bug });
});

test("starting a draft streams text into the run cell until ready", async () => {
  let opens = 0;
  const scope = createScope({
    tags: TAGS,
    presets: [
      preset(openDraft, () => {
        opens += 1;
        return Promise.resolve(readStream(DRAFT_FRAMES).stream);
      }),
    ],
    extensions: [],
  });
  try {
    scope.resolve(drafter);
    scope.run(selectIssue, { input: "i1" });
    await scope.run(beginDraft);
    const run = scope.resolve(draftRun);
    expect(run.view).toBe("ready");
    expect(run.text).toBe("A draft.");
    expect(run.draft).toBe("A draft.");
    expect(opens).toBe(1);
  } finally {
    await scope.close();
  }
});

test("posting a ready draft saves one comment and quiets the run", async () => {
  const posted: Issues.CommentInput[] = [];
  const scope = createScope({
    tags: TAGS,
    presets: [
      preset(openDraft, () => Promise.resolve(readStream(DRAFT_FRAMES).stream)),
      preset(postComment, (_deps, ctx) => {
        posted.push(ctx.input);
        return Promise.resolve(COMMENT);
      }),
    ],
    extensions: [],
  });
  try {
    scope.resolve(drafter);
    scope.run(selectIssue, { input: "i1" });
    await scope.run(beginDraft);
    expect(scope.resolve(draftRun).draft).toBe("A draft.");
    await scope.run(postDraft);
    expect(posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ issueId: "i1", text: "A draft." });
    expect(scope.resolve(draftRun)).toEqual({ view: "quiet", text: "", draft: "", notice: null });
  } finally {
    await scope.close();
  }
});

test("a broken frame fails the run, cancels the stream, and saves nothing", async () => {
  const held = readStream([readFrame("{broken JSON")], true);
  let posts = 0;
  const scope = createScope({
    tags: TAGS,
    presets: [
      preset(openDraft, () => Promise.resolve(held.stream)),
      preset(postComment, () => {
        posts += 1;
        return Promise.resolve(COMMENT);
      }),
    ],
    extensions: [],
  });
  try {
    scope.resolve(drafter);
    scope.run(selectIssue, { input: "i1" });
    await scope.run(beginDraft);
    const run = scope.resolve(draftRun);
    expect(run.view).toBe("failed");
    expect(run.notice).toMatch(/unreadable|failed/i);
    held.release();
    expect(posts).toBe(0);
  } finally {
    await scope.close();
  }
});

test("discarding a run quiets the cell without posting", async () => {
  let posts = 0;
  const scope = createScope({
    tags: TAGS,
    presets: [
      preset(openDraft, () => Promise.resolve(readStream(DRAFT_FRAMES).stream)),
      preset(postComment, () => {
        posts += 1;
        return Promise.resolve(COMMENT);
      }),
    ],
    extensions: [],
  });
  try {
    scope.resolve(drafter);
    scope.run(selectIssue, { input: "i1" });
    await scope.run(beginDraft);
    expect(scope.resolve(draftRun).view).toBe("ready");
    scope.run(discardDraft);
    expect(scope.resolve(draftRun)).toEqual({ view: "quiet", text: "", draft: "", notice: null });
    expect(posts).toBe(0);
  } finally {
    await scope.close();
  }
});

test("boot stays connecting while the browser retries, goes live on open, and is ready at the first snapshot", async () => {
  const tab = await bootTab();
  const [first] = tab.sources;
  try {
    expect(first?.url).toBe("/sync?keys=issues");
    first?.drop();
    first?.drop();
    expect(tab.scope.resolve(connection)).toEqual({ live: false, pending: true, failed: false });
    first?.open();
    expect(tab.scope.resolve(connection)).toEqual({ live: true, pending: false, failed: false });
    first?.push(SNAPSHOT);
    await tab.scope.ready;
    expect(tab.scope.resolve(issueList)).toEqual([ISSUE]);
    expect(tab.sources.length).toBe(1);
  } finally {
    await tab.scope.close();
  }
});

test("a drop reads connecting, and the browser's reconnect lands a restarted server's snapshot at a lower version", async () => {
  const tab = await bootTab();
  let closes = 0;
  tab.transport.onClose(() => {
    closes += 1;
  });
  const [first] = tab.sources;
  first?.open();
  first?.push(JSON.stringify({ type: "snapshot", key: "issues", version: 3, value: [ISSUE] }));
  try {
    await tab.scope.ready;
    first?.drop();
    expect(tab.scope.resolve(connection)).toMatchObject({ live: false, pending: true });
    first?.open();
    first?.push(JSON.stringify({ type: "snapshot", key: "issues", version: 0, value: [] }));
    expect(tab.scope.resolve(connection).live).toBe(true);
    expect(tab.scope.resolve(issueList)).toEqual([]);
    expect(closes).toBe(0);
    expect(tab.sources.length).toBe(1);
  } finally {
    await tab.scope.close();
  }
});

test("a stream the browser gives up on writes failed, and a Reconnect bump opens a fresh stream", async () => {
  const tab = await bootTab();
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    first?.refuse();
    expect(tab.scope.resolve(connection)).toEqual({ live: false, pending: false, failed: true });
    expect(first?.closed).toBe(true);
    tab.scope.run(reconnect);
    expect(tab.sources[1]?.url).toBe("/sync?keys=issues");
    expect(tab.scope.resolve(connection).pending).toBe(true);
    tab.sources[1]?.open();
    tab.sources[1]?.push(
      JSON.stringify({ type: "snapshot", key: "issues", version: 1, value: [] }),
    );
    expect(tab.scope.resolve(connection).live).toBe(true);
    expect(tab.scope.resolve(issueList)).toEqual([]);
  } finally {
    await tab.scope.close();
  }
});

test("a stream the browser gives up on before the first snapshot fails the boot with SyncNotReady", async () => {
  const tab = await bootTab();
  tab.sources[0]?.refuse();
  expect(tab.scope.resolve(connection).failed).toBe(true);
  await tab.scope.ready.then(
    () => {
      expect.unreachable();
    },
    (error: unknown) => {
      if (!isSyncError(error, "SyncNotReady")) throw error;
      expect(error.payload.missing).toEqual(["issues"]);
    },
  );
});

test("a malformed frame writes failed and closes the stream, and sync stays attached", async () => {
  const tab = await bootTab();
  let closes = 0;
  tab.transport.onClose(() => {
    closes += 1;
  });
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    first?.push("not json");
    expect(tab.scope.resolve(connection).failed).toBe(true);
    expect(first?.closed).toBe(true);
    expect(closes).toBe(0);
    expect(tab.scope.resolve(issueList)).toEqual([ISSUE]);
  } finally {
    await tab.scope.close();
  }
});

test("scope close closes the stream and fires onClose once", async () => {
  const tab = await bootTab();
  let closes = 0;
  tab.transport.onClose(() => {
    closes += 1;
  });
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  await tab.scope.ready;
  await tab.scope.close();
  expect(first?.closed).toBe(true);
  expect(closes).toBe(1);
});

test("a stream that cannot be opened fails the boot with its own error", async () => {
  let closes = 0;
  const scope = createScope({
    tags: [
      ...TAGS,
      openSource(() => {
        throw fail("SyncDropped", { reason: "no stream" });
      }),
    ],
    extensions: [
      subscribe(wire, { cells: [[issueList, "issues"]] }),
      extension({
        label: "boot-cleanup",
        hooks: {
          close: (event) => {
            closes += 1;
            return event.next();
          },
        },
      }),
    ],
  });
  await scope.ready.then(
    () => {
      expect.unreachable();
    },
    (error: unknown) => {
      if (!isError(error, "SyncDropped")) throw error;
      expect(error.payload.reason).toBe("no stream");
    },
  );
  expect(closes).toBe(1);
});
