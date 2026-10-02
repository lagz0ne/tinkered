import { createElement, type ComponentType, type ReactNode } from "react";
import { ScopeProvider } from "@tinker/react";
import { extension, operation, type Operation, type Scope } from "@tinker/core";
import { emit, request, stream, type HonoScope } from "../hono/index.ts";

export declare namespace Pages {
  type Options<T> = {
    component: ComponentType;
    read: Operation.Handle<T, void>;
    render(request: Request, values: Awaited<T>, content: ReactNode): Promise<Response>;
  };
}

/** The renderer transfers its body to the request. A cancelled request cancels the
 * renderer's reader too, including a pending read; Hono owns commit and rollback. */
const pageBody = operation({
  label: "stack.pageBody",
  depends: { emit: emit.required },
  async run({ emit }, { input, signal }: Operation.Ctx<ReadableStream<Uint8Array>>) {
    const reader = input.getReader();
    let cancelled: Promise<void> | undefined;
    const cancel = () => {
      cancelled = reader.cancel();
    };
    signal.addEventListener("abort", cancel);
    try {
      if (signal.aborted) cancel();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        emit(chunk.value);
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      await cancelled;
      reader.releaseLock();
    }
  },
});

/** List the extension beside Hono and use mount in its wiring. Each request borrows
 * its session for React's provider; no scope crosses into the app's renderer.
 * Mount after API routes. Built assets fall through to the server's file routes. */
export function pages<T>(options: Pages.Options<T>): {
  extension: Scope.Extension;
  mount: NonNullable<HonoScope.Wiring["mount"]>;
} {
  const renders = new WeakMap<Request, () => Promise<Response>>();
  return {
    extension: extension({
      label: "stack.pages",
      hooks: {
        async session(event) {
          const incoming = event.resolve(request.optional);
          if (!incoming.present || renders.has(incoming.value)) return event.next();
          const raw = incoming.value;
          renders.set(raw, () =>
            event.handle.run({
              label: "stack.page",
              depends: { read: options.read },
              async run({ read }) {
                const values = await read.run();
                const content = createElement(ScopeProvider, {
                  scope: event.handle,
                  children: createElement(options.component),
                });
                return options.render(raw, values, content);
              },
            }),
          );
          try {
            return await event.next();
          } finally {
            renders.delete(raw);
          }
        },
      },
    }),
    mount(app) {
      app.get("*", async (c, next) => {
        if (c.req.path.startsWith("/assets/")) return next();
        const render = renders.get(c.req.raw);
        if (!render) return next();
        const response = await render();
        if (response.body === null) return response;
        const body = stream(c, pageBody, { input: response.body });
        return new Response(body.body, response);
      });
    },
  };
}
