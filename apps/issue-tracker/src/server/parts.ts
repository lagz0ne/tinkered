import type { Hono } from "hono";
import { extension, type Observe, type Scope, type Tag } from "@tinker/core";
import { hono, type HonoScope } from "@tinker/hono";
import { api } from "../client/api.ts";
import { draftGuardrails, draftHelper } from "./draft.ts";
import { publishIssues } from "./operations.ts";
import { issueRoutes, onError, reportUnmapped } from "./routes.ts";

/** The server's parts. None of them builds a scope: a root lists the parts it
 * needs — `main.ts` lists them all, a test lists only its own. The other parts
 * live beside their code: `store` (`store.ts`), `src` (`sync.ts`),
 * `publishAfterCommit` (`publish.ts`). */

export type DraftConfig = { readonly enabled: boolean; readonly baseUrl: string };

export type WebOptions = {
  /** Where the 500 line for an error no route mapped goes (absent: dropped). */
  readonly observe?: Observe.Config;
  /** Bind a port (`main.ts`) or a fake (a test); absent, the app answers only
   * `app.request`. The scope's close stops it. */
  readonly serve?: HonoScope.Serve;
};

/** The issue routes as one Hono server. The unmapped-error handler installs in
 * `mount`, which runs before `serve`, so no request can reach the app without
 * it. Each call is a new extension: resolve the one you listed. */
export function web(options: WebOptions = {}): Scope.Extension<Hono> {
  return hono(issueRoutes, {
    onError,
    mount: (app) => {
      app.onError(reportUnmapped(options.observe));
    },
    serve: options.serve,
  }).extension;
}

/** Publish the saved list once, at boot. List it after `web`: the start onion
 * runs outside-in, so this inner part publishes before `web` binds its port.
 * A failed publish rejects `ready` and closes the root — no port ever opened. */
export const restore: Scope.Extension<void> = extension({
  label: "tracker.restore",
  start: async (scope, _ctx, next) => {
    await next();
    await scope.run(publishIssues);
  },
});

/** The tags that turn the draft helper on or off. Absent: no tags, and the
 * helper reads as off. */
export function draftTags(draft: DraftConfig | undefined): Tag.Bindings {
  if (draft === undefined) return [];
  return [
    draftHelper({ enabled: draft.enabled, baseUrl: draft.baseUrl }),
    draftGuardrails,
    draft.enabled && api.config({ baseUrl: draft.baseUrl }),
  ];
}
