import { Hono } from "hono";
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
    /** Hand-mounted extras: routes that need `stream` or `handle` directly and cannot
     * be route bindings yet. Runs after the bound rows, inside the same session
     * middleware, so `handle` and `stream` see the request session. */
    readonly mount?: (app: Hono) => void;
  };
  /** Answer a request failure: return a Response to use it, `undefined` for the default map. */
  export type OnError = (
    error: unknown,
    c: Context,
  ) => Response | undefined | Promise<Response | undefined>;
  /** Read the raw input off the request; may return a promise (a JSON body read).
   * A promise is awaited before the operation runs; a rejection answers 400 like a
   * parse failure — the request edge could not read what the client sent. */
  export type Input = (c: Context) => unknown;
  /** How a route answers: parses the request into raw input and writes the value. `I`
   * selects the overload (required `input` when the operation takes one); only `T` is read. */
  export type Route<_I, T> = {
    readonly input?: Input;
    readonly respond?: Respond<T>;
  };
  /** Write the operation's value as a Response (default `c.json(value)`). */
  export type Respond<T> = (value: Awaited<T>, c: Context) => Response | Promise<Response>;
  /** An HTTP verb a scope-bound route answers. */
  export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Load the route's operation. A dynamic `import` in practice; an eager handle
   * is allowed. Runs once at mount — a server is eager (ADR 0042). */
  export type Load<T, I> = () => Operation.Handle<T, I> | PromiseLike<Operation.Handle<T, I>>;
  /** One row of the routing table: the verb plus path, the loader, and the request
   * shape. Bound with `route.get` and friends, read through `routes.all`. */
  export type BoundRoute = {
    readonly method: Method;
    readonly path: string;
    readonly load: Load<unknown, unknown>;
    readonly route: {
      readonly input?: Input;
      readonly respond?: Respond<unknown>;
    };
  };
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

/** The routing table: every bound route, read through `routes.all` from the
 * scope `honoApp` receives. Mount reads the bound verbs and paths. */
export const routes: Tag.Handle<HonoScope.BoundRoute> = tag({ label: "hono.route" });

/** One verb's builder: the path, the loader, the request shape. `input` is required
 * when the operation takes one. Every loader runs once at mount. */
type Verb = {
  <T>(
    path: string,
    load: HonoScope.Load<T, void>,
    opts?: HonoScope.Route<void, T>,
  ): Tag.Binding<HonoScope.BoundRoute>;
  <T, I>(
    path: string,
    load: HonoScope.Load<T, I>,
    opts: HonoScope.Route<I, T> & { readonly input: HonoScope.Input },
  ): Tag.Binding<HonoScope.BoundRoute>;
};

function verb(method: HonoScope.Method): Verb {
  const bind = (
    path: string,
    load: HonoScope.Load<unknown, unknown>,
    opts?: {
      readonly input?: HonoScope.Input;
      readonly respond?: HonoScope.Respond<unknown>;
    },
  ): Tag.Binding<HonoScope.BoundRoute> =>
    routes({ method, path, load, route: { input: opts?.input, respond: opts?.respond } });
  return bind as Verb;
}

/** Bind a route: `route.get(path, load, opts?)` and friends, one per verb. Each
 * returns a binding of the `routes` tag; `honoApp` mounts every bound row. */
export const route: Record<"get" | "post" | "put" | "patch" | "delete", Verb> = {
  get: verb("GET"),
  post: verb("POST"),
  put: verb("PUT"),
  patch: verb("PATCH"),
  delete: verb("DELETE"),
};

/** Mount every route bound on the scope, eagerly: each loader runs once here, so a
 * rejecting loader rejects `honoApp` itself — boot fails, never a request. Then the
 * session middleware plus one endpoint per row. `tinker` + `handle` stay public
 * for hand mounting; this composes them, it adds no request logic of its own. */
export async function honoApp(scope: Scope.Handle, options?: HonoScope.Options): Promise<Hono> {
  const table = scope.resolve(routes.all);
  const loaded = await Promise.all(table.map((row) => Promise.resolve(row.load())));
  const app = new Hono().use(tinker(scope, options));
  loaded.forEach((op, index) => {
    const row = table[index];
    app.on(row.method, row.path, handle(op, row.route));
  });
  options?.mount?.(app);
  return app;
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
  route: HonoScope.Route<I, T> & { readonly input: HonoScope.Input },
): Endpoint;
export function handle<T, I>(op: Operation.Handle<T, I>, route?: HonoScope.Route<I, T>): Endpoint {
  const run = (c: Context): Promise<Response> => {
    const session = (c as Context<SessionEnv>).get("tinker.session");
    if (!session) raise("NoSession", { label: op.label });
    const onError = (c as Context<SessionEnv>).get("tinker.onError");
    return session.run({
      label: `${c.req.method} ${c.req.routePath}`,
      depends: { op },
      run: readRoute(route, c, onError, op.label),
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
  label: string,
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
        const raw = readInput !== undefined ? readInput(c) : undefined;
        const ran =
          readInput !== undefined
            ? isThenable(raw)
              ? flow.run({ rawInput: await readBody(raw, label) })
              : flow.run({ rawInput: raw })
            : runVoid(flow);
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

/** Read an async body: a rejection is the client's fault, named at the request edge. */
async function readBody(raw: PromiseLike<unknown>, label: string): Promise<unknown> {
  try {
    return await raw;
  } catch (cause: unknown) {
    raise("InputRejected", { label, cause });
  }
}

/** Map a request failure to a Response. `onError` answers first; the default map answers
 * 400 (input parse, or the body read itself failing), 500 (a missing binding); anything
 * else rethrows to Hono's `onError`. A cancelled request logs 499 then rethrows — Hono
 * ends an aborted request itself. */
function mapError(
  error: unknown,
  c: Context,
  onError: HonoScope.OnError | undefined,
  signal: AbortSignal,
): Promise<Response | undefined> {
  const custom = onError ? onError(error, c) : undefined;
  return Promise.resolve(custom).then((response) => {
    if (response) return response;
    if (isCoreError(error, "DataValidationFailed") || isError(error, "InputRejected"))
      return c.text("bad request", 400);
    if (signal.aborted || error === signal.reason) return undefined;
    if (isCoreError(error, "MissingTag") || isError(error, "NoSession"))
      return c.text("internal", 500);
    throw error;
  });
}

const noop = (): void => undefined;

/** Await only when the input read returned a promise: a sync read must stay on the
 * same tick so a client abort still force-closes the running operation. */
function isThenable(raw: unknown): raw is PromiseLike<unknown> {
  return (
    raw !== null &&
    (typeof raw === "object" || typeof raw === "function") &&
    typeof (raw as { then?: unknown }).then === "function"
  );
}

/** Track the abort-time close the session already owns (close never throws, ADR 0027):
 * the abort listener keeps no awaiter, so attach the shared no-op and never leave an
 * unhandled rejection; the `finally` below still awaits the same close. */
function ignoreRejection(promise: Promise<unknown>): void {
  promise.then(noop, noop);
}
