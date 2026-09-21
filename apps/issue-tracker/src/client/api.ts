import { HttpRequest, httpClient } from "@tinker/http";
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

/** The browser's command frame: saves through HTTP; the server owns the saved state. A 409
 * passes the filter so `patchIssue` can read its body as the conflict. */
export const api = httpClient({
  label: "issues",
  filterStatus: (status) => status < 300 || status === 409,
});

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
export const postIssue = api.operation({
  label: "postIssue",
  input: parseCreateInput,
  request: (input) => HttpRequest.post("/api/issues", { body: HttpRequest.bodyJson(input) }),
  response: (res) => res.json(parseIssue),
});

/** Save an edit through HTTP; a stale revision is rejected without saving: the server's 409
 * body is raised here as `IssueConflict` carrying the current saved issue, so every caller —
 * the browser, the CLI, a preset — speaks one error. */
export const patchIssue = api.operation({
  label: "patchIssue",
  input: parseEditInput,
  request: (input) =>
    HttpRequest.patch(`/api/issues/${input.id}`, { body: HttpRequest.bodyJson(input) }),
  response: async (res) => {
    if (res.status !== 409) return res.json(parseIssue);
    throw await res.json(parseConflict);
  },
});

/** Append a comment through HTTP; no edit revision is needed. */
export const postComment = api.operation({
  label: "postComment",
  input: parseCommentInput,
  request: (input) =>
    HttpRequest.post(`/api/issues/${input.issueId}/comments`, {
      body: HttpRequest.bodyJson(input),
    }),
  response: (res) => res.json(parseComment),
});

/** Read the draft helper's capability through HTTP: enabled means the view drafts. */
export const getCapability = api.operation({
  label: "getCapability",
  request: () => HttpRequest.get("/api/draft"),
  response: (res) => res.json(parseDraftCapability),
});

/** Open a draft SSE stream through HTTP: the drafter resource pumps it; a missing body raises
 * `NoBody`, which the drafter reads as the helper failing. The client's status filter rejects
 * errors as `ResponseFailed`. */
export const openDraft = api.operation({
  label: "openDraft",
  input: parseDraftInput,
  request: (input) =>
    HttpRequest.post(`/api/issues/${input.id}/draft`, {
      body: HttpRequest.bodyJson({ prompt: input.prompt }),
    }),
  response: (res) => res.stream(),
});

/** Read one saved detail through HTTP: the issue plus comments and activity. */
export const getDetail = api.operation({
  label: "getDetail",
  input: parseIssueId,
  request: (id) => HttpRequest.get(`/api/issues/${id}`),
  response: (res) => res.json(parseIssueDetail),
});

/** Read the saved list through HTTP (used before sync lands). */
export const getIssues = api.operation({
  label: "getIssues",
  request: () => HttpRequest.get("/api/issues"),
  response: (res) => res.json(parseIssueList),
});
