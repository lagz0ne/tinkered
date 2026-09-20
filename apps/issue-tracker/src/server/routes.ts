import type { Context } from "hono";
import type { Tag } from "@tinker/core";
import { route, type HonoScope } from "@tinker/hono";
import { isError } from "../errors.ts";
import { readCapability } from "./draft.ts";
import { addComment, createIssue, editIssue, readDetail, readIssues } from "./operations.ts";

/** Map a registry failure to its status; anything else falls through to Hono. */
export function onError(error: unknown, c: Parameters<HonoScope.OnError>[1]) {
  if (isError(error, "IssueNotFound")) return c.text("issue not found", 404);
  if (isError(error, "IssueConflict")) {
    return c.json(
      {
        message: "someone else saved first — reload and try again",
        id: error.payload.id,
        currentRevision: error.payload.currentRevision,
        current: error.payload.current,
      },
      409,
    );
  }
  if (isError(error, "BadCreateInput") || isError(error, "BadEditInput")) {
    return c.text(error.payload.reason, 400);
  }
  if (isError(error, "BadCommentInput")) return c.text(error.payload.reason, 400);
  if (isError(error, "BadDraftInput")) return c.text(error.payload.reason, 400);
  if (isError(error, "DraftFailed")) return c.text(error.payload.reason, 502);
  return undefined;
}

/** Merge a JSON body over the route's path values. A missing body reads as the
 * path values alone; a malformed one rejects out of `c.req.json()` and hono
 * answers 400 at the request edge. */
async function readBody(c: Context, extra: Record<string, unknown>): Promise<unknown> {
  const body = await c.req.json();
  return typeof body === "object" && body !== null ? { ...body, ...extra } : extra;
}

/** Every /api route as scope config: the verb plus path, the domain operation,
 * and the request shape. Mounted eagerly by `honoApp` in the composition root. */
export const issueRoutes: readonly Tag.Binding<HonoScope.BoundRoute>[] = [
  route.post("/api/issues", () => createIssue, {
    input: (c) => readBody(c, {}),
    respond: (issue, c) => c.json(issue, 201),
  }),
  route.patch("/api/issues/:id", () => editIssue, {
    input: (c) => readBody(c, { id: c.req.param("id") }),
    respond: (issue, c) => c.json(issue, 200),
  }),
  route.post("/api/issues/:id/comments", () => addComment, {
    input: (c) => readBody(c, { issueId: c.req.param("id") }),
    respond: (comment, c) => c.json(comment, 201),
  }),
  route.get("/api/issues/:id", () => readDetail, {
    input: (c) => c.req.param("id"),
  }),
  route.get("/api/issues", () => readIssues),
  route.get("/api/draft", () => readCapability),
];
