import { capsule, data, tag } from "@tinkered/core";
import type { Capsule, Scope } from "@tinkered/core";
import type { HTMLBundle, Server, WebSocketHandler } from "bun";

/**
 * What a handler capsule's `start` returns, in Bun's own `{ fetch, websocket }` shape. `fetch`
 * answers a Response, null when it upgraded the request to a WebSocket (Bun owns it now), or
 * undefined when the request is not its own: the next handler gets it.
 */
export type Handler = {
  fetch: (
    request: Request,
    scope: Scope.Handle,
    server: Server<never>,
  ) => Response | null | undefined | Promise<Response | null | undefined>;
  /** Bun's socket handler, typed by the handler that owns it. */
  websocket?: WebSocketHandler<never> | object;
  /**
   * The largest request body this handler takes; 1 MiB when unset (Bun's default). `serve`
   * counts the body as this handler reads it: a read past it (by Content-Length or by count)
   * rejects with a RangeError, and `serve` answers 413 whatever the handler answered. The
   * largest of every handler's sets Bun's `maxRequestBodySize`, the server-wide backstop.
   */
  maxBody?: number;
};

/** A handler's `maxBody` when it names none: Bun's own default. */
const defaultMaxBody = 1_048_576;

/** Bun's calls that take a request: they know only Bun's own, not a copy. */
const byRequest = new Set<string | symbol>(["requestIP", "timeout", "upgrade"]);

/**
 * A request's body, counted against the cap of the handler that reads it (Hono's `bodyLimit`).
 * `ask` sets `cap` before it asks each handler. A Content-Length or a count past the cap errors
 * the read, and `over` tells `serve` to answer 413. `ended` tells it the body was read to its
 * end; else the reply closes the connection (Go's net/http). It is its own stream's transformer,
 * and the proxy handler of the `server` the handlers get: that maps the copy back to Bun's own
 * request.
 */
class CappedBody {
  cap = defaultMaxBody;
  seen = 0;
  over = false;
  ended = false;
  /** The Content-Length; 0 when the body is chunked and has none. */
  length: number;
  /** Bun's own request, which Bun's `requestIP`, `timeout` and `upgrade` know. */
  original: Request;
  /** The request each handler gets: the original's url, headers and signal, this body. */
  request: Request;
  /** The server each handler gets: Bun's, with `request` mapped back to `original`. */
  server: Server<never>;

  constructor(request: Request, body: ReadableStream<Uint8Array>, bun: Server<never>) {
    this.length = Number(request.headers.get("content-length"));
    this.original = request;
    this.request = new Request(request, {
      body: body.pipeThrough(new TransformStream(this)),
      duplex: "half",
    } as RequestInit);
    this.server = new Proxy(bun, this);
  }

  /**
   * One handler's reply, its read held to its own cap. A throw from a read past the cap is not
   * the handler's own: the caller answers 413 for it.
   */
  async ask(handler: Handler, scope: Scope.Handle) {
    this.cap = handler.maxBody ?? defaultMaxBody;
    try {
      return await handler.fetch(this.request, scope, this.server);
    } catch (error) {
      if (!this.over) throw error;
    }
  }

  /**
   * The reply, with `connection: close` when the body was not read to its end: the client may
   * still be sending it, and Bun's graceful `stop` would wait on it. A reply's headers can be
   * immutable, so it is a copy. Undefined (an upgrade, Bun's own now) has no reply to close.
   */
  closeIfUnread(reply: Response | undefined) {
    if (!reply || this.ended) return reply;
    const headers = new Headers(reply.headers);
    headers.set("connection", "close");
    return new Response(reply.body, {
      status: reply.status,
      statusText: reply.statusText,
      headers,
    });
  }

  /** A server member, bound to Bun's server; a call that takes a request gets Bun's own. */
  get(bun: Server<never>, key: string | symbol): unknown {
    const value: unknown = Object(bun)[key];
    if (typeof value !== "function") return value;
    if (!byRequest.has(key)) return value.bind(bun);
    return (request: Request, ...rest: unknown[]) =>
      value.call(bun, request === this.request ? this.original : request, ...rest);
  }

  transform(chunk: Uint8Array, out: TransformStreamDefaultController<Uint8Array>) {
    this.seen += chunk.byteLength;
    if (this.seen <= this.cap && !(this.length > this.cap)) return out.enqueue(chunk);
    this.over = true;
    out.error(new RangeError("The body is over its handler's maxBody."));
  }

  /** The stream calls it once the handler has read the body to its end. */
  flush() {
    this.ended = true;
  }
}

