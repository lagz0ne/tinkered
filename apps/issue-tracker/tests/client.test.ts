import { setImmediate as nextTurn } from "node:timers/promises";
import { createScope, makeTestClock, preset, type Clock } from "@tinker/core";
import { isError as isSyncError, memoryPair, subscribe, type Sync } from "@tinker/sync";
import { expect, test } from "vite-plus/test";
import {
  api,
  beginDraft,
  checkCapability,
  commentDraft,
  connection,
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
  issueList,
  linkWire,
  loadDetail,
  newIssue,
  openDraft,
  openSource,
  patchIssue,
  postComment,
  postDraft,
  postIssue,
  postSync,
  reconnect,
  saveEdit,
  selectIssue,
  submitComment,
  submitNewIssue,
  typeComment,
  typeEdit,
  typeNewIssue,
  wirePeer,
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

const REGISTER: Sync.Message = { type: "register", keys: ["issues"] };

const SNAPSHOT = JSON.stringify({ type: "snapshot", key: "issues", version: 1, value: [ISSUE] });

/** A fake server-sent stream: the wire drives it like an `EventSource`; the test fires its
 * open, error, and message events. */
class FakeSource implements Wire.Source {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.(new Event("open"));
  }
  fail(): void {
    this.onerror?.(new Event("error"));
  }
  push(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

/** Boot one tab on the wire as `main.tsx` does: fake streams, `post` in place of the POST, and a
 * test clock for the backoff wait; `sleeps` records the signal the wire hands each wait. The wire
 * opens its first stream while the scope starts. */
function bootTab(post: (input: Wire.Post, signal: AbortSignal) => Promise<void>) {
  const sources: FakeSource[] = [];
  const clock = makeTestClock();
  const sleeps: (AbortSignal | undefined)[] = [];
  const spied: Clock.Test = {
    ...clock,
    sleep: (ms, signal) => {
      sleeps.push(signal);
      return clock.sleep(ms, signal);
    },
  };
  const [peer, far] = memoryPair();
  const scope = createScope({
    clock: spied,
    tags: [
      ...TAGS,
      wirePeer(peer),
      openSource(() => {
        const source = new FakeSource();
        sources.push(source);
        return source;
      }),
    ],
    presets: [preset(postSync, (_deps, { input, signal }) => post(input, signal))],
    extensions: [linkWire, subscribe(far, { cells: [[issueList, "issues"]] })],
  });
  return { scope, sources, clock, sleeps, transport: far };
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

test("the first stream error before its open fails the boot with SyncNotReady", async () => {
  const tab = bootTab(() => Promise.resolve());
  tab.sources[0]?.fail();
  await tab.scope.ready.then(
    () => {
      expect.unreachable();
    },
    (error: unknown) => {
      if (!isSyncError(error, "SyncNotReady")) throw error;
      expect(error.payload.missing).toEqual(["issues"]);
    },
  );
  await tab.scope.close();
});

test("a stream error after the open drops the connection and keeps sync attached", async () => {
  const tab = bootTab(() => Promise.resolve());
  let closes = 0;
  tab.transport.onClose(() => {
    closes += 1;
  });
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    first?.fail();
    expect(tab.scope.resolve(connection).live).toBe(false);
    expect(first?.closed).toBe(true);
    expect(closes).toBe(0);
    expect(tab.scope.resolve(issueList)).toEqual([ISSUE]);
  } finally {
    await tab.scope.close();
  }
});

test("a malformed frame drops the connection", async () => {
  const tab = bootTab(() => Promise.resolve());
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    first?.push("not json");
    expect(tab.scope.resolve(connection).live).toBe(false);
  } finally {
    await tab.scope.close();
  }
});

test("a refused POST drops the connection", async () => {
  const tab = bootTab(() => Promise.reject(fail("ViewerGone", { id: "tab" })));
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    await expect.poll(() => tab.scope.resolve(connection).live).toBe(false);
  } finally {
    await tab.scope.close();
  }
});

