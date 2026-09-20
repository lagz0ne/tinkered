import { Hono, type Context, type Next } from "hono";
import { createScope, type Scope } from "@tinker/core";
import { honoApp, stream } from "@tinker/hono";
import { source, sync, type Sync } from "@tinker/sync";
import { issueList } from "../shared/issues.ts";
import { api } from "../client/api.ts";
import { draftGuardrails, draftHelper } from "./draft.ts";
import { publishIssues } from "./operations.ts";
import { issueRoutes, onError } from "./routes.ts";
import { store } from "./store.ts";
import { sseTransport, viewers } from "./sync.ts";

export type AppConfig = {
  readonly dataPath?: string;
  readonly draft?: { readonly enabled: boolean; readonly baseUrl: string };
  readonly presets?: readonly Scope.Preset[];
};

/** Create the owning scope, publish the restored list, and build the one Hono app:
 * the bound issue, draft, and register routes plus the hand-mounted `/sync` GET
 * (it needs `stream`, so it rides `honoApp`'s mount slot inside the same session
 * middleware), and the outer publish-after-commit wrapper. The caller owns the
 * scope and closes it. */
export async function createApp(config: AppConfig): Promise<{
  readonly scope: Scope.Handle;
  readonly app: Hono;
  readonly src: Scope.Extension<Sync.Source>;
}> {
  const src = source();
  const scope = createScope({
    tags: [
      store.config(config.dataPath),
      sync(issueList),
      ...(config.draft === undefined
        ? []
        : [
            draftHelper({ enabled: config.draft.enabled, baseUrl: config.draft.baseUrl }),
            draftGuardrails,
            ...(config.draft.enabled ? [api.config({ baseUrl: config.draft.baseUrl })] : []),
          ]),
      ...issueRoutes,
    ],
    extensions: [src],
    presets: config.presets,
  });
  await scope.ready;
  await scope.run(publishIssues);
  /** Publish after commit: this outer layer runs after `tinker`'s graceful close,
   * i.e. after the request session committed, so it republishes committed rows.
   * A rejected save answers 4xx/5xx and publishes nothing. Core has no
   * session-commit hook yet (core-feedback 2026-09-20); this root-owned closure
   * is the one place allowed to hold the scope. */
  const publishAfterCommit = async (c: Context, next: Next): Promise<void> => {
    await next();
    if (c.req.method !== "GET" && c.res.status < 300) await scope.run(publishIssues);
  };
  const origin = scope.resolve(src);
  const wires = scope.resolve(viewers);
  const app = await honoApp(scope, {
    onError,
    mount: (inner) => {
      inner.get("/sync", (c) => {
        const id = c.req.query("client") ?? "guest";
        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");
        return stream(c, (emit, ctx) => {
          emit(": ready\n\n");
          const wire = sseTransport(emit, ctx.signal);
          const close = wires.open(id, wire.deliver);
          return origin.connect(wire).then(close, close);
        });
      });
    },
  });
  const outer = new Hono()
    .use("/api/issues", publishAfterCommit)
    .use("/api/issues/:id", publishAfterCommit)
    .use("/api/issues/:id/comments", publishAfterCommit)
    .route("/", app);
  return { scope, app: outer, src };
}
