import { createMiddleware } from "hono/factory";
import type { Context, MiddlewareHandler as Middleware } from "hono";
import type { Operation, Scope, Tag } from "@tinker/core";
import { isError as isCoreError, tag } from "@tinker/core";
import { isError, raise } from "./errors.ts";

/** A Hono route endpoint: takes the context, answers the response. */
type Endpoint = (c: Context) => Promise<Response>;

export { isError };
export type { Errors } from "./errors.ts";

/** The web Request for this request, bound on the request session for the rare
 * operation that needs headers or the url. */
export const request: Tag.Handle<Request> = tag({ label: "hono.request" });

export declare namespace HonoScope {
  /** Options for {@link tinker}: request-derived tag bindings plus first-hand errors. */
  export type Options = {
    readonly tags?: (c: Context) => readonly Tag.Binding<unknown>[];
    readonly onError?: OnError;
  };
  /** Answer a request failure: return a Response to use it, `undefined` for the default map. */
  export type OnError = (
    error: unknown,
    c: Context,
  ) => Response | undefined | Promise<Response | undefined>;
  /** How a route answers: parses the request into raw input and writes the value. `I`
   * selects the overload (required `input` when the operation takes one); only `T` is read. */
  export type Route<_I, T> = {
    readonly input?: (c: Context) => unknown;
    readonly respond?: Respond<T>;
  };
  /** Write the operation's value as a Response (default `c.json(value)`). */
  export type Respond<T> = (value: Awaited<T>, c: Context) => Response | Promise<Response>;
}

type SessionEnv = {
  Variables: {
    "tinker.session": Scope.Handle;
    "tinker.onError": HonoScope.OnError | undefined;
    "tinker.kept": boolean;
  };
};

/** Open one session per request, bound with the request plus any request-derived tags.
 * A client abort force-closes the session (rollback); after the handler the session
 * closes graceful (commit). */
export function tinker(scope: Scope.Handle, options?: HonoScope.Options): Middleware {
  return createMiddleware<SessionEnv>(async (c, next) => {
    const raw = c.req.raw;
    const session = scope.createSession({
      tags: [request(raw), ...(options?.tags?.(c) ?? [])],
    });
    c.set("tinker.session", session);
    c.set("tinker.onError", options?.onError);
    const onAbort = (): void => {
      ignoreRejection(session.close());
    };
    raw.signal.addEventListener("abort", onAbort, { once: true });
    try {
      await next();
    } finally {
      if (!(c as Context<SessionEnv>).get("tinker.kept")) {
        raw.signal.removeEventListener("abort", onAbort);
        await session.close({ graceful: true });
      }
    }
  });
}

/** One `emit` call enqueues one chunk: strings are UTF-8 encoded, bytes pass through.
 * It resolves once enqueued; the producer does no extra backpressure wait (a v1
 * simplification). Failing to enqueue throws the enqueue error to the writer. */
export declare namespace Stream {
  /** Write one body chunk into the streaming response. */
  export type Emit = (chunk: string | Uint8Array) => Promise<void>;
  /** The body producer: runs as its own inline operation, so it reads `ctx` (signal,
   * clock, log, its span) while the request span has already ended with the headers. */
  export type Write = (emit: Emit, ctx: Operation.Ctx<void>) => Promise<void>;
}

/** Answer a streaming body: keep the request session open until the body ends or the
 * client cancels, then close it — `tinker`'s `finally` skips its own close for this
 * request. Call from inside `tinker` (a route's `respond`); without the session it
 * raises `NoSession`. The writer runs as an inline operation (`"GET /path body"`) so
 * `ctx.signal` aborts on a forced close, `ctx.clock` is the scope clock (a TestClock
 * in tests), and its span is the body's own. The request span (`handle`'s inline op)
 * still ends when `respond` returns this Response. Close ownership: exactly one close
 * per request — a finished body closes graceful (resolved: defers see `success`;
 * rejected: the recorded body failure settles the outcome, defers see `failed`, while
 * the error itself already reached the reader), a cancelled body closes forced
 * (defers see `cancelled`); a client abort on `raw.signal` still force-closes through
 * `tinker`'s listener. Adds a `text/plain` content-type only when the caller set none;
 * headers stay the caller's. */
export function stream(c: Context, write: Stream.Write): Response {
  const session = (c as Context<SessionEnv>).get("tinker.session");
  if (!session) raise("NoSession", { label: "stream" });
  (c as Context<SessionEnv>).set("tinker.kept", true);
  const encoder = new TextEncoder();
  const label = `${c.req.method} ${c.req.routePath} body`;
  let closed = false;
  const closeOnce = (graceful: boolean): void => {
    if (closed) return;
    closed = true;
    ignoreRejection(session.close(graceful ? { graceful: true } : undefined));
  };
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: Stream.Emit = (chunk) => {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        return Promise.resolve();
      };
      const running = session.run({
        label,
        run: (_deps, ctx) => write(emit, ctx),
      });
      const settled = Promise.resolve(running);
      ignoreRejection(
        settled.then(
          () => {
            controller.close();
          },
          (error: unknown) => {
            controller.error(error);
          },
        ),
      );
      const finish = settled.then(
        () => closeOnce(true),
        () => closeOnce(true),
      );
      ignoreRejection(finish);
    },
    cancel() {
      closeOnce(false);
    },
  });
  if (c.res.headers.get("content-type") === null)
    c.header("Content-Type", "text/plain; charset=UTF-8");
  return c.body(readable);
}

