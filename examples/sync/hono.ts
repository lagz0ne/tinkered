import { createScope, operation, resource, type Scope } from "@tinker/core";
import { emit, hono, route, stream } from "@tinker/hono";
import type { Sync } from "@tinker/sync";
import { createSseServer } from "@tinker/sync/sse";
import { z } from "zod";
import { raise } from "./errors.ts";
import { src } from "./counter.ts";

export { src } from "./counter.ts";

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
    if (send === undefined) raise("GoneTab", { id: ctx.input.id });
    send(ctx.input.message);
  },
});

/** Closing runs once, however it is reached; then a post for this tab fails with `GoneTab`. */
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

/** Read one locally emitted SSE frame without opening a port or making a network request. */
export async function honoTour(): Promise<string> {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal, extensions: [web, src] });
  let output: string;
  let end: Scope.Result;
  try {
    await root.ready;
    const app = root.resolve(web);
    const response = await app.request("/sync?client=demo");
    if (response.body === null) raise("NoStream", { status: response.status });
    const reader = response.body.getReader();
    try {
      const posted = await app.request("/sync?client=demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "register", keys: ["counter"] }),
      });
      if (!posted.ok) raise("RegistrationFailed", { status: posted.status });
      const first = await reader.read();
      if (first.done) raise("StreamEnded", { client: "demo" });
      output = new TextDecoder().decode(first.value).trim();
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  } finally {
    stop.abort();
    end = await root.closed;
  }
  if (end.status === "failed") throw end.error;
  if (end.teardownErrors?.length) {
    const [error] = end.teardownErrors;
    throw error;
  }
  return output;
}

if (import.meta.main) process.stdout.write(`${await honoTour()}\n`);
