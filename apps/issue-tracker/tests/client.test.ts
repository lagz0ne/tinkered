import { createScope, preset } from "@tinker/core";
import { backend, HttpRequest, HttpResponse, type HttpClient } from "@tinker/http";
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
  getDetail,
  isError,
  loadDetail,
  newIssue,
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
  type ReconnectingWire,
} from "../src/index.ts";

type Seen = { readonly method: string; readonly url: string; readonly body: unknown };

/** The canned answers the fake serves: creates, edits, comments, the detail read, plus the
 * draft stream frames and capability answer the draft tests set. */
type Answers = {
  readonly issue: Record<string, unknown>;
  readonly detail: Record<string, unknown>;
  readonly comment: Record<string, unknown>;
  readonly failPatch?: { readonly status: number; readonly body: unknown };
  readonly draft?: { readonly frames: readonly string[] };
  readonly capability?: { readonly status: number; readonly body: unknown };
};

/** One fake route: a matcher plus its one-line answer. */
type Route = {
  readonly match: (method: string, url: string) => boolean;
  readonly answer: (request: HttpRequest.Record) => HttpResponse.Handle;
};

/** A fake HTTP transport: answers creates, edits, comments, and the detail read from canned
 * values the test sets. The client behaviour — cells written, operations run — is what is
 * asserted, never the fake itself. */
function readFake(answers: Answers): { readonly fake: HttpClient.Backend; readonly seen: Seen[] } {
  const seen: Seen[] = [];
  const routes = readRoutes(answers);
  const fallback = (request: HttpRequest.Record): HttpResponse.Handle =>
    HttpResponse.make(request, { status: 200, body: JSON.stringify(answers.detail) });
  const fake: HttpClient.Backend = (request) => {
    const url = HttpRequest.toUrl(request);
    seen.push({ method: request.method, url, body: readJsonBody(request) });
    const route = routes.find((candidate) => candidate.match(request.method, url));
    return Promise.resolve(route === undefined ? fallback(request) : route.answer(request));
  };
  return { fake, seen };
}

/** The fake's route table: capability, draft stream, creates, edits, comments — in match
 * order, with the detail read as the fallback. */
function readRoutes(answers: Answers): readonly Route[] {
  const capability: { readonly status: number; readonly body: unknown } = answers.capability ?? {
    status: 200,
    body: { enabled: true },
  };
  const draft: { readonly frames: readonly string[] } = answers.draft ?? { frames: [] };
  const patch: { readonly status: number; readonly body: unknown } = answers.failPatch ?? {
    status: 200,
    body: answers.issue,
  };
  return [
    {
      match: (method, url) => method === "GET" && url.endsWith("/api/draft"),
      answer: (request) =>
        HttpResponse.make(request, {
          status: capability.status,
          body: JSON.stringify(capability.body),
        }),
    },
    {
      match: (method, url) =>
        answers.draft !== undefined && method === "POST" && url.endsWith("/draft"),
      answer: (request) =>
        HttpResponse.make(request, { status: 200, body: readDraftStream(draft.frames) }),
    },
    {
      match: (method, url) => method === "POST" && url.endsWith("/api/issues"),
      answer: (request) =>
        HttpResponse.make(request, { status: 201, body: JSON.stringify(answers.issue) }),
    },
    {
      match: (method) => method === "PATCH",
      answer: (request) =>
        HttpResponse.make(request, { status: patch.status, body: JSON.stringify(patch.body) }),
    },
    {
      match: (method, url) => method === "POST" && url.includes("/comments"),
      answer: (request) =>
        HttpResponse.make(request, { status: 201, body: JSON.stringify(answers.comment) }),
    },
  ];
}

/** A fake SSE body that stays open after its frames: the held turn the broken-frame case
 * needs. Closing it lands the run. */
function readHeldStream(frames: readonly string[]): {
  readonly stream: ReadableStream<Uint8Array>;
  readonly release: () => void;
} {
  const encoder = new TextEncoder();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      await held;
      controller.close();
    },
  });
  return { stream, release };
}

/** A fake SSE body: the frames joined into one byte stream, like the real server writes. */
function readDraftStream(frames: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = frames.map((frame) => encoder.encode(frame));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of bytes) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** One `data:` SSE frame for one draft event. */
function readFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function readJsonBody(request: HttpRequest.Record): unknown {
  if (request.body.kind !== "text") return null;
  try {
    return JSON.parse(request.body.text);
  } catch {
    return null;
  }
}

const ISSUE = {
  id: "i1",
  title: "First",
  description: "hello",
  status: "open",
  assignee: null,
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
};

const DETAIL = {
  issue: ISSUE,
  comments: [],
  activity: [],
};

const COMMENT = { id: "c1", issueId: "i1", author: "Ada", text: "hi", createdAt: 2 };