test("POSTs wait for the stream's open and go out in send order", async () => {
  let opened = false;
  const sent: { readonly opened: boolean; readonly message: Sync.Message }[] = [];
  const tab = bootTab((input) => {
    sent.push({ opened, message: input.message });
    return Promise.resolve();
  });
  const later: Sync.Message = { type: "register", keys: ["later"] };
  tab.transport.send(later);
  const [first] = tab.sources;
  opened = true;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    await expect.poll(() => sent.length).toBe(2);
    expect(sent).toEqual([
      { opened: true, message: REGISTER },
      { opened: true, message: later },
    ]);
  } finally {
    await tab.scope.close();
  }
});

test("a reconnect bumps retry: the wire rewires, goes live, and replays the last register", async () => {
  const sent: Sync.Message[] = [];
  const tab = bootTab((input) => {
    sent.push(input.message);
    return Promise.resolve();
  });
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    await expect.poll(() => sent.length).toBe(1);
    first?.fail();
    tab.scope.run(reconnect);
    expect(tab.scope.resolve(connection)).toMatchObject({ live: false, pending: true });
    expect(tab.sources.length).toBe(2);
    tab.sources[1]?.open();
    expect(tab.scope.resolve(connection)).toMatchObject({ live: true, pending: false });
    await expect.poll(() => sent.length).toBe(2);
    expect(sent).toEqual([REGISTER, REGISTER]);
  } finally {
    await tab.scope.close();
  }
});

test("a rewire that errors before its open retries after a longer wait and goes live on a later open", async () => {
  const sent: Sync.Message[] = [];
  const tab = bootTab((input) => {
    sent.push(input.message);
    return Promise.resolve();
  });
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    first?.fail();
    tab.clock.advance(1000);
    await expect.poll(() => tab.sources.length).toBe(2);
    tab.sources[1]?.fail();
    expect(tab.scope.resolve(connection)).toMatchObject({
      live: false,
      pending: false,
      failed: false,
    });
    tab.clock.advance(1999);
    await nextTurn();
    expect(tab.sources.length).toBe(2);
    tab.clock.advance(1);
    await expect.poll(() => tab.sources.length).toBe(3);
    tab.sources[2]?.open();
    expect(tab.scope.resolve(connection).live).toBe(true);
    await expect.poll(() => sent).toEqual([REGISTER, REGISTER]);
  } finally {
    await tab.scope.close();
  }
});

test("the retry wait doubles with each miss and caps at 30 seconds", async () => {
  const tab = bootTab(() => Promise.resolve());
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    first?.fail();
    for (const wait of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
      const opened = tab.sources.length;
      tab.clock.advance(wait - 1);
      await nextTurn();
      expect(tab.sources.length).toBe(opened);
      tab.clock.advance(1);
      await expect.poll(() => tab.sources.length).toBe(opened + 1);
      tab.sources.at(-1)?.fail();
    }
  } finally {
    await tab.scope.close();
  }
});

test("a retry bump during a wait opens at once, resets the wait, and the old wait opens nothing", async () => {
  const tab = bootTab(() => Promise.resolve());
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    first?.fail();
    tab.clock.advance(1000);
    await expect.poll(() => tab.sources.length).toBe(2);
    tab.sources[1]?.fail();
    tab.scope.run(reconnect);
    expect(tab.sources.length).toBe(3);
    tab.sources[2]?.fail();
    tab.clock.advance(999);
    await nextTurn();
    expect(tab.sources.length).toBe(3);
    tab.clock.advance(1);
    await expect.poll(() => tab.sources.length).toBe(4);
    tab.sources[3]?.open();
    tab.clock.advance(60_000);
    await nextTurn();
    expect(tab.sources.length).toBe(4);
    expect(tab.scope.resolve(connection).live).toBe(true);
  } finally {
    await tab.scope.close();
  }
});

