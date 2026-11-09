import { capsule, data, tag } from "@tinker/core";
import type { Capsule, Scope } from "@tinker/core";
import type { HTMLBundle, Server, WebSocketHandler } from "bun";

// POC: the listener is a capsule. It owns `Bun.serve` for the scope's life: it listens after
// every other capsule started, and stops when the scope closes. Signals and exit codes stay with
// the host (Go: http.Server vs main; Effect: BunHttpServer.layer vs BunRuntime.runMain).
// It is the outermost layer, so it goes FIRST in `capsules`: its start wraps the others.

/** What a door's start returns: ws.server's shape, or a route table function. */
type WsDoor = {
  upgrade: (req: Request, scope: Scope.Handle, bun: Server<never>) => Response | null | undefined;
  post: (req: Request, scope: Scope.Handle) => Promise<Response | undefined>;
  websocket: WebSocketHandler<never>;
  maxBody: number;
};
type TableDoor = (req: Request, scope: Scope.Handle) => Promise<Response | undefined>;

const port = tag<number>({ label: "listen.port" });
const pages = tag<Readonly<Record<string, HTMLBundle | Response>>>({
  label: "listen.pages",
  default: {},
});
const doors = tag<readonly Capsule.Binding[]>({ label: "listen.doors" });
const paths = tag<readonly string[]>({ label: "listen.paths", default: [] });
/** The live server: its URL is the one thing the app may read. */
const url = data<URL | null>({ label: "listen.url", initial: null });
/** The server and the session its doors answer in: internal, the close hook stops both. */
const live = data<{ server: Server<never>; app: Scope.Handle } | null>({
  label: "listen.live",
  initial: null,
});

const held = { role: "state", explain: "The listening server" } as const;
const opened = { role: "handler", explain: "Doors answer in this session" } as const;

export const listen = capsule({
  label: "listen",
  config: { port: port.required, pages, doors: doors.required, paths },
  exports: { url },
  hooks: {
    async start({ config, next, session, load }) {
      await next(); // every door starts first
      const app = session({}, opened);
      const found = config.doors.map((door) => app.resolve(door) as WsDoor | TableDoor);
      const socket = found.find((d): d is WsDoor => typeof d === "object" && "upgrade" in d);
      const tables = found.filter((d): d is TableDoor => typeof d === "function");

      const answer = async (req: Request, bun: Server<never>) => {
        if (socket) {
          const up = socket.upgrade(req, app, bun);
          if (up !== undefined) return up ?? undefined;
          const posted = await socket.post(req, app);
          if (posted) return posted;
        }
        for (const table of tables) {
          const reply = await table(req, app);
          if (reply) return reply;
        }
        return new Response(null, { status: 404 });
      };
      const own = ["/api/*", "/rpc", "/rpc/*", ...config.paths];
      const server = Bun.serve({
        port: config.port,
        idleTimeout: 60,
        maxRequestBodySize: Math.max(socket?.maxBody ?? 0, 1_048_576),
        websocket: socket?.websocket as never,
        fetch: () => new Response(null, { status: 404 }),
        routes: { ...Object.fromEntries(own.map((p) => [p, answer])), ...config.pages },
      });
      load(live, held).set({ server, app });
      load(url, held).set(server.url);
    },
    async close({ load, next }) {
      const own = load(live, held).get();
      load(url, held).set(null);
      // Stop listening first, then close the doors' session, then the rest of the scope.
      await own?.server.stop(true);
      await own?.app.close();
      return next();
    },
  },
});
