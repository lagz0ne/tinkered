import { hydrateRoot } from "react-dom/client";
import { hydrate } from "@tanstack/react-router/ssr/client";
import { RouterProvider } from "@tanstack/react-router";
import { createScope, extension } from "@tinker/core";
import { ScopeProvider } from "@tinker/react";
import { subscribe } from "@tinker/sync";
import { createPageRouter } from "../shared/page.tsx";
import { issueList } from "../shared/issues.ts";
import { App } from "./App.tsx";
import { api } from "./api.ts";
import { openSource, wire } from "./connection.ts";
import { capability, detailRefresh } from "./services.ts";
import { drafter } from "./drafter.ts";

/** The root starts with Router's cells. Only after React takes over the same HTML
 * does the SSE subscriber change them. This also keeps a slow wire from hiding the list. */
export async function bootPage(env: { baseUrl: string }, stop: AbortSignal): Promise<void> {
  const hydrated = Promise.withResolvers<void>();
  const scope = createScope({
    signal: stop,
    tags: [
      api.config({ baseUrl: env.baseUrl }),
      openSource((url) => new EventSource(new URL(url, env.baseUrl))),
    ],
    extensions: [
      extension({
        label: "issues.hydrate",
        hooks: {
          async start(event) {
            const router = createPageRouter({
              issues: event.resolve(issueList),
              ready: hydrated.resolve,
              hydrate: (issues) => event.controller(issueList).set(issues),
              content: (
                <ScopeProvider scope={event.scope}>
                  <App />
                </ScopeProvider>
              ),
              assets: { script: "", styles: [], dev: false },
            });
            await hydrate(router);
            window.$_TSR!.h();
            const element = hydrateRoot(document, <RouterProvider router={router} />);
            event.defer(() => element.unmount());
            await hydrated.promise;
            await event.next();
            event.resolve(detailRefresh);
            event.resolve(drafter);
            event.resolve(capability);
          },
        },
      }),
      subscribe(wire, { cells: [[issueList, "issues"]] }),
    ],
  });
  try {
    await scope.ready;
  } catch (error) {
    await scope.closed;
    throw error;
  }
  await scope.closed;
}
