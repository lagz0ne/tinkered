import { createScope, preset } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import {
  api,
  beginDraft,
  checkCapability,
  commentDraft,
  detail,
  discardDraft,
  draftCapability,
  draftRun,
  drafter,
  editDraft,
  fail,
  getCapability,
  getDetail,
  isError,
  loadDetail,
  newIssue,
  openDraft,
  patchIssue,
  postComment,
  postDraft,
  postIssue,
  saveEdit,
  selectIssue,
  submitComment,
  submitNewIssue,
  typeComment,
  typeEdit,
  typeNewIssue,
  wire,
  type Issues,
  type ReconnectingWire,
} from "../src/index.ts";

/** Every test presets the endpoint node it needs (`postIssue`, `getDetail`, …) and reads the
 * cells; no fake transport, no shared boot. The tags below are the two every client scope binds. */

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

/** A live wire that never speaks: the sync transport is userland, so it stays a tag. */
const WIRE: ReconnectingWire = {
  send: () => undefined,
  onMessage: () => () => undefined,
  onClose: () => () => undefined,
  close: () => undefined,
  status: () => "live",
  onStatus: () => () => undefined,
  reconnect: () => Promise.resolve(),
};

const TAGS = [api.config({ baseUrl: "http://x" }), wire(WIRE)];

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
    presets: [preset(getCapability, () => Promise.reject(new Error("down")))],
    extensions: [],
  });
  try {
    await scope.run(checkCapability);
    expect(scope.resolve(draftCapability)).toBe("failed");
  } finally {
    await scope.close();
  }
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
