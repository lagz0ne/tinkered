import type { Hono } from "hono";
import { createScope, data, operation, resource, type Scope } from "@tinker/core";
import { hono, route, stream } from "@tinker/hono";
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

/** One live wire per browser tab, keyed by the `client` query value: a scope
 * resource, so the composition root owns it and `defer` clears it on close. */
const posts = resource({
  label: "posts",
  factory: (_deps, { defer }) => {
    const wires = new Map<string, (message: Sync.Message) => void>();
    defer(() => {
      wires.clear();
    });
    return wires;
  },
});

/** The source extension, one identity per process: `boot` installs this same
 * object and the `/sync` row's op declares it in `depends`. */
const src = source();

/** Open one wire: the extension-as-dependency delivers `src`'s start value,
 * so the row needs no scope — `respond` reads the client id. */
const openWire = operation({
  label: "openWire",
  depends: { origin: src, posts },
  run: ({ origin, posts }) => ({ origin, posts }),
});

/** Parse one posted register at the door: the client id plus its message. */
function parseDelivery(raw: unknown): { readonly id: string; readonly message: Sync.Message } {
  if (typeof raw !== "object" || raw === null) throw new Error("bad delivery");
  if (!("id" in raw) || typeof raw.id !== "string") throw new Error("bad delivery");
  if (!("message" in raw)) throw new Error("bad delivery");
  const message = readPosted(raw.message);
  if (message === undefined) throw new Error("bad delivery");
  return { id: raw.id, message };
}

const deliverRegister = operation({
  label: "deliverRegister",
  input: parseDelivery,
  depends: { posts },
  run: ({ posts }, ctx) => {
    const send = posts.get(ctx.input.id);
    if (send === undefined) throw new Error("gone tab");
    send(ctx.input.message);
  },
});

/** The recipe: flat rows plus the source extension. One way: nothing is pushed
 * unasked. The stream goes down, the registration comes up. */
const web = hono({
  routes: [
    route.get("/sync", openWire, {
      respond: (opened, c) => {
        const id = c.req.query("client") ?? "guest";
        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");
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
              opened.posts.delete(id);
              for (const part of partings) part();
            },
          };
          opened.posts.set(id, (message) => {
            for (const arrival of arrivals) arrival(message);
          });
          ctx.signal.addEventListener("abort", () => transport.close(), { once: true });
          return opened.origin.connect(transport).then(() => {
            opened.posts.delete(id);
          });
        });
      },
    }),
    route.post("/sync", deliverRegister, {
      input: async (c) => ({ id: c.req.query("client") ?? "guest", message: await c.req.json() }),
      respond: (delivery, c) => {
        delivery;
        return c.text("ok");
      },
    }),
  ],
});

/** The source half in one call: a scope holding the counter plus the app.
 * `boot` installs the source extension, awaits `ready`, and hands both back. */
export async function boot(): Promise<{ scope: Scope.Handle; app: Hono }> {
  const scope = createScope({ tags: [sync(counter)], extensions: [src, web] });
  await scope.ready;
  return { scope, app: scope.resolve(web) };
}
