import { data, operation, resource } from "@tinker/core";
import { emit, hono, route, stream } from "@tinker/hono";
import { source, type Sync } from "@tinker/sync";
import { createSseServer } from "@tinker/sync/sse";
import { z } from "zod";

/** Sync needs nothing on the cell: its wire key comes from the row, never unit meta (ADR 0051). */
const counter = data({ label: "counter", initial: 0 });

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

/** The source extension, one identity per process: the root installs this same
 * object and the `/sync` row's op declares it in `depends`. */
export const src = source({ cells: [[counter, "counter"]] });

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
    const transport = createSseServer(emit, signal);
    posts.set(id, (message) => transport.deliver(message));
    transport.onClose(() => {
      posts.delete(id);
    });
    defer(() => transport.close());
    return origin.connect(transport);
  },
});

/** The recipe: flat rows plus the source extension. One way: nothing is pushed
 * unasked. The stream goes down, the registration comes up.
 * The root lists extensions as `[web, src]`, so the server starts last. */
export const { extension: web } = hono([
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
