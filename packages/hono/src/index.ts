import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Context, MiddlewareHandler as Middleware } from "hono";
import type { Many, Namespace, Operation, Scope, Tag } from "@tinker/core";
import { extension, isError as isCoreError, readMany, tag } from "@tinker/core";
import { isError, raise } from "./errors.ts";

/** A Hono route endpoint: takes the context, answers the response. */
type Endpoint = (c: Context) => Promise<Response>;

export { isError };
export type { Errors } from "./errors.ts";

/** The web Request for this request, bound on the request session for the rare
 * operation that needs headers or the url. */
export const request: Tag.Handle<Request> = tag({ label: "hono.request" });

export declare namespace HonoScope {
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
   * shape. Handed to `hono(routes)` — plain data, not a scope tag. */
  export type Row = {
    readonly method: Method;
    readonly path: string;
    readonly load: Load<unknown, unknown>;
    readonly route: {
      readonly input?: Input;
      readonly respond?: Respond<unknown>;
    };
  };
  /** Wiring for {@link hono}: request-derived tag bindings, first-hand
   * errors, hand-mounted extras, and the process-edge bind. */
  export type Wiring = {
    readonly onError?: OnError;
    readonly tags?: (c: Context) => Tag.Bindings;
    /** Select the request's namespace; absent or undefined uses the default. */
    readonly ns?: (c: Context) => Namespace | readonly Namespace[] | undefined;
    /** Hand-mounted extras: routes that need `stream` directly and cannot
     * be rows yet. Runs after the rows, inside the same session middleware,
     * so `stream` sees the request session. */
    readonly mount?: (app: Hono) => void;
    /** Bind the process edge (a port, a test fake): runs after mount and is
     * awaited before `start` settles — a refusing port fails boot, never a
     * request. The returned stop runs on scope close (`ctx.defer`), so two
     * `hono` extensions on one scope are two servers one close reaps. */
    readonly serve?: Serve;
  };
  /** Bind the built app to the outside world: a port in production, a fake
   * in tests. */
  export type Serve = (app: Hono) => Served | PromiseLike<Served>;
  /** What a `serve` bind hands back: a stop thunk, a closer, or nothing. */
  export type Served =
    | (() => void | PromiseLike<void>)
    | { readonly close: () => void | PromiseLike<void> }
    | void;
}

type SessionEnv = {
  Variables: {
    "tinker.session": Scope.Handle;
    "tinker.onError": HonoScope.OnError | undefined;
    "tinker.kept": boolean;
  };
};

/** The Hono driver, an extension the scope owns (ADR 0060): `hono(routes)`
 * returns the route value plus the bridge extension — the entrypoint pulls the
 * scope at boot through `createScope({ extensions })`, never the reverse.
 * `start` resolves its hand once (`await next()`, so a second extension's
 * `start` work is visible), loads every row's operation once (a rejecting
 * loader rejects `start` — `ready` rejects, the scope closes failed, boot
 * fails never a request), then builds the one Hono app: the session
 * middleware plus one endpoint per row, then `mount`, then the opt-in `serve`
 * bind (a refusing port fails boot; the bind and its stop are atomic — the
 * stop registers before the bind settles, so a close landing mid-bind still
 * reaps the listener exactly once — and one `scope.close()` reaps every
 * `hono` extension on it). The value is the app. This `start` is the
 * extension's ONE use of the scope: per request the
 * middleware opens sessions from the captured root handle. */
export function hono(
  routes: Many<HonoScope.Row>,
  wiring?: HonoScope.Wiring,
): { readonly extension: Scope.Extension<Hono> } {
  return {
    extension: extension<Hono>({
      label: "hono",
      start: async (scope, ctx, next) => {
        await next();
        const mounted = await Promise.all(
          readMany(routes).map(async (row) => ({ row, op: await row.load() })),
        );
        const app = new Hono().use(serveRequests(scope, wiring));
        for (const { row, op } of mounted) app.on(row.method, row.path, answerRoute(op, row.route));
        wiring?.mount?.(app);
        let served: HonoScope.Served | undefined;
        let stopped = false;
        ctx.defer(() => {
          stopped = true;
          return readStop(served);
        });
        served = await wiring?.serve?.(app);
        if (stopped) await readStop(served);
        return app;
      },
    }),
  };
}

/** Read the stop thunk out of a `serve` bind: a bare function, a `.close`
 * object (the node server), or nothing — deferred to scope close. */
