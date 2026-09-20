import type { Hono } from "hono";
import { createScope, type Scope } from "@tinker/core";
import { hono } from "@tinker/hono";
import { type Sync } from "@tinker/sync";
import { api } from "../client/api.ts";
import { draftGuardrails, draftHelper } from "./draft.ts";
import { publishIssues } from "./operations.ts";
import { publishAfterCommit } from "./publish.ts";
import { issueRoutes, onError } from "./routes.ts";
import { src } from "./sync.ts";
import { store } from "./store.ts";

export type AppConfig = {
  readonly dataPath?: string;
  readonly draft?: { readonly enabled: boolean; readonly baseUrl: string };
  readonly presets?: readonly Scope.Preset[];
};

/** Create the owning scope, publish the restored list, and resolve the one Hono
 * app: the flat issue rows (including the `/sync` GET stream row) mounted by
 * the `hono` extension, plus `publishAfterCommit` on the new `session` hook.
 * The caller owns the scope and closes it. */
export async function createApp(config: AppConfig): Promise<{
  readonly scope: Scope.Handle;
  readonly app: Hono;
  readonly src: Scope.Extension<Sync.Source>;
}> {
  const web = hono({ routes: issueRoutes, onError });
  const scope = createScope({
    tags: [
      store.config(config.dataPath),
      ...(config.draft === undefined
        ? []
        : [
            draftHelper({ enabled: config.draft.enabled, baseUrl: config.draft.baseUrl }),
            draftGuardrails,
            ...(config.draft.enabled ? [api.config({ baseUrl: config.draft.baseUrl })] : []),
          ]),
    ],
    extensions: [src, web, publishAfterCommit()],
    presets: config.presets,
  });
  await scope.ready;
  await scope.run(publishIssues);
  const app = scope.resolve(web);
  return { scope, app, src };
}
