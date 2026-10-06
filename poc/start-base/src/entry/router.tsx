import { createRouter } from "@tanstack/react-router";
import { createScope } from "@tinker/core";
import { ScopeProvider } from "@tinker/react";
import { extensions } from "#tinker/app";
import { routeTree } from "#tinker/routes";

/** Start calls this once per server render and once per browser tab. */
export async function getRouter() {
  const stop = new AbortController();
  const app = createScope({ signal: stop.signal, extensions });
  await app.ready;
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= Promise.resolve().then(async () => {
      stop.abort();
      const end = await app.closed;
      if (end.status === "failed") throw end.error;
      if (end.teardownErrors?.length) throw end.teardownErrors.at(0);
    }));
  if (import.meta.hot) import.meta.hot.dispose(close);
  return Object.assign(
    createRouter({
      routeTree,
      scrollRestoration: true,
      Wrap: ({ children }) => <ScopeProvider scope={app}>{children}</ScopeProvider>,
    }),
    { close },
  );
}

/** TanStack merges this registry to bind route types to the app's router. */
declare module "@tanstack/react-router" {
  interface Register {
    router: Awaited<ReturnType<typeof getRouter>>;
  }
}
