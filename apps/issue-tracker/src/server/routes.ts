import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { LEVELS, operation, type Observe, type Operation, type Scope } from "@tinker/core";
import type { Sync } from "@tinker/sync";
import { emit, hono, route, stream, type HonoScope } from "@tinker/hono";
import { isError } from "../errors.ts";
import { draftBody, readCapability, startDraft } from "./draft.ts";
import { describeError } from "@tinker/stack";
import { addComment, createIssue, editIssue, readDetail, readIssues } from "./operations.ts";
import { readRegister, src, sseTransport } from "./sync.ts";

export declare namespace IssueServer {
  export type Options = {
    /** Where the 500 line for an error no route mapped goes (absent: dropped). */
    readonly observe?: Observe.Config;
    /** Bind a port (`main.ts`) or a fake (a test); absent, the app answers only
     * `app.request`. The scope's close stops it. */
    readonly serve?: HonoScope.Serve;
  };
}

/** The issue routes as one Hono server. The unmapped-error handler installs in
 * `mount`, which runs before `serve`, so no request can reach the app without
 * it. Each call is a new extension: resolve the one you listed. */
export function issueServer(options: IssueServer.Options = {}): Scope.Extension<Hono> {
  return hono(issueRoutes, {
    onError,
    mount: (app) => {
      app.onError(reportUnmapped(options.observe));
    },
    serve: options.serve,
  }).extension;
}

/** Map a registry failure to its status; anything else falls through to Hono. */
export function onError(error: unknown, c: Parameters<HonoScope.OnError>[1]) {
  return readIssueError(error, c) ?? readStreamError(error, c);
}

/** Hono's last handler: an error `onError` did not map is a bug, so it answers
 * 500 and writes one log line through the scope's sink (Hono's default would
 * `console.error`, off the seam). An `HTTPException` keeps its own response. */
export function reportUnmapped(observe: Observe.Config | undefined) {
  return (error: Error, c: Context) => {
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
  if (isError(error, "DraftOff")) return c.text("draft helper is off", 404);
  if (isError(error, "DraftFailed")) return c.text(error.payload.reason, 502);
  return undefined;
}

/** Merge a JSON body over the route's path values; a JSON non-object reads as the
 * path values alone. A missing or malformed body rejects out of `c.req.json()`,
 * and the `hono` extension answers 400 at the request edge. */
async function readBody(c: Context, extra: Record<string, unknown>): Promise<unknown> {
  const body = await c.req.json();
  return typeof body === "object" && body !== null ? { ...body, ...extra } : extra;
}

/** Read the stream's keys and check the source is up before sending the stream headers: a bad
 * key set answers 400 while the response can still say so. */
const openWire = operation({
  label: "openWire",
  input: readRegister,
  depends: { origin: src },
  run: (_deps, { input }) => input,
});

/** Keep the sync wire alive until the source ends or the reader leaves. The first frame sets
 * the browser's reconnect wait; then the register read off the URL goes to the source, which
 * answers it with a snapshot per key. */
const syncBody = operation({
  label: "syncBody",
  depends: { emit: emit.required, origin: src },
  run: async ({ emit, origin }, { input: register, signal, log }: Operation.Ctx<Sync.Message>) => {
    emit("retry: 1000\n\n");
    const wire = sseTransport(emit, signal);
    const connected = origin.connect(wire);
    wire.deliver(register);
    const ended = await connected;
    if (ended.status === "failed") log.error("sync wire failed", describeError(ended.error));
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
  route.get("/sync", openWire, {
    input: (c) => c.req.queries("keys") ?? [],
    respond: (register, c) => {
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      return stream(c, syncBody, { input: register });
    },
  }),
];
