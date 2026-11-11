import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ws } from "@tinker/bun/client";
import { createScope } from "@tinker/core";
import { ScopeProvider } from "@tinker/react";
import { createRoot } from "react-dom/client";

import { bench } from "@/bench";
import { guide } from "@/guide";
import { play } from "@/play";
import { routeTree } from "@/routes";
import { TinkerError, TinkerNotFound } from "~/base/fallbacks";
import { abortReasons } from "~/components/errors";
import { telemetry } from "~/components/telemetry";

/** The tab's one root. A real page hide, or a hot swap of this module, closes it. */
const stop = new AbortController();

const app = createScope({
  signal: stop.signal,
  capsules: [
    telemetry.browser({ service: "tinker-site-browser", console }),
    ws.client({ url: `${location.origin.replace(/^http/, "ws")}/rpc` }),
    guide.api({ remote: ws.client }),
    bench({ timer: performance }),
    play({ storage: localStorage, debounce: 250, wasm: "/esbuild.wasm" }),
  ],
});

const close = async () => {
  stop.abort(abortReasons.closed);
  await app.closed;
};

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) void close();
});

import.meta.hot?.dispose(close);
const live = await app.ready;

const router = createRouter({
  routeTree,
  context: { scope: live },
  scrollRestoration: true,
  defaultErrorComponent: TinkerError,
  defaultNotFoundComponent: TinkerNotFound,
  Wrap: ({ children }) => <ScopeProvider scope={live}>{children}</ScopeProvider>,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("app")!).render(<RouterProvider router={router} />);
