import { HttpRequest, httpClient } from "@tinker/http";
import { raise } from "../errors.ts";
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

/** The browser's command frame: saves through HTTP; the server owns the saved state. */
export const api = httpClient({ label: "issues", filterStatus: (status) => status < 300 });

/** Save one issue through HTTP; the server owns the saved state. */
export const postIssue = api.operation({
  label: "postIssue",
  input: parseCreateInput,
  request: (input) => HttpRequest.post("/api/issues", { body: HttpRequest.bodyJson(input) }),
  response: (res) => res.json(parseIssue),
});

/** Save an edit through HTTP; a stale revision is rejected without saving. */
export const patchIssue = api.operation({
  label: "patchIssue",
  input: parseEditInput,
  request: (input) =>
    HttpRequest.patch(`/api/issues/${input.id}`, { body: HttpRequest.bodyJson(input) }),
  response: (res) => res.json(parseIssue),
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

/** Open a draft SSE stream through HTTP: the drafter resource pumps it; a missing body
 * means the helper failed. The client's status filter rejects errors as `ResponseFailed`. */
export const openDraft = api.operation({
  label: "openDraft",
  input: parseDraftInput,
  request: (input) =>
    HttpRequest.post(`/api/issues/${input.id}/draft`, {
      body: HttpRequest.bodyJson({ prompt: input.prompt }),
    }),
  response: (res) => {
    const body = res.stream();
    if (body === null) raise("DraftFailed", { reason: "the draft helper failed" });
    return body;
  },
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
