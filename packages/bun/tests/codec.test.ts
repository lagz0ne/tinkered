import { createScope, rpc } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { wsClient } from "./support";

// A value or a text the codec cannot handle is its own fault: encode or decode, with the side.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const api = rpc({
  big: { input: z.null(), output: z.object({ n: z.bigint() }) }, // JSON cannot carry a BigInt
  echo: { input: z.object({ n: z.unknown() }), output: z.unknown() },
});

const faultOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (api.fault.is(e) ? { fault: e.fault, payload: e.payload } : e),
  );

test("decode on the client: a reply it cannot read is decode, side client (not link)", async () => {
  // A server that answers each call with a page, not a reply text.
  const proxy = Bun.serve({
    port: 0,
    fetch: (r, b) => (b.upgrade(r) ? undefined : new Response(null, { status: 400 })),
    websocket: {
      message: (ws, frame) =>
        void ws.send(
          JSON.stringify(
            (JSON.parse(String(frame)) as { i: number }[]).map(({ i }) => ({
              i,
              t: "<html>502 Bad Gateway</html>",
            })),
          ),
        ),
    },
  });
  closers.push(() => proxy.stop(true));
  const lines: string[] = [];
  const client = await createScope({
    observe: { log: (l) => void lines.push(`${l.message} ${JSON.stringify(l.attributes)}`) },
    capsules: [
      wsClient.client({ url: `ws://localhost:${proxy.port}/api` }),
      api({ remote: wsClient.client }),
    ],
  }).ready;
  closers.push(() => client.close());

  expect(await faultOf(client.run(api.echo, { input: { n: 1 } }))).toEqual({
    fault: "decode",
    payload: { side: "client" },
  });
  expect(
    lines.some((l) => l.startsWith("protocol decode failed") && l.includes('"side":"client"')),
  ).toBe(true);
});