test("a drop rewires by itself after the backoff and replays the last register", async () => {
  const sent: Sync.Message[] = [];
  const tab = bootTab((input) => {
    sent.push(input.message);
    return Promise.resolve();
  });
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    first?.fail();
    expect(tab.sources.length).toBe(1);
    tab.clock.advance(60_000);
    await expect.poll(() => tab.sources.length).toBe(2);
    tab.sources[1]?.open();
    expect(tab.scope.resolve(connection).live).toBe(true);
    await expect.poll(() => sent).toEqual([REGISTER, REGISTER]);
  } finally {
    await tab.scope.close();
  }
});

test("a scope close during the backoff wait ends quietly and opens nothing", async () => {
  const tab = bootTab(() => Promise.resolve());
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  await tab.scope.ready;
  first?.fail();
  const ended = await tab.scope.close();
  expect(tab.sleeps.length).toBe(1);
  expect(tab.sleeps.every((signal) => signal?.aborted === true)).toBe(true);
  tab.clock.advance(60_000);
  expect(ended.teardownErrors).toBeUndefined();
  expect(tab.sources.length).toBe(1);
});

test("a scope close during the wait after a failed rewire ends quietly and opens nothing", async () => {
  const tab = bootTab(() => Promise.resolve());
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  await tab.scope.ready;
  first?.fail();
  tab.clock.advance(1000);
  await expect.poll(() => tab.sources.length).toBe(2);
  tab.sources[1]?.fail();
  const ended = await tab.scope.close();
  expect(tab.sleeps.length).toBe(2);
  expect(tab.sleeps.every((signal) => signal?.aborted === true)).toBe(true);
  tab.clock.advance(60_000);
  await nextTurn();
  expect(ended.teardownErrors).toBeUndefined();
  expect(tab.sources.length).toBe(2);
});

test("a POST that fails for a replaced stream does not drop the current one", async () => {
  let posts = 0;
  let rejectReplaced: (error: unknown) => void = () => undefined;
  const tab = bootTab(() => {
    posts += 1;
    if (posts !== 2) return Promise.resolve();
    return new Promise<void>((_resolve, reject) => {
      rejectReplaced = reject;
    });
  });
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  try {
    await tab.scope.ready;
    tab.scope.run(reconnect);
    tab.sources[1]?.open();
    await expect.poll(() => posts).toBe(2);
    tab.scope.run(reconnect);
    tab.sources[2]?.open();
    await expect.poll(() => posts).toBe(3);
    rejectReplaced(fail("ViewerGone", { id: "tab" }));
    await tab.scope.settled();
    expect(tab.scope.resolve(connection).live).toBe(true);
    expect(tab.sources[2]?.closed).toBe(false);
  } finally {
    await tab.scope.close();
  }
});

test("scope close aborts in-flight POSTs, closes the stream, fires onClose once", async () => {
  let held = false;
  let aborted = false;
  const tab = bootTab(
    (_input, signal) =>
      new Promise<void>((_resolve, reject) => {
        held = true;
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        });
      }),
  );
  let closes = 0;
  tab.transport.onClose(() => {
    closes += 1;
  });
  const [first] = tab.sources;
  first?.open();
  first?.push(SNAPSHOT);
  await tab.scope.ready;
  await expect.poll(() => held).toBe(true);
  await tab.scope.close();
  expect(aborted).toBe(true);
  expect(first?.closed).toBe(true);
  expect(closes).toBe(1);
});

test("scope close before the first stream opens settles instead of waiting on the register POST", async () => {
  let posts = 0;
  const tab = bootTab(() => {
    posts += 1;
    return Promise.resolve();
  });
  await tab.scope.close();
  expect(posts).toBe(0);
  expect(tab.sources[0]?.closed).toBe(true);
});

test("a stream that cannot be opened fails the boot with its own error", async () => {
  const [peer, far] = memoryPair();
  const scope = createScope({
    tags: [
      ...TAGS,
      wirePeer(peer),
      openSource(() => {
        throw fail("SyncDropped", { reason: "no stream" });
      }),
    ],
    extensions: [linkWire, subscribe(far, { cells: [[issueList, "issues"]] })],
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
  await scope.close();
});
