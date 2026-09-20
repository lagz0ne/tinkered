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

/** Read a JSON body, admitting a missing or malformed one as undefined so the
 * operation's own parser answers the 400 at its door. */
async function readBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/** Every /api route as scope config: the verb plus path, the domain operation,
 * and the request shape. Mounted eagerly by `honoApp` in the composition root. */
export const issueRoutes: readonly Tag.Binding<HonoScope.BoundRoute>[] = [
  route.post("/api/issues", () => createIssue, {
    input: (c) => c.req.json(),
    respond: (issue, c) => c.json(issue, 201),
  }),
  route.patch("/api/issues/:id", () => editIssue, {
    input: async (c) => {
      const body = await readBody(c);
      const id = c.req.param("id");
      return typeof body === "object" && body !== null ? { ...body, id } : { id };
    },
    respond: (issue, c) => c.json(issue, 200),
  }),
  route.post("/api/issues/:id/comments", () => addComment, {
    input: async (c) => {
      const body = await readBody(c);
      const issueId = c.req.param("id");
      return typeof body === "object" && body !== null ? { ...body, issueId } : { issueId };
    },
    respond: (comment, c) => c.json(comment, 201),
  }),
  route.get("/api/issues/:id", () => readDetail, {
    input: (c) => c.req.param("id"),
  }),
  route.get("/api/issues", () => readIssues),
  route.get("/api/draft", () => readCapability),
];