function readWire(): ReconnectingWire {
  return {
    send: () => undefined,
    onMessage: () => () => undefined,
    onClose: () => () => undefined,
    close: () => undefined,
    status: () => "live",
    onStatus: () => () => undefined,
    reconnect: () => Promise.resolve(),
  };
}

async function bootClient(answers: Parameters<typeof readFake>[0]) {
  const { fake, seen } = readFake(answers);
  const scope = createScope({
    tags: [api.config({ baseUrl: "http://x" }), backend(fake), wire(readWire())],
    extensions: [],
  });
  return { scope, seen };
}

test("typing then submitting the create form posts once and clears the draft", async () => {
  const { scope, seen } = await bootClient({ issue: ISSUE, detail: DETAIL, comment: COMMENT });
  try {
    scope.run(typeNewIssue, { input: { title: "First" } });
    scope.run(typeNewIssue, { input: { description: "hello" } });
    expect(scope.resolve(newIssue)).toEqual({ title: "First", description: "hello" });
    const saved = await scope.run(submitNewIssue);
    expect(saved.title).toBe("First");
    expect(seen.filter((s) => s.method === "POST" && s.url.endsWith("/api/issues")).length).toBe(1);
    expect(scope.resolve(newIssue)).toEqual({ title: "", description: "" });
  } finally {
    await scope.close();
  }
});

test("selecting an issue with a preset detail fills the detail cell and seeds the edit draft", async () => {
  const { scope } = await bootClient({ issue: ISSUE, detail: DETAIL, comment: COMMENT });
  const presetScope = createScope({
    tags: [
      api.config({ baseUrl: "http://x" }),
      backend(readFake({ issue: ISSUE, detail: DETAIL, comment: COMMENT }).fake),
      wire(readWire()),
    ],
    presets: [
      preset(getDetail, () =>
        Promise.resolve({
          issue: { ...ISSUE, status: "open" as const, assignee: null },
          comments: [],
          activity: [],
        }),
      ),
    ],
    extensions: [],
  });
  try {
    await scope.close();
    presetScope.run(selectIssue, { input: "i1" });
    const found = await presetScope.run(loadDetail, { input: "i1" });
    expect(found?.issue.title).toBe("First");
    expect(presetScope.resolve(detail)?.issue.id).toBe("i1");
    expect(presetScope.resolve(editDraft)).toMatchObject({ id: "i1", baseRevision: 0 });
  } finally {
    await presetScope.close();
  }
});

test("saving an edit over a stale revision keeps the draft and stores the conflict", async () => {
  const current = { ...ISSUE, title: "Winner", revision: 1, updatedAt: 2 };
  const { scope, seen } = await bootClient({
    issue: ISSUE,
    detail: DETAIL,
    comment: COMMENT,
    failPatch: {
      status: 409,
      body: { message: "someone else saved first", current },
    },
  });
  try {
    scope.run(selectIssue, { input: "i1" });
    await scope.run(loadDetail, { input: "i1" });
    scope.run(typeEdit, { input: { title: "Loser" } });
    await expect(scope.run(saveEdit)).rejects.toBeDefined();
    const draft = scope.resolve(editDraft);
    expect(draft?.title).toBe("Loser");
    expect(draft?.conflict?.title).toBe("Winner");
    expect(seen.filter((s) => s.method === "PATCH").length).toBe(1);
  } finally {
    await scope.close();
  }
});

test("posting a comment clears the draft text", async () => {
  const { scope, seen } = await bootClient({ issue: ISSUE, detail: DETAIL, comment: COMMENT });
  try {
    scope.run(selectIssue, { input: "i1" });
    await scope.run(loadDetail, { input: "i1" });
    scope.run(typeComment, { input: { text: "hi" } });
    expect(scope.resolve(commentDraft)).toBe("hi");
    await scope.run(submitComment);
    expect(scope.resolve(commentDraft)).toBe("");
    expect(seen.filter((s) => s.url.includes("/comments")).length).toBe(1);
  } finally {
    await scope.close();
  }
});

