import { createScope } from "@tinkered/core";

import { ws } from "@/client";
import { ws as wsServer } from "@/index";

import { backendKit } from "../../core/tests/kit/backend";

// The backend kit (ADR 0140) on the WebSocket transport, over a real Bun server.

backendKit("ws", () => ({
  serve: async (capsules, services) => {
    const transport = wsServer.server({ path: "/rpc", services: services as never });
    const scope = await createScope({ capsules: [...capsules, transport] }).ready;

    const { upgrade, websocket } = scope.resolve(transport) as never as {
      upgrade: (r: Request, s: unknown, b: unknown) => Response | null | undefined;
      websocket: never;
    };
    const bun = Bun.serve({
      port: 0,
      idleTimeout: 0,
      websocket,
      fetch: (r, b) => {
        const reply = upgrade(r, scope, b);
        return reply === null ? undefined : (reply ?? new Response(null, { status: 404 }));
      },
    });

    const close = scope.close.bind(scope);
    // The socket server stops with its scope, so a close under a watch drops the link.
    Object.assign(scope, {
      close: async () => {
        bun.stop(true);
        await close();
      },
    });
    return { scope, at: `ws://localhost:${bun.port}/rpc` };
  },
  link: (url) => ({ capsule: ws.client({ url }), remote: ws.client as never }),
}));
