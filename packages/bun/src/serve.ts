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
   * rejects with a RangeError, and `serve` answers 413 whatever the handler answered.
   */
  maxBody?: number;
};

/** A handler's `maxBody` when it names none: Bun's own default. */
const defaultMaxBody = 1_048_576;

/**
 * How long `serve` reads the rest of a body a reply left unread, in ms (nginx `lingering_time`).
 * Past it, the reply closes the connection with the rest still unread.
 */
const linger = 30_000;

/** Bun's calls that take a request: they know only Bun's own, not a copy. */
const byRequest = new Set<string | symbol>(["requestIP", "timeout", "upgrade"]);

/**
 * A request's body, counted against the cap of the handler that reads it (Hono's `bodyLimit`).
 * `ask` sets `cap` before it asks each handler. A Content-Length or a count past the cap errors
 * the read, and `over` tells `serve` to answer 413. `drained` tells it the body was read to its
 * end; else `finish` reads the rest before the reply goes out. It is its own stream's
 * transformer, and the proxy handler of the `server` the handlers get: that maps the copy back
 * to Bun's own request.
 */
class CappedBody {
  cap = defaultMaxBody;
  seen = 0;
  over = false;
  drained = false;
  /** The Content-Length; 0 when the body is chunked and has none. */
  length: number;
  /** Bun's own request, which Bun's `requestIP`, `timeout` and `upgrade` know. */
  original: Request;
  /** The request each handler gets: the original's url, headers and signal, this body. */
  request: Request;
  /** The server each handler gets: Bun's, with `request` mapped back to `original`. */
  server: Server<never>;
  /** Bun's own body. The copy's cancel or error leaves it open, so `finish` can read the rest. */
  source: ReadableStream<Uint8Array>;
  /** Stops the copy's pipe, which gives `source` back. */
  stop = new AbortController();
  /** The copy's pipe; it settles once `source` is free. */
  piped: Promise<boolean>;

  constructor(request: Request, body: ReadableStream<Uint8Array>, bun: Server<never>) {
    const copy = new TransformStream(this);
    this.length = Number(request.headers.get("content-length"));
    this.original = request;
    this.source = body;

    this.piped = body.pipeTo(copy.writable, { preventCancel: true, signal: this.stop.signal }).then(
      () => true,
      () => false,
    );
    this.request = new Request(request, { body: copy.readable, duplex: "half" } as RequestInit);
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
   * The reply, once the body is read to its end. A close with unread bytes resets the socket, and
   * a proxy still sending the body then answers 502 in place of the reply (RFC 9112 9.6). So the
   * rest is read and dropped first, for up to `linger` (nginx `lingering_close`). Past it, the
   * reply closes the connection: Bun's graceful `stop` would wait on the sender. A reply's headers
   * can be immutable, so that one is a copy. Undefined (an upgrade, Bun's own now) has no body.
   */
  async finish(reply: Response | undefined) {
    if (!reply || this.drained || (await this.discard())) return reply;
    const headers = new Headers(reply.headers);
    headers.set("connection", "close");
    return new Response(reply.body, {
      status: reply.status,
      statusText: reply.statusText,
      headers,
    });
  }

  /** Reads the rest of `source` and drops it: true when it ended within `linger`. */
  private async discard() {
    this.stop.abort();
    await this.piped;

    const reader = this.source.getReader();
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      return reader.cancel();
    }, linger);
    try {
      while (!(await reader.read()).done);
      return !late;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
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
    this.drained = true;
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
      /** A request with no body takes no extra step; a reply waits for an unread body's end. */
      const answer = (request: Request, bun: Server<never>) => {
        if (!request.body) return replyTo(request, null, bun);
        const body = new CappedBody(request, request.body, bun);
        return replyTo(request, body, bun).then((reply) => body.finish(reply));
      };

      const server = Bun.serve({
        port: config.port,
        // Bun's 10 s default cuts a slow request; 60 s (max 255) matches the socket idle time.
        idleTimeout: 60,
        /** Bun's own 413 closes with the body unread (a reset: 502 behind a proxy); serve caps. */
        maxRequestBodySize: Number.MAX_SAFE_INTEGER,
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
