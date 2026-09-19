import { HttpRequest, httpClient } from "@tinker/http";
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