function readStop(served: HonoScope.Served | undefined): void | PromiseLike<void> {
  if (served === undefined) return undefined;
  if (typeof served === "function") return served();
  return served.close();
}

/** Open one session per request, bound with the request plus any request-derived tags.
 * A client abort force-closes the session (rollback); after the handler the session
 * closes graceful (commit). */
function serveRequests(scope: Scope.Handle, wiring: HonoScope.Wiring | undefined): Middleware {
  return createMiddleware<SessionEnv>(async (c, next) => {
    const raw = c.req.raw;
    const ns = wiring?.ns?.(c);
    const session = scope.createSession({
      tags: [request(raw), wiring?.tags?.(c)],
      ...(ns === undefined ? {} : { ns }),
    });
    c.set("tinker.session", session);
    c.set("tinker.onError", wiring?.onError);
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
 * It is synchronous, so a sync `watch` callback can push straight into the body (ADR 0021:
 * SSE is an adapter over watched cells). The producer does no backpressure wait (a v1
 * simplification). Failing to enqueue throws the enqueue error to the writer. */
export declare namespace Stream {
  /** Write one body chunk into the streaming response. */
  export type Emit = (chunk: string | Uint8Array) => void;
  /** The body producer: runs as its own inline operation, so it reads `ctx` (signal,
   * clock, log, its span) while the request span has already ended with the headers. */
  export type Write = (emit: Emit, ctx: Operation.Ctx<void>) => Promise<void>;
}

/** Answer a streaming body: keep the request session open until the body ends or the
 * client cancels, then close it — the middleware's `finally` skips its own close for this
 * request. Call from inside the extension's middleware (a route's `respond`); without the
 * session it raises `NoSession`. The writer runs as an inline operation (`"GET /path body"`) so
 * `ctx.signal` aborts on a forced close, `ctx.clock` is the scope clock (a TestClock
 * in tests), and its span is the body's own. The request span (the endpoint's inline op)
 * still ends when `respond` returns this Response. Close ownership: exactly one close
 * per request — a finished body closes graceful (resolved: defers see `success`;
 * rejected: the recorded body failure settles the outcome, defers see `failed`, while
 * the error itself already reached the reader), a cancelled body closes forced
 * (defers see `cancelled`); a client abort on `raw.signal` still force-closes through
 * the middleware's listener. Adds a `text/plain` content-type only when the caller set none;
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

/** One verb's builder: the path, the operation (or a loader for the lazy case),
 * the request shape. `input` is required when the operation takes one. A loader
 * runs once at `start`. */
type Verb = {
  <T>(
    path: string,
    load: Operation.Handle<T, void> | HonoScope.Load<T, void>,
    opts?: HonoScope.Route<void, T>,
  ): HonoScope.Row;
  <T, I>(
    path: string,
    load: Operation.Handle<T, I> | HonoScope.Load<T, I>,
    opts: HonoScope.Route<I, T> & { readonly input: HonoScope.Input },
  ): HonoScope.Row;
};

function verb(method: HonoScope.Method): Verb {
  const bind = (
    path: string,
    load: Operation.Handle<unknown, unknown> | HonoScope.Load<unknown, unknown>,
    opts?: {
      readonly input?: HonoScope.Input;
      readonly respond?: HonoScope.Respond<unknown>;
    },
  ): HonoScope.Row => ({
    method,
    path,
    load: typeof load === "function" ? load : () => load,
    route: { input: opts?.input, respond: opts?.respond },
  });
  return bind as Verb;
}

/** Name a route row: `route.get(path, op, opts?)` and friends, one per verb. Each
 * returns a plain row; the extension mounts every row handed to it. A loader
 * function is the lazy case (a dynamic `import`); an eager handle is the norm. */
export const route: Record<"get" | "post" | "put" | "patch" | "delete", Verb> = {
  get: verb("GET"),
  post: verb("POST"),
  put: verb("PUT"),
  patch: verb("PATCH"),
  delete: verb("DELETE"),
};

/** Default `respond`: answer the value as JSON. */
function defaultRespond<T>(value: Awaited<T>, c: Context): Response {
  return c.json(value);
}

/** Run a route's operation in the request session and answer. No session → `NoSession`. */
function answerRoute<T, I>(op: Operation.Handle<T, I>, route: HonoScope.Route<I, T>): Endpoint {
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
  route: HonoScope.Route<I, T>,
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
    const respond: HonoScope.Respond<T> = route.respond ?? defaultRespond;
    const readInput = route.input;
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
