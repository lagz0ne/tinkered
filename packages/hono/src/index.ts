import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Context, MiddlewareHandler as Middleware } from "hono";
import type { Many, Namespace, Operation, RunResult, Scope, Tag } from "@tinker/core";
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
    /** Name the server: the extension label becomes `hono:<name>`, so a
     * `NotResolved` names which server was not ready. Absent: `hono`. */
    readonly name?: string;
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
      label: wiring?.name === undefined ? "hono" : `hono:${wiring.name}`,
      start: async (scope, ctx, next) => {
        await next();
        const mounted = await Promise.all(
          readMany(routes).map(async (row) => ({ row, op: await row.load() })),
        );
        const app = new Hono().use(serveRequests(scope, wiring));
        for (const { row, op } of mounted) app.on(row.method, row.path, answerRoute(op, row.route));
        wiring?.mount?.(app);
        /** Register the stop BEFORE the bind settles, so a close landing mid-bind
         * still drains this defer (and keeps the fast-close path off the table).
         * The defer reads the settled stop out of the box; when the bind lands
         * after the defer already ran, it stops at once — exactly one stop either way. */
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
}

/** The current streaming response's writer, bound only for the body run.
 * A declared operation reads it with `depends: { emit: emit.required }`. */
export const emit: Tag.Handle<Stream.Emit> = tag({ label: "hono.emit" });

/** Answer a streaming body with a declared operation. Its usual call object supplies
 * `input` and `tags`; this run also binds {@link emit}, read by the body with
 * `depends: { emit: emit.required }`. The body runs in its own child session
 * (as a tagged call does, ADR 0038). A session-target resource it reads is a
 * new instance, not the route operation's instance. The request session stays
 * open until the body ends or the client cancels; the middleware skips its own
 * close for this request. Without the request session, raise `NoSession`.
 * The body's own span uses the
 * operation's label, while the request span ends when `respond` returns the Response.
 * `ctx.signal` aborts on forced close and `ctx.clock` is the scope clock (a TestClock
 * in tests). Exactly one close per request: finished bodies close graceful (success,
 * or failed when the body rejected), cancelled bodies close forced (cancelled), and
 * client abort on `raw.signal` force-closes through the middleware's listener.
 * Add `text/plain` only when no content-type was set; keep the caller's headers. */
export function stream<T>(
  c: Context,
  op: Operation.Handle<T, void>,
  call?: Scope.Invocation<void>,
): Response;
export function stream<T, I>(
  c: Context,
  op: Operation.Handle<T, I>,
  call: Scope.ProvideInput<I>,
): Response;
export function stream(
  c: Context,
  op: Operation.Handle<unknown, unknown>,
  call?: Scope.Invocation<unknown>,
): Response {
  const session = (c as Context<SessionEnv>).get("tinker.session");
  if (!session) raise("NoSession", { label: "stream" });
  (c as Context<SessionEnv>).set("tinker.kept", true);
  const encoder = new TextEncoder();
  let closed = false;
  const closeOnce = (graceful: boolean): void => {
    if (closed) return;
    closed = true;
    ignoreRejection(session.close(graceful ? { graceful: true } : undefined));
  };
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      const write: Stream.Emit = (chunk) => {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      };
      // Bind the writer on a child session for this response, but run the
      // body without a tagged call: a caught failure in one of its subflows
      // must not turn a successful terminal frame into a rejected body.
      const body = session.createSession({
        tags: [call?.tags, emit(write)],
        ...(call?.ns === undefined ? {} : { ns: call.ns }),
      });
      const running = body.run(op, {
        input: call?.input,
        rawInput: call?.rawInput,
      } as Scope.ProvideInput<unknown>);
      const settled = Promise.resolve(running);
      const finish = settled.then(
        () => {
          controller.close();
          closeOnce(true);
        },
        (error: unknown) => {
          controller.error(error);
          closeOnce(true);
        },
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
/** Settle the route's subflow: a raw-input call, or none for a void input. The package's
 * cast: a controller's overloaded `settle` cannot take "a call or none" on a generic input,
 * and passing `{ rawInput: undefined }` instead would hand extensions a call object. */
function settleFlow<T, I>(
  flow: Scope.OperationController<T, I>,
  call: Scope.Invocation<I> | undefined,
): RunResult<Awaited<T>> | Promise<RunResult<Awaited<T>>> {
  return (flow.settle as (call?: Scope.Invocation<I>) => Scope.Settled<T>)(call);
}

/** Build the request run: input to op subflow to respond to status + one log line.
 * The subflow runs through `settle` (ADR 0067), so a failure answered here, a panic
 * included, never fails the request session; a value returned after a client
 * abort still answers, as `run` would. `onError` answers first;
 * otherwise the default map turns a handled failure into a Response (400/500,
 * request span `ok`) and rethrows the rest — the unmapped path is Hono's, so it
 * writes no log line (Hono's `onError` decides that status). */
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
      });
      return response;
    };
    const respond: HonoScope.Respond<T> = route.respond ?? defaultRespond;
    const readInput = route.input;
    const fail = async (error: unknown): Promise<Response> => {
      const mapped = await mapError(error, c, onError, ctx.signal);
      if (mapped === undefined) {
        done(new Response(null, { status: 499 }));
        throw error;
      }
      return done(mapped);
    };
    const answer = async (): Promise<Response> => {
      let settled: RunResult<Awaited<T>>;
      try {
        const raw = readInput !== undefined ? readInput(c) : undefined;
        const call =
          readInput !== undefined
            ? { rawInput: isThenable(raw) ? await readBody(raw, label) : raw }
            : undefined;
        settled = await settleFlow(flow, call);
      } catch (error: unknown) {
        return fail(error);
      }
      if (settled.status === "success") return done(await respond(settled.value, c));
      return fail(settled.status === "failed" ? settled.error : settled.reason);
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
