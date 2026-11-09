import type { Scope } from "@tinker/core";

/** The default client and server, as an app's cmds import them. */
export { ws as wsClient } from "@/index";
export { ws as wsServer } from "@/server";

type Door = {
  upgrade: (r: Request, s: Scope.Handle, b: never) => Response | null | undefined;
  websocket: never;
};

/**
 * Serves a scope's socket servers on one real Bun port, as an app's server cmd does. Each path is
 * one transport; the first server's handler takes every socket (one handler per Bun server), so
 * a test with two transports gives them the same handler shape. `other` answers the rest.
 */
export function listen(
  scope: Scope.Handle,
  transports: readonly unknown[],
  other?: (r: Request) => Promise<Response | undefined> | Response | undefined,
) {
  const doors = transports.map((t) => scope.resolve(t as never) as Door);
  const bun = Bun.serve({
    port: 0,
    idleTimeout: 0,
    websocket: doors[0]!.websocket,
    fetch: async (r, b) => {
      for (const door of doors) {
        const reply = door.upgrade(r, scope, b as never);
        if (reply === null) return undefined;
        if (reply) return reply;
      }
      return (await other?.(r)) ?? new Response(null, { status: 404 });
    },
  });

  return { bun, url: `ws://localhost:${bun.port}` };
}
