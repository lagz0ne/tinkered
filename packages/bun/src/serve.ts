import { capsule, data, tag } from "@tinker/core";
import type { Capsule, Scope } from "@tinker/core";
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
  /** The largest request body this handler takes. */
  maxBody?: number;
};

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
      const answer = async (request: Request, bun: Server<never>) => {
        for (const handler of found) {
          const reply = await handler.fetch(request, scope, bun);
          if (reply !== undefined) return reply ?? undefined;
        }
        return new Response(null, { status: 404 });
      };

      const server = Bun.serve({
        port: config.port,
        // Bun's 10 s default cuts a slow request; 60 s (max 255) matches the socket idle time.
        idleTimeout: 60,
        maxRequestBodySize: Math.max(1_048_576, ...found.map((handler) => handler.maxBody ?? 0)),
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
