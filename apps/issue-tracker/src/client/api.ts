import { HttpRequest, httpClient } from "@tinker/http";
import { parseCreateInput, parseIssue, parseIssueList } from "../shared/issues.ts";

/** The browser's command frame: POST to save, GET to read. */
export const api = httpClient({ label: "issues", filterStatus: (status) => status < 300 });

/** Save one issue through HTTP; the server owns the saved state. */
export const postIssue = api.operation({
  label: "postIssue",
  input: parseCreateInput,
  request: (input) => HttpRequest.post("/api/issues", { body: HttpRequest.bodyJson(input) }),
  response: (res) => res.json(parseIssue),
});

/** Read the saved list through HTTP (used before sync lands). */
export const getIssues = api.operation({
  label: "getIssues",
  request: () => HttpRequest.get("/api/issues"),
  response: (res) => res.json(parseIssueList),
});
