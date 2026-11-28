import { createRootRouteWithContext, createRoute, notFound } from "@tanstack/react-router";
import type { Scope } from "@tinkered/core";

import { BenchPage } from "@/bench";
import { guide } from "@/guide";
import { GuideHome, GuidePage } from "@/guide/guide";
import { stackblitz } from "@/open";
import { PlayPage } from "@/play";
import { LivePage } from "@/sea";
import { roomName } from "@/sea/contract";
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

// The shared sea: two tabs on one room. The room is the link's `room`, or the lobby.
const live = createRoute({
  getParentRoute: () => root,
  path: "/live",
  validateSearch: (search: Record<string, unknown>) => ({
    room: roomName.catch("lobby").parse(search.room),
  }),
  component: () => <LivePage room={live.useSearch().room} />,
});

// StackBlitz: the loader sends the welcome mail example there, and this tab goes with it.
const openWelcome = createRoute({
  getParentRoute: () => root,
  path: "/open/welcome",
  loader: ({ context }) => context.scope.run(stackblitz.open),
  component: () => (
    <main className="home">
      <p className="lede">Opening the welcome mail on StackBlitz…</p>
    </main>
  ),
});

export const routeTree = root.addChildren([index, page, play, live, bench, openWelcome]);