/** Default `respond`: answer the value as JSON. */
function defaultRespond<T>(value: Awaited<T>, c: Context): Response {
  return c.json(value);
}

/** Run a route's operation in the request session and answer. No session \u2192 `NoSession`. */
export function handle<T>(
  op: Operation.Handle<T, void>,
  route?: HonoScope.Route<void, T>,
): Endpoint;
export function handle<T, I>(
  op: Operation.Handle<T, I>,
  route: HonoScope.Route<I, T> & { readonly input: (c: Context) => unknown },
): Endpoint;
export function handle<T, I>(op: Operation.Handle<T, I>, route?: HonoScope.Route<I, T>): Endpoint {
  const run = (c: Context): Promise<Response> => {
    const session = (c as Context<SessionEnv>).get("tinker.session");
    if (!session) raise("NoSession", { label: op.label });
    const onError = (c as Context<SessionEnv>).get("tinker.onError");
    return session.run({
      label: `${c.req.method} ${c.req.routePath}`,
      depends: { op },
      run: readRoute(route, c, onError),
    });
  };
  return run;
}
/** Run a void-input subflow with no call object. The one cast in the package: a
 * void-input controller's overloaded `run` cannot shed its call shapes generically. */
function runVoid<T, I>(flow: Scope.OperationController<T, I>): T {
  return (flow.run as () => T)();
}

/** Build the request run: input to op subflow to respond to status + one log line.
 * `onError` answers first; otherwise the default map turns a handled failure into
 * a Response (400/500, request span `ok`) and rethrows the rest — the unmapped
 * path is Hono's, so it writes no log line (Hono's `onError` decides that status). */
function readRoute<T, I>(
  route: HonoScope.Route<I, T> | undefined,
  c: Context,
  onError: HonoScope.OnError | undefined,
): (
  deps: { readonly op: Scope.OperationController<T, I> },
  ctx: Operation.Ctx<void>,
) => Promise<Response> {
  return ({ op: flow }, ctx) => {
    const method = c.req.method;
    const pattern = c.req.routePath;
    const path = c.req.path;
    const started = ctx.clock.currentTimeMillis();
    const span = ctx.obs.span;
    if (span) {
      span.attributes.method = method;
      span.attributes.route = pattern;
      span.attributes.path = path;
    }
    const done = (response: Response): Response => {
      if (span) span.attributes.status = response.status;
      ctx.log("http request", {
        method,
        route: pattern,
        path,
        status: response.status,
        ms: ctx.clock.currentTimeMillis() - started,
      });
      return response;
    };
    const respond: HonoScope.Respond<T> = route?.respond ?? defaultRespond;
    const readInput = route?.input;
    const answer = async (): Promise<Response> => {
      let value: Awaited<T>;
      try {
        const ran = readInput !== undefined ? flow.run({ rawInput: readInput(c) }) : runVoid(flow);
        value = await ran;
      } catch (error: unknown) {
        const mapped = await mapError(error, c, onError, ctx.signal);
        if (mapped === undefined) {
          done(new Response(null, { status: 499 }));
          throw error;
        }
        return done(mapped);
      }
      return done(await respond(value, c));
    };
    return answer();
  };
}

/** Map a request failure to a Response. `onError` answers first; the default map answers
 * 400 (input parse), 500 (a missing binding); anything else rethrows to Hono's `onError`.
 * A cancelled request logs 499 then rethrows — Hono ends an aborted request itself. */
function mapError(
  error: unknown,
  c: Context,
  onError: HonoScope.OnError | undefined,
  signal: AbortSignal,
): Promise<Response | undefined> {
  const custom = onError ? onError(error, c) : undefined;
  return Promise.resolve(custom).then((response) => {
    if (response) return response;
    if (isCoreError(error, "DataValidationFailed")) return c.text("bad request", 400);
    if (signal.aborted || error === signal.reason) return undefined;
    if (isCoreError(error, "MissingTag") || isError(error, "NoSession"))
      return c.text("internal", 500);
    throw error;
  });
}

const noop = (): void => undefined;

/** Track the abort-time close the session already owns (close never throws, ADR 0027):
 * the abort listener keeps no awaiter, so attach the shared no-op and never leave an
 * unhandled rejection; the `finally` below still awaits the same close. */
function ignoreRejection(promise: Promise<unknown>): void {
  promise.then(noop, noop);
}
