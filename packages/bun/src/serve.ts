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
   * counts the body as this handler reads it: a Content-Length or a count past it fails the read,
   * and `serve` answers 413 whatever the handler answered. The largest of every handler's sets
   * Bun's `maxRequestBodySize`, the server-wide backstop.
   */
  maxBody?: number;
};

/** A handler's `maxBody` when it names none: Bun's own default. */
const defaultMaxBody = 1_048_576;

/**
 * The 413 closes the connection (as Node does, RFC 9110 15.5.14): the client may still be sending
 * the rest of a body nobody reads, and Bun's graceful `stop` would wait on it.
 */
const tooLarge = { status: 413, headers: { connection: "close" } };

/**
 * A request's body, counted against the cap of the handler that reads it (Hono's `bodyLimit`).
 * `ask` sets `cap` before it asks each handler. A Content-Length or a count past the cap errors
 * the read, and `over` tells `serve` to answer 413. It is its own stream's transformer.
 */
class CappedBody {
  cap = defaultMaxBody;
  seen = 0;
  over = false;
  /** The Content-Length; 0 when the body is chunked and has none. */
  length: number;
  /** The request each handler gets: the original's url, headers and signal, this body. */
  request: Request;

  constructor(request: Request, body: ReadableStream<Uint8Array>) {
    this.length = Number(request.headers.get("content-length"));
    this.request = new Request(request, {
      body: body.pipeThrough(new TransformStream(this)),
      duplex: "half",
    } as RequestInit);
  }

  /**
   * One handler's reply, its read held to its own cap. A throw from a read past the cap is not
   * the handler's own: the caller answers 413 for it.
   */
  async ask(handler: Handler, scope: Scope.Handle, bun: Server<never>) {
    this.cap = handler.maxBody ?? defaultMaxBody;
    try {
      return await handler.fetch(this.request, scope, bun);
    } catch (error) {
      if (!this.over) throw error;
    }
  }

  transform(chunk: Uint8Array, out: TransformStreamDefaultController<Uint8Array>) {
    this.seen += chunk.byteLength;
    if (this.seen <= this.cap && !(this.length > this.cap)) return out.enqueue(chunk);
    this.over = true;
    out.error(new RangeError("The body is over its handler's maxBody."));
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
      const answer = async (request: Request, bun: Server<never>) => {
        const body = request.body && new CappedBody(request, request.body);
        for (const handler of found) {
          const reply = await (body
            ? body.ask(handler, scope, bun)
            : handler.fetch(request, scope, bun));
          if (body?.over) return new Response(null, tooLarge);
          if (reply !== undefined) return reply ?? undefined;
        }
        return new Response(null, { status: 404 });
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
