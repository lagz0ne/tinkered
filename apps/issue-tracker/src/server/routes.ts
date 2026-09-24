import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { LEVELS, operation, type Observe } from "@tinker/core";
import { z } from "zod";
import { emit, route, stream, type HonoScope } from "@tinker/hono";
import { isError } from "../errors.ts";
import { draftBody, readCapability, startDraft } from "./draft.ts";
import { describeError } from "./observe.ts";
import { addComment, createIssue, editIssue, readDetail, readIssues } from "./operations.ts";
import { registerViewer, src, sseTransport, viewers } from "./sync.ts";

/** Map a registry failure to its status; anything else falls through to Hono. */
export function onError(error: unknown, c: Parameters<HonoScope.OnError>[1]) {
  return readIssueError(error, c) ?? readStreamError(error, c);
}

/** Hono's last handler: an error `onError` did not map is a bug, so it answers
 * 500 and writes one log line through the scope's sink (Hono's default would
 * `console.error`, off the seam). An `HTTPException` keeps its own response. */
export function reportUnmapped(observe: Observe.Config | undefined): ErrorHandler {
  return (error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    observe?.log?.({
      time: observe.clock?.() ?? Date.now(),
      level: LEVELS.error,
      message: "request failed",
      attributes: { method: c.req.method, path: c.req.path, ...describeError(error) },
      span: undefined,
    });
    return c.text("internal", 500);
  };
}

function readIssueError(error: unknown, c: Parameters<HonoScope.OnError>[1]) {
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
  return undefined;
}

function readStreamError(error: unknown, c: Parameters<HonoScope.OnError>[1]) {
  if (isError(error, "BadDraftInput")) return c.text(error.payload.reason, 400);
  if (isError(error, "BadRegister")) return c.text("bad", 400);
  if (isError(error, "ViewerGone")) return c.text("gone", 410);
  if (isError(error, "DraftOff")) return c.text("draft helper is off", 404);
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

/** Check the source and inbox are up before sending the stream headers. */
const openWire = operation({
  label: "openWire",
  depends: { origin: src, wires: viewers },
  run: () => undefined,
});

/** Keep the sync wire alive until the source ends or the reader leaves. */
const syncBody = operation({
  label: "syncBody",
  input: z.string(),
  depends: { emit: emit.required, origin: src, wires: viewers },
  run: async ({ emit, origin, wires }, { input: id, signal, log, defer }) => {
    emit(": ready\n\n");
    const wire = sseTransport(emit, signal);
    const close = wires.open(id, wire.deliver);
    defer(close);
    const ended = await origin.connect(wire);
    if (ended.status === "failed")
      log.error("sync wire failed", { client: id, ...describeError(ended.error) });
  },
});

/** Every /api route as flat rows: the verb plus path, the domain operation,
 * and the request shape. Handed to `hono(routes)` in the composition root. */
export const issueRoutes: readonly HonoScope.Row[] = [
  route.post("/api/issues", createIssue, {
    input: (c) => readBody(c, {}),
    respond: (issue, c) => c.json(issue, 201),
  }),
  route.patch("/api/issues/:id", editIssue, {
    input: (c) => readBody(c, { id: c.req.param("id") }),
    respond: (issue, c) => c.json(issue, 200),
  }),
  route.post("/api/issues/:id/comments", addComment, {
    input: (c) => readBody(c, { issueId: c.req.param("id") }),
    respond: (comment, c) => c.json(comment, 201),
  }),
  route.get("/api/issues/:id", readDetail, {
    input: (c) => c.req.param("id"),
  }),
  route.get("/api/issues", readIssues),
  route.get("/api/draft", readCapability),
  route.post("/api/issues/:id/draft", startDraft, {
    input: (c) => readBody(c, { id: c.req.param("id") }),
    respond: (started, c) => {
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      return stream(c, draftBody, { input: started });
    },
  }),
  route.post("/sync", registerViewer, {
    input: async (c) => ({
      id: c.req.query("client") ?? "guest",
      message: await c.req.json(),
    }),
    respond: (_v, c) => c.text("ok"),
  }),
  route.get("/sync", openWire, {
    respond: (_ready, c) => {
      const id = c.req.query("client") ?? "guest";
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      return stream(c, syncBody, { input: id });
    },
  }),
];
