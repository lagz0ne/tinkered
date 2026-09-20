import { Hono, type Context, type Next } from "hono";
import { createScope, type Scope } from "@tinker/core";
import { honoApp, stream } from "@tinker/hono";
import { source, sync, type Sync } from "@tinker/sync";
import { issueList } from "../shared/issues.ts";
import { api } from "../client/api.ts";
import { draftHelper, draftStream } from "./draft.ts";
import { publishIssues } from "./operations.ts";
import { issueRoutes, onError } from "./routes.ts";
import { store } from "./store.ts";

export type AppConfig = {
  readonly dataPath?: string;
  readonly draft?: { readonly enabled: boolean; readonly baseUrl: string };
  readonly presets?: readonly Scope.Preset[];
};

function frame(message: Sync.Message): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

function readPosted(raw: unknown): Sync.Message | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!("type" in raw) || raw.type !== "register") return undefined;
  if (!("keys" in raw) || Array.isArray(raw.keys) === false) return undefined;
  const keys = raw.keys.filter((key): key is string => typeof key === "string");
  if (keys.length !== raw.keys.length) return undefined;
  return { type: "register", keys };
}

function owned(
  transport: Sync.Transport,
  flush: () => Promise<void>,
  fail: () => void,
): Sync.Transport {
  let tail: Promise<void> = Promise.resolve();
  let dead = false;
  return {
    send: (message) => {
      if (dead) return;
      transport.send(message);
      tail = tail.then(flush, fail);
    },
    onMessage: (listener) => transport.onMessage(listener),
    onClose: (listener) =>
      transport.onClose(() => {
        dead = true;
        listener();
      }),
    close: () => {
      dead = true;
      transport.close();
    },
  };
}

/** Create the owning scope, publish the restored list, and build the one Hono app:
 * the bound issue routes, the hand-mounted sync and draft streams (they need
 * `stream`, so they ride `honoApp`'s mount slot inside the same session
 * middleware), and the outer publish-after-commit wrapper. The caller owns the
 * scope and closes it. */
export async function createApp(config: AppConfig): Promise<{
  readonly scope: Scope.Handle;
  readonly app: Hono;
  readonly src: Scope.Extension<Sync.Source>;
}> {
  const src = source();
  const helper = config.draft ?? { enabled: false, baseUrl: "" };
  const scope = createScope({
    tags: [
      store.config(config.dataPath),
      sync(issueList),
      draftHelper({ enabled: helper.enabled, baseUrl: helper.baseUrl }),
      ...(helper.enabled ? [api.config({ baseUrl: helper.baseUrl })] : []),
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
  const posts = new Map<string, (message: Sync.Message) => void>();
  const app = await honoApp(scope, {
    onError,
    mount: (inner) => {
      inner.post("/api/issues/:id/draft", (c) => draftStream(scope, helper, c, c.req.param("id")));
      inner.get("/sync", (c) => {
        const id = c.req.query("client") ?? "guest";
        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");
        return stream(c, (emit, ctx) => {
          let open = true;
          const arrivals = new Set<(message: Sync.Message) => void>();
          const partings = new Set<() => void>();
          const queue: Sync.Message[] = [];
          const transport: Sync.Transport = {
            send: (message) => {
              if (open === false) return;
              queue.push(message);
            },
            onMessage: (listener) => {
              arrivals.add(listener);
              return () => {
                arrivals.delete(listener);
              };
            },
            onClose: (listener) => {
              partings.add(listener);
              return () => {
                partings.delete(listener);
              };
            },
            close: () => {
              if (open === false) return;
              open = false;
              queue.length = 0;
              posts.delete(id);
              for (const part of Array.from(partings)) part();
            },
          };
          const fail = (): void => {
            transport.close();
          };
          posts.set(id, (message) => {
            for (const arrival of Array.from(arrivals)) arrival(message);
          });
          ctx.signal.addEventListener("abort", () => transport.close(), { once: true });
          const flush = async (): Promise<void> => {
            while (open && queue.length > 0) {
              const next = queue.shift();
              if (next === undefined) return;
              try {
                await emit(frame(next));
              } catch {
                fail();
                return;
              }
            }
          };
          const pump = async (): Promise<void> => {
            try {
              await emit(": ready\n\n");
            } catch {
              fail();
              return;
            }
            await scope.resolve(src).connect(owned(transport, flush, fail));
          };
          return pump().then(
            () => {
              posts.delete(id);
              transport.close();
            },
            () => {
              posts.delete(id);
              transport.close();
            },
          );
        });
      });
      inner.post("/sync", async (c) => {
        const id = c.req.query("client") ?? "guest";
        const send = posts.get(id);
        if (send === undefined) return c.text("gone", 410);
        let raw: unknown;
        try {
          raw = await c.req.json();
        } catch {
          return c.text("bad", 400);
        }
        const message = readPosted(raw);
        if (message === undefined) return c.text("bad", 400);
        send(message);
        return c.text("ok");
      });
    },
  });
  const outer = new Hono()
    .use("/api/issues/*", publishAfterCommit)
    .use("/api/issues", publishAfterCommit)
    .route("/", app);
  return { scope, app: outer, src };
}
