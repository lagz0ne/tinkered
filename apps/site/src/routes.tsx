import { createRootRouteWithContext, createRoute, notFound } from "@tanstack/react-router";
import type { Scope } from "@tinker/core";

import { guide, GuideHome, GuidePage } from "@/guide";
import { Shell } from "@/shell";

const root = createRootRouteWithContext<{ scope: Scope.Handle }>()({ component: Shell });

// The guide: each route loads its page by rpc, so a view only draws.
const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  loader: ({ context, abortController }) =>
    context.scope.run(guide.api["guide.list"], { input: null, signal: abortController.signal }),
  component: () => <GuideHome pages={index.useLoaderData()} />,
});

const page = createRoute({
  getParentRoute: () => root,
  path: "/guide/$slug",
  loader: async ({ context, params, abortController }) => {
    const found = await context.scope.run(guide.api["guide.page"], {
      input: { slug: params.slug },
      signal: abortController.signal,
    });
    if (found.kind === "gone") throw notFound();
    return found;
  },
  component: () => <GuidePage page={page.useLoaderData()} />,
});

export const routeTree = root.addChildren([index, page]);