test("checking the helper writes off when it answers disabled", async () => {
  const { scope } = await bootClient({
    issue: ISSUE,
    detail: DETAIL,
    comment: COMMENT,
    capability: { status: 200, body: { enabled: false } },
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
  const { scope } = await bootClient({
    issue: ISSUE,
    detail: DETAIL,
    comment: COMMENT,
    capability: { status: 500, body: { message: "down" } },
  });
  try {
    await scope.run(checkCapability);
    expect(scope.resolve(draftCapability)).toBe("failed");
  } finally {
    await scope.close();
  }
});

const DRAFT_FRAMES = [
  readFrame({ kind: "status", status: "running" }),
  readFrame({ kind: "text", text: "A " }),
  readFrame({ kind: "text", text: "draft." }),
  readFrame({ kind: "done", draft: "A draft." }),
  readFrame({ kind: "terminal", status: "done", draft: "A draft." }),
];

async function bootDraftClient(answers: Parameters<typeof readFake>[0]) {
  const { fake, seen } = readFake(answers);
  const scope = createScope({
    tags: [api.config({ baseUrl: "http://x" }), backend(fake), wire(readWire())],
    extensions: [],
  });
  scope.resolve(drafter);
  scope.run(selectIssue, { input: "i1" });
  return { scope, seen };
}

test("starting a draft streams text into the run cell until ready", async () => {
  const { scope, seen } = await bootDraftClient({
    issue: ISSUE,
    detail: DETAIL,
    comment: COMMENT,
    draft: { frames: DRAFT_FRAMES },
  });
  try {
    await scope.run(beginDraft);
    const run = scope.resolve(draftRun);
    expect(run.view).toBe("ready");
    expect(run.text).toBe("A draft.");
    expect(run.draft).toBe("A draft.");
    expect(seen.filter((s) => s.url.endsWith("/draft")).length).toBe(1);
  } finally {
    await scope.close();
  }
});

test("posting a ready draft saves one comment and quiets the run", async () => {
  const { scope, seen } = await bootDraftClient({
    issue: ISSUE,
    detail: DETAIL,
    comment: COMMENT,
    draft: { frames: DRAFT_FRAMES },
  });
  try {
    await scope.run(beginDraft);
    expect(scope.resolve(draftRun).draft).toBe("A draft.");
    await scope.run(postDraft);
    const comments = seen.filter((s) => s.url.includes("/comments"));
    expect(comments.length).toBe(1);
    expect(comments[0]?.body).toMatchObject({ issueId: "i1", text: "A draft." });
    expect(scope.resolve(draftRun)).toEqual({ view: "quiet", text: "", draft: "", notice: null });
  } finally {
    await scope.close();
  }
});

test("a broken frame fails the run, cancels the stream, and saves nothing", async () => {
  const seen: Seen[] = [];
  const held = readHeldStream([readFrame("{broken JSON")]);
  const fake: HttpClient.Backend = (request) => {
    const url = HttpRequest.toUrl(request);
    seen.push({ method: request.method, url, body: readJsonBody(request) });
    if (request.method === "POST" && url.endsWith("/draft")) {
      return Promise.resolve(HttpResponse.make(request, { status: 200, body: held.stream }));
    }
    return Promise.resolve(
      HttpResponse.make(request, { status: 200, body: JSON.stringify(DETAIL) }),
    );
  };
  const scope = createScope({
    tags: [api.config({ baseUrl: "http://x" }), backend(fake), wire(readWire())],
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
    expect(seen.filter((s) => s.url.includes("/comments")).length).toBe(0);
  } finally {
    await scope.close();
  }
});

test("discarding a run quiets the cell without posting", async () => {
  const { scope, seen } = await bootDraftClient({
    issue: ISSUE,
    detail: DETAIL,
    comment: COMMENT,
    draft: { frames: DRAFT_FRAMES },
  });
  try {
    await scope.run(beginDraft);
    expect(scope.resolve(draftRun).view).toBe("ready");
    scope.run(discardDraft);
    expect(scope.resolve(draftRun)).toEqual({ view: "quiet", text: "", draft: "", notice: null });
    expect(seen.filter((s) => s.url.includes("/comments")).length).toBe(0);
  } finally {
    await scope.close();
  }
});

test("the client operations are presettable without the network", async () => {
  const scope = createScope({
    tags: [
      api.config({ baseUrl: "http://x" }),
      backend(readFake({ issue: ISSUE, detail: DETAIL, comment: COMMENT }).fake),
      wire(readWire()),
    ],
    presets: [
      preset(postIssue, () =>
        Promise.resolve({ ...ISSUE, status: "open" as const, assignee: null }),
      ),
      preset(patchIssue, () => Promise.reject(new Error("offline"))),
      preset(postComment, () => Promise.resolve({ ...COMMENT })),
      preset(getDetail, () =>
        Promise.resolve({
          issue: { ...ISSUE, status: "open" as const, assignee: null },
          comments: [],
          activity: [],
        }),
      ),
    ],
    extensions: [],
  });
  try {
    scope.run(typeNewIssue, { input: { title: "Preset" } });
    const saved = await scope.run(submitNewIssue);
    expect(saved.title).toBe("First");
    scope.run(selectIssue, { input: "i1" });
    await scope.run(loadDetail, { input: "i1" });
    scope.run(typeEdit, { input: { title: "Loser" } });
    try {
      await scope.run(saveEdit);
      expect.unreachable();
    } catch (error: unknown) {
      if (isError(error, "BadCreateInput")) throw error;
      expect(error instanceof Error).toBe(true);
    }
    expect(scope.resolve(editDraft)?.title).toBe("Loser");
  } finally {
    await scope.close();
  }
});
