import type { Hono } from "hono";
import { createScope, data, operation, resource, type Scope } from "@tinker/core";
import { emit, hono, route, stream } from "@tinker/hono";
import { source, type Sync } from "@tinker/sync";
import { z } from "zod";

/** Sync needs nothing on the cell: its wire key comes from the row, never unit meta (ADR 0051). */
const counter = data({ label: "counter", initial: 0 });

/** One event-stream frame: a blank line ends it, so the JSON must stay on one line. */
function frame(message: Sync.Message): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

/** A posted register: the keys the viewer shows. Anything else is refused. */
const registerSchema = z.object({ type: z.literal("register"), keys: z.array(z.string()) });

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
const src = source({ cells: [[counter, "counter"]] });

/** Check the source and inbox are up before sending the stream headers. */
const openWire = operation({
  label: "openWire",
  depends: { origin: src, posts },
  run: () => undefined,
});

const deliverySchema = z.object({ id: z.string(), message: registerSchema });

const deliverRegister = operation({
  label: "deliverRegister",
  input: deliverySchema,
  depends: { posts },
  run: ({ posts }, ctx) => {
    const send = posts.get(ctx.input.id);
    if (send === undefined) throw new Error("gone tab");
    send(ctx.input.message);
  },
});

/** Closing runs once, however it is reached; then a post for this tab fails with `gone tab`. */
const wireBody = operation({
  label: "wireBody",
  input: z.string(),
  depends: { emit: emit.required, origin: src, posts },
  run: ({ emit, origin, posts }, { input: id, signal, defer }) => {
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
    const onAbort = (): void => transport.close();
    signal.addEventListener("abort", onAbort, { once: true });
    defer(() => {
      signal.removeEventListener("abort", onAbort);
      transport.close();
    });
    return origin.connect(transport);
  },
});

/** The recipe: flat rows plus the source extension. One way: nothing is pushed
 * unasked. The stream goes down, the registration comes up. */
const { extension: web } = hono([
  route.get("/sync", openWire, {
    respond: (_ready, c) => {
      const id = c.req.query("client") ?? "guest";
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      return stream(c, wireBody, { input: id });
    },
  }),
  route.post("/sync", deliverRegister, {
    input: async (c) => ({ id: c.req.query("client") ?? "guest", message: await c.req.json() }),
    respond: (_delivery, c) => c.text("ok"),
  }),
]);

/** The caller owns the returned scope and must close it; `app` can serve once this resolves. */
export async function boot(): Promise<{ scope: Scope.Handle; app: Hono }> {
  const scope = createScope({ extensions: [src, web] });
  await scope.ready;
  return { scope, app: scope.resolve(web) };
}
