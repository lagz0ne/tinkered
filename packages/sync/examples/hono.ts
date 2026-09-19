import { Hono } from "hono";
import { createScope, data, type Scope } from "@tinker/core";
import { stream, tinker } from "@tinker/hono";
import { sync, syncServer, synced, type Sync } from "../src/index.ts";

/** The shared counter both ends publish. */
const counter = data({ label: "counter", initial: 0, meta: [synced({ key: "counter" })] });

/** One line per message down the event stream. */
function frame(message: Sync.Message): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

/** The posted fields once each reads true. */
function readFields(raw: Record<string, unknown>): Sync.Message | undefined {
  const id = raw["id"];
  const key = raw["key"];
  const base = raw["base"];
  if (typeof id !== "number") return undefined;
  if (typeof key !== "string") return undefined;
  if (typeof base !== "number") return undefined;
  return { type: "set", id, key, base, value: raw["value"] };
}

/** One client write from a POST body. Anything else is refused at the door. */
function readPosted(raw: unknown): Sync.Message | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!("type" in raw) || raw.type !== "set") return undefined;
  return readFields(raw);
}

/** One live wire per browser tab, keyed by the `client` query value. */
function wires(): Map<string, (message: Sync.Message) => void> {
  return new Map<string, (message: Sync.Message) => void>();
}

/** The recipe: one Hono app sharing one scope, the stream down, posts up. */
export function recipe(scope: Scope.Handle): Hono {
  const server = syncServer(scope);
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
          if (open) void emit(frame(message));
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
      return server.connect(transport).then(() => {
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

/** The server half in one call: a scope holding the counter plus the app. */
export function boot(): { scope: Scope.Handle; app: Hono } {
  const scope = createScope({ tags: [sync(counter)] });
  return { scope, app: recipe(scope) };
}
