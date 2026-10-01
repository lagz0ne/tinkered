import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { raise } from "../errors.ts";
import { parseIssueList, type Issues } from "./issues.ts";

export declare namespace Page {
  type Assets = { script: string; styles: string[]; dev: boolean };
  type Context = { content: ReactNode; assets: Assets };
  type Snapshot = { issues: readonly Issues.Issue[]; assets: Assets };
  type Options = Context & {
    issues: readonly Issues.Issue[];
    hydrate?: (issues: readonly Issues.Issue[]) => void;
  };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

function readAssets(raw: unknown): Page.Assets {
  if (!isRecord(raw)) raise("BadPage", {});
  if (typeof raw.script !== "string" || !Array.isArray(raw.styles) || typeof raw.dev !== "boolean")
    raise("BadPage", {});
  const styles = raw.styles.filter((value): value is string => typeof value === "string");
  if (styles.length !== raw.styles.length) raise("BadPage", {});
  return { script: raw.script, styles, dev: raw.dev };
}

/** The router payload crosses a browser boundary; cells validate their values once here. */
function readSnapshot(raw: unknown): Page.Snapshot {
  if (!isRecord(raw)) raise("BadPage", {});
  return { issues: parseIssueList(raw.issues), assets: readAssets(raw.assets) };
}

const root = createRootRouteWithContext<Page.Context>()({
  component: Document,
  notFoundComponent: () => (
    <main>
      <h1>Page not found</h1>
    </main>
  ),
});
const list = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => root.useRouteContext().content,
});

/** Router loaders do not fetch. The request's published cell is the complete first paint. */
export function createPageRouter(options: Page.Options) {
  const router = createRouter({
    routeTree: root.addChildren([list]),
    context: { content: options.content, assets: options.assets },
    dehydrate: (): Page.Snapshot => ({ issues: options.issues, assets: options.assets }),
    hydrate(raw) {
      const snapshot = readSnapshot(raw);
      options.hydrate?.(snapshot.issues);
      router.update({ context: { content: options.content, assets: snapshot.assets } });
    },
  });
  return router;
}

function Document() {
  const { assets }: Page.Context = root.useRouteContext();
  return (
    <html lang="en" data-server-page="true">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Issues</title>
        {assets.styles.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>
        <div id="root">
          <Outlet />
        </div>
        <Scripts />
        {assets.dev ? (
          <script
            type="module"
            dangerouslySetInnerHTML={{
              __html:
                'import refresh from "/@react-refresh"; refresh.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;',
            }}
          />
        ) : null}
        {assets.dev ? <script type="module" src="/@vite/client" /> : null}
        <script id="client-entry" type="module" src={assets.script} />
      </body>
    </html>
  );
}
