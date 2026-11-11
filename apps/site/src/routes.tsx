import { createRootRouteWithContext, createRoute, notFound } from "@tanstack/react-router";
import type { Scope } from "@tinker/core";

import { BenchPage } from "@/bench";
import { guide, GuideHome, GuidePage } from "@/guide";
import { PlayPage } from "@/play";
import { SessionsPage } from "@/sessions";
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

// The benchmark: the page runs it in this browser; its chunk loads on first visit.
const bench = createRoute({ getParentRoute: () => root, path: "/bench", component: BenchPage });

// The playground: it compiles and runs the project in this browser; its chunk loads on first visit.
const play = createRoute({ getParentRoute: () => root, path: "/play", component: PlayPage });

// The sessions study: who owns each value, shown by what each reset clears.
const sessions = createRoute({
  getParentRoute: () => root,
  path: "/sessions",
  component: SessionsPage,
});

export const routeTree = root.addChildren([index, page, play, sessions, bench]);
