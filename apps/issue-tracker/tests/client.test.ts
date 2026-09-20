import { createScope, preset } from "@tinker/core";
import { backend, HttpRequest, HttpResponse, type HttpClient } from "@tinker/http";
import { sync } from "@tinker/sync";
import { expect, test } from "vite-plus/test";
import {
  api,
  commentDraft,
  detail,
  editDraft,
  getDetail,
  isError,
  issueList,
  loadDetail,
  newIssue,
  patchIssue,
  postComment,
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

/** A fake HTTP transport: answers creates, edits, comments, and the detail read from canned
 * values the test sets. The client behaviour — cells written, operations run — is what is
 * asserted, never the fake itself. */
function readFake(answers: {
  readonly issue: Record<string, unknown>;
  readonly detail: Record<string, unknown>;
  readonly comment: Record<string, unknown>;
  readonly failPatch?: { readonly status: number; readonly body: unknown };
}): { readonly fake: HttpClient.Backend; readonly seen: Seen[] } {
  const seen: Seen[] = [];
  const fake: HttpClient.Backend = (request) => {
    const url = HttpRequest.toUrl(request);
    seen.push({ method: request.method, url, body: readJsonBody(request) });
    if (request.method === "POST" && url.endsWith("/api/issues")) {
      return Promise.resolve(
        HttpResponse.make(request, { status: 201, body: JSON.stringify(answers.issue) }),
      );
    }
    if (request.method === "PATCH") {
      if (answers.failPatch !== undefined) {
        return Promise.resolve(
          HttpResponse.make(request, {
            status: answers.failPatch.status,
            body: JSON.stringify(answers.failPatch.body),
          }),
        );
      }
      return Promise.resolve(
        HttpResponse.make(request, { status: 200, body: JSON.stringify(answers.issue) }),
      );
    }
    if (request.method === "POST" && url.includes("/comments")) {
      return Promise.resolve(
        HttpResponse.make(request, { status: 201, body: JSON.stringify(answers.comment) }),
      );
    }
    return Promise.resolve(
      HttpResponse.make(request, { status: 200, body: JSON.stringify(answers.detail) }),
    );
  };
  return { fake, seen };
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
    tags: [api.config({ baseUrl: "http://x" }), sync(issueList), backend(fake), wire(readWire())],
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
      sync(issueList),
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

test("the client operations are presettable without the network", async () => {
  const scope = createScope({
    tags: [
      api.config({ baseUrl: "http://x" }),
      sync(issueList),
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
