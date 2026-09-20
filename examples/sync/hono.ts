import { Hono } from "hono";
import { createScope, data, type Scope } from "@tinker/core";
import { stream, tinker } from "@tinker/hono";
import { source, sync, synced, type Sync } from "@tinker/sync";

/** The shared counter both ends publish. */
const counter = data({ label: "counter", initial: 0, meta: [synced({ key: "counter" })] });

/** One line per message down the event stream. */
function frame(message: Sync.Message): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

/** A posted register: the keys the viewer shows. Anything else is refused. */
function readPosted(raw: unknown): Sync.Message | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!("type" in raw) || raw.type !== "register") return undefined;
  if (!("keys" in raw) || Array.isArray(raw.keys) === false) return undefined;
  const keys = raw.keys.filter((key): key is string => typeof key === "string");
  if (keys.length !== raw.keys.length) return undefined;
  return { type: "register", keys };
}

/** One live wire per browser tab, keyed by the `client` query value. */
function wires(): Map<string, (message: Sync.Message) => void> {
  return new Map<string, (message: Sync.Message) => void>();
}

/** The recipe: one Hono app sharing one scope, the stream down, the
 * registration up. One way: nothing is pushed unasked. The origin scope
 * installs the source extension at boot; each stream reads it back with
 * `scope.resolve(src).connect(transport)`. */
export function recipe(scope: Scope.Handle, src: Scope.Extension<Sync.Source>): Hono {
  const origin = { connect: (transport: Sync.Transport) => scope.resolve(src).connect(transport) };
  const posts = wires();
  const app = new Hono();
  app.use(tinker(scope));
  app.get("/sync", (c) => {
    const id = c.req.query("client") ?? "guest";
    return stream(c, (emit, ctx) => {
      let open = true;
      const arrivals = new Set<(message: Sync.Message) => void>();
      const partings = new Set<() => void>();
      const transport: Sync.Transport = {
        send: (message) => {
          if (open) emit(frame(message));
        },
        onMessage: (listener) => {
          arrivals.add(listener);
          return () => {
            arrivals.delete(listener);
          };
        },
        onClose: (listener) => {
          partings.add(listener);
          return () => {
            partings.delete(listener);
          };
        },
        close: () => {
          if (open === false) return;
          open = false;
          posts.delete(id);
          for (const part of partings) part();
        },
      };
      posts.set(id, (message) => {
        for (const arrival of arrivals) arrival(message);
      });
      ctx.signal.addEventListener("abort", () => transport.close(), { once: true });
      return origin.connect(transport).then(() => {
        posts.delete(id);
      });
    });
  });
  app.post("/sync", async (c) => {
    const id = c.req.query("client") ?? "guest";
    const send = posts.get(id);
    if (send === undefined) return c.text("gone", 410);
    const message = readPosted(await c.req.json());
    if (message === undefined) return c.text("bad", 400);
    send(message);
    return c.text("ok");
  });
  return app;
}

/** The source half in one call: a scope holding the counter plus the app.
 * `boot` installs the source extension and hands both back. */
export function boot(): { scope: Scope.Handle; app: Hono } {
  const src = source();
  const scope = createScope({ tags: [sync(counter)], extensions: [src] });
  return { scope, app: recipe(scope, src) };
}