const port = tag<number>({ label: "serve.port" });

const pages = tag<Readonly<Record<string, HTMLBundle | Response>>>({
  label: "serve.pages",
  default: {},
});

const handlers = tag<readonly Capsule.Binding<Handler>[]>({
  label: "serve.handlers",
  default: [],
});

/** The one handler that owns Bun's `websocket`: Bun takes one per server. */
const websocket = tag<Capsule.Binding<Handler> | null>({ label: "serve.websocket", default: null });
const paths = tag<readonly string[]>({ label: "serve.paths", default: [] });
const development = tag<boolean>({ label: "serve.development", default: false });

const stdout = tag<{ write(chunk: string): unknown } | null>({
  label: "serve.stdout",
  default: null,
});

/** Where the server listens, once it does; null before. */
const url = data<URL | null>({ label: "serve.url", initial: null });

/** The server and the session its handlers answer in. */
const live = data<{ server: Server<never>; handlers: Scope.Handle } | null>({
  label: "serve.live",
  initial: null,
});

const held = { role: "state", explain: "The listening server" } as const;
const opened = { role: "handler", explain: "The handlers answer in this session" } as const;

/** Every path a handler gets, beside the page: `/api/*`, `/rpc`, `/rpc/*`, then the app's own. */
const handlerPaths = ["/api/*", "/rpc", "/rpc/*"];

/**
 * `Bun.serve` for the life of the scope (Effect's `BunHttpServer.layer`, Go's `http.Server`).
 * It goes first in `capsules`, so its start wraps the others: it listens once every handler has
 * started, and its close stops the port before the handlers close. Its config comes from the cmd
 * (the seam): it reads no `process.env`. Signals and exit codes stay with the host, `run`.
 * - `websocket`: the one handler that brings Bun's `websocket` (ws.server); asked first;
 * - `handlers`: capsules whose start returns a {@link Handler}, asked in order;
 * - `pages`: the client's routes, for every path no handler takes;
 * - `paths`: more Bun route patterns for the handlers;
 * - `stdout`: where it prints `tinker: listening on <url>`.
 */
export const serve = capsule({
  label: "serve",
  config: { port: port.required, pages, websocket, handlers, paths, development, stdout },
  exports: { url },
  hooks: {
    async start({ config, next, session, load, raise }) {
      await next();

      const scope = session({}, opened);
      const socket = config.websocket && scope.resolve(config.websocket);
      const rest = config.handlers.map((handler) => scope.resolve(handler));
      // Bun takes one `websocket` per server: one in `handlers` would be dropped without a word.
      if (rest.some((handler) => handler.websocket !== undefined)) {
        raise("MissingConfig", { label: "serve", key: "websocket" });
      }
      const found = socket ? [socket, ...rest] : rest;
      /** A body over the cap of the handler that read it is a 413, whatever that handler did. */
      const replyTo = async (request: Request, body: CappedBody | null, bun: Server<never>) => {
        for (const handler of found) {
          const reply = await (body
            ? body.ask(handler, scope)
            : handler.fetch(request, scope, bun));
          if (body?.over) return new Response(null, { status: 413 });
          if (reply !== undefined) return reply ?? undefined;
        }
        return new Response(null, { status: 404 });
      };
      /** A request with no body takes no extra step; a reply that leaves a body unread closes. */
      const answer = (request: Request, bun: Server<never>) => {
        if (!request.body) return replyTo(request, null, bun);
        const body = new CappedBody(request, request.body, bun);
        return replyTo(request, body, bun).then((reply) => body.closeIfUnread(reply));
      };

      const server = Bun.serve({
        port: config.port,
        // Bun's 10 s default cuts a slow request; 60 s (max 255) matches the socket idle time.
        idleTimeout: 60,
        maxRequestBodySize: Math.max(
          defaultMaxBody,
          ...found.map((handler) => handler.maxBody ?? 0),
        ),
        // Bun's types want `fetch` beside `websocket`; unset, Bun reads `websocket` as absent.
        websocket: socket?.websocket as never,
        fetch: () => new Response(null, { status: 404 }),
        development: config.development && { hmr: false, console: true },
        routes: {
          ...Object.fromEntries([...handlerPaths, ...config.paths].map((path) => [path, answer])),
          ...config.pages,
        },
      });
      load(live, held).set({ server, handlers: scope });
      load(url, held).set(server.url);
      config.stdout?.write(`tinker: listening on ${server.url}\n`);
    },
    async close({ load, next }) {
      const own = load(live, held).get();
      await own?.server.stop();
      await own?.handlers.close();
      return next();
    },
  },
});
