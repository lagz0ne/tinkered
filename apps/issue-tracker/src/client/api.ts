import { operation } from "@tinker/core";
import { config, HttpRequest, send } from "@tinker/http";
import { fail, raise, type Errors } from "../errors.ts";
import {
  parseComment,
  parseCommentInput,
  parseCreateInput,
  parseEditInput,
  parseIssue,
  parseIssueDetail,
  parseIssueId,
  parseIssueList,
} from "../shared/issues.ts";
import { parseDraftCapability, parseDraftInput } from "../shared/draft.ts";

/** A 409 passes the filter, so `patchIssue` can read its body as the conflict. */
export const acceptIssues = (status: number): boolean => status < 300 || status === 409;

/** The browser's command frame: saves through HTTP; the server owns the saved state. Every
 * operation below depends on the shared `send` directly. `api.config` folds the 409-accept
 * policy in by default, so every `api.config({ baseUrl })` caller — the browser root, the
 * server draft, the CLI/MCP tools — rejects a 500 as `ResponseFailed` while `patchIssue` can
 * still read a 409 body as the conflict. Pass `accept` to override per site. */
export const api = {
  config: (opts: { baseUrl: string; accept?: (status: number) => boolean }) =>
    config({ ...opts, accept: opts.accept ?? acceptIssues }),
};

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

/** Read a 409 body as the `IssueConflict` the server raised (`id`, `currentRevision`,
 * `current`), built but not thrown: `json(parse)` wraps a throwing parser as a decode failure, so
 * the endpoint throws it after the read. A body without a readable issue is a `BadIssue`. */
function parseConflict(raw: unknown): Errors.Of<"IssueConflict"> {
  if (!isRecord(raw)) raise("BadIssue", { label: "conflict" });
  if (typeof raw.id !== "string" || typeof raw.currentRevision !== "number") {
    raise("BadIssue", { label: "conflict" });
  }
  const conflict = fail("IssueConflict", {
    id: raw.id,
    currentRevision: raw.currentRevision,
    current: parseIssue(raw.current),
  });
  conflict.message = `IssueConflict: someone else saved first — current revision ${raw.currentRevision}`;
  return conflict;
}

/** Save one issue through HTTP; the server owns the saved state. */
export const postIssue = operation({
  label: "issues.postIssue",
  input: parseCreateInput,
  depends: { send },
  run: async ({ send: sendIt }, ctx) => {
    const res = await sendIt.run({
      input: HttpRequest.post("/api/issues", { body: HttpRequest.bodyJson(ctx.input) }),
    });
    return res.json(parseIssue);
  },
});

/** Save an edit through HTTP; a stale revision is rejected without saving: the server's 409
 * body is raised here as `IssueConflict` carrying the current saved issue, so every caller —
 * the browser, the CLI, a preset — speaks one error. */
export const patchIssue = operation({
  label: "issues.patchIssue",
  input: parseEditInput,
  depends: { send },
  run: async ({ send: sendIt }, ctx) => {
    const res = await sendIt.run({
      input: HttpRequest.patch(`/api/issues/${ctx.input.id}`, {
        body: HttpRequest.bodyJson(ctx.input),
      }),
    });
    if (res.status !== 409) return res.json(parseIssue);
    throw await res.json(parseConflict);
  },
});

/** Append a comment through HTTP; no edit revision is needed. */
export const postComment = operation({
  label: "issues.postComment",
  input: parseCommentInput,
  depends: { send },
  run: async ({ send: sendIt }, ctx) => {
    const res = await sendIt.run({
      input: HttpRequest.post(`/api/issues/${ctx.input.issueId}/comments`, {
        body: HttpRequest.bodyJson(ctx.input),
      }),
    });
    return res.json(parseComment);
  },
});

/** Read the draft helper's capability through HTTP: enabled means the view drafts. */
export const getCapability = operation({
  label: "issues.getCapability",
  depends: { send },
  run: async ({ send: sendIt }) => {
    const res = await sendIt.run({ input: HttpRequest.get("/api/draft") });
    return res.json(parseDraftCapability);
  },
});

/** Open a draft SSE stream through HTTP: the drafter resource pumps it; a missing body raises
 * `NoBody`, which the drafter reads as the helper failing. The client's status filter rejects
 * errors as `ResponseFailed`. */
export const openDraft = operation({
  label: "issues.openDraft",
  input: parseDraftInput,
  depends: { send },
  run: async ({ send: sendIt }, ctx) => {
    const res = await sendIt.run({
      input: HttpRequest.post(`/api/issues/${ctx.input.id}/draft`, {
        body: HttpRequest.bodyJson({ prompt: ctx.input.prompt }),
      }),
    });
    return res.stream();
  },
});

/** Read one saved detail through HTTP: the issue plus comments and activity. */
export const getDetail = operation({
  label: "issues.getDetail",
  input: parseIssueId,
  depends: { send },
  run: async ({ send: sendIt }, ctx) => {
    const res = await sendIt.run({ input: HttpRequest.get(`/api/issues/${ctx.input}`) });
    return res.json(parseIssueDetail);
  },
});

/** Read the saved list through HTTP (used before sync lands). */
export const getIssues = operation({
  label: "issues.getIssues",
  depends: { send },
  run: async ({ send: sendIt }) => {
    const res = await sendIt.run({ input: HttpRequest.get("/api/issues") });
    return res.json(parseIssueList);
  },
});
