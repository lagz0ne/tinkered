import type { Hono } from "hono";
import { createScope, type Observe, type Scope } from "@tinker/core";
import { hono, type HonoScope } from "@tinker/hono";
import { type Sync } from "@tinker/sync";
import { api } from "../client/api.ts";
import { draftGuardrails, draftHelper } from "./draft.ts";
import { publishIssues } from "./operations.ts";
import { publishAfterCommit } from "./publish.ts";
import { issueRoutes, onError, reportUnmapped } from "./routes.ts";
import { src } from "./sync.ts";
import { store } from "./store.ts";

export type AppConfig = {
  readonly dataPath?: string;
  readonly draft?: { readonly enabled: boolean; readonly baseUrl: string };
  readonly presets?: readonly Scope.Preset[];
  /** Where log lines and spans go (`jsonLines` in `main.ts`; a test captures them;
   * absent = dropped). A tracing backend swaps in here and nowhere else. */
  readonly observe?: Observe.Config;
  /** Bind the app to the outside world inside the extension (`serve` in
   * `main.ts`); absent the app answers only `app.request`. The scope's close
   * stops the listener. */
  readonly serve?: HonoScope.Serve;
};

/** Create the owning scope, publish the restored list, and resolve the one Hono
 * app: the flat issue rows (including the `/sync` GET stream row) mounted by
 * the `hono` extension, plus `publishAfterCommit` on the new `session` hook.
 * An error no route mapped answers 500 and is logged through `observe`.
 * Boot is atomic: the `serve` bind opens inside `start`, so anything after it
 * that fails (a bad saved-list load, a refusing store) closes the scope —
 * which stops the listener — before rejecting. A failed boot leaves no open
 * port. The caller owns the returned scope and closes it. */
export async function createApp(config: AppConfig): Promise<{
  readonly scope: Scope.Handle;
  readonly app: Hono;
  readonly src: Scope.Extension<Sync.Source>;
}> {
  // The app-level `onError` (Hono's last handler) installs before the
  // custom bind opens, so no request on that path can fail without it —
  // `main.ts` does the same on its own path.
  const observe = config.observe;
  const serve = config.serve && ((app: Hono) => {
    app.onError(reportUnmapped(observe));
    return config.serve?.(app);
  });
  const { extension: web } = hono(issueRoutes, { onError, serve });
  const draft = config.draft;
  const scope = createScope({
    tags: [
      store.config(config.dataPath),
      draft && [
        draftHelper({ enabled: draft.enabled, baseUrl: draft.baseUrl }),
        draftGuardrails,
        draft.enabled && api.config({ baseUrl: draft.baseUrl }),
      ],
    ],
    extensions: [src, web, publishAfterCommit()],
    presets: config.presets,
    observe: config.observe,
  });
  try {
    await scope.ready;
    await scope.run(publishIssues);
  } catch (error: unknown) {
    await scope.close();
    throw error;
  }
  const app = scope.resolve(web);
  app.onError(reportUnmapped(config.observe));
  return { scope, app, src };
}
