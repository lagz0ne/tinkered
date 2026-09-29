import type { Context, Hono } from "hono";
import { operation, type Operation, type Scope } from "@tinker/core";
import type { Sync } from "@tinker/sync";
import { emit, errorResponses, hono, route, stream, type HonoScope } from "@tinker/hono";
import type { Errors } from "../errors.ts";
import { draftBody, readCapability, startDraft } from "./draft.ts";
import { describeError } from "@tinker/stack";
import { addComment, createIssue, editIssue, readDetail, readIssues } from "./operations.ts";
import { createSseServer } from "@tinker/sync/sse";
import { readRegister, src } from "./sync.ts";

export declare namespace IssueServer {
  export type Options = {
    /** Bind a port (`main.ts`) or a fake (a test); absent, the app answers only
     * `app.request`. The scope's close stops it. */
    readonly serve?: HonoScope.Serve;
  };
}

/** Each call is a new extension: resolve the one you listed. */
export function issueServer(options: IssueServer.Options = {}): Scope.Extension<Hono> {
  return hono(issueRoutes, {
    onError: errorResponses<Errors.Payloads>({
      IssueNotFound: { status: 404, body: () => "issue not found" },
      IssueConflict: {
        status: 409,
        body: (payload) => ({
          message: "someone else saved first — reload and try again",
          id: payload.id,
          currentRevision: payload.currentRevision,
          current: payload.current,
        }),
      },
      BadCreateInput: { status: 400, body: (payload) => payload.reason },
      BadEditInput: { status: 400, body: (payload) => payload.reason },
      BadCommentInput: { status: 400, body: (payload) => payload.reason },
      BadDraftInput: { status: 400, body: (payload) => payload.reason },
      BadRegister: { status: 400, body: () => "bad" },
      DraftOff: { status: 404, body: () => "draft helper is off" },
      DraftFailed: { status: 502, body: (payload) => payload.reason },
    }),
    serve: options.serve,
  }).extension;
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
    const wire = createSseServer(emit, signal);
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
