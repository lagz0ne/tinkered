import { capsule, createScope, operation, rpc } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { z } from "zod";

import { ws as wsClient } from "@/client";
import { ws } from "@/index";
import { listen } from "@/listen";

const api = rpc({ greet: { input: z.object({ name: z.string() }), output: z.string() } });
const greetHere = operation({
  label: "greet.here",
  input: api.greet.input,
  run: async (_, { input }) => `Hello, ${input.name}.`,
});
const health = operation({ label: "health", run: () => "ok" });

/** A route-table door as tinker-app's `routes` returns it: a plain function of request + scope. */
const tableDoor = (table: Record<string, typeof health>) => {
  return capsule({
    label: "routes",
    hooks: {
      start: async ({ next }: any) => {
        await next();
        return async (req: Request, scope: any) => {
          const op = table[`${req.method} ${new URL(req.url).pathname}`];
          return op ? Response.json(await scope.run(op)) : undefined;
        };
      },
    },
  });
};

test("the listener is a capsule: a cmd is one createScope; close stops the port", async () => {
  // what a cmd would write: env read here, values into config, no fetch glue
  const env = { PORT: "0" };
  const socket = ws.server({ path: "/rpc", services: [api] });
  const table = tableDoor({ "GET /api/health": health });
  const app = await createScope({
    capsules: [
      listen({ port: Number(env.PORT), doors: [socket, table] }),
      api({ implement: { greet: greetHere } }),
      socket,
      table,
    ],
  }).ready;

  const at = app.resolve(listen.url).get()!;
  console.log("listening on", String(at));
  const health1 = await fetch(new URL("/api/health", at)).then((r) => r.json());
  const tab = await createScope({
    capsules: [wsClient.client({ url: `ws://${at.host}/rpc` }), api({ remote: wsClient.client })],
  }).ready;
  const hello = await tab.run(api.greet, { input: { name: "Ada" } });
  await tab.close();
  console.log("route:", health1, "| rpc:", hello);

  await app.close();
  const after = await fetch(new URL("/api/health", at)).then(
    () => "answered",
    () => "refused",
  );
  console.log("after close:", after);
  expect([health1, hello, after]).toEqual(["ok", "Hello, Ada.", "refused"]);
});
