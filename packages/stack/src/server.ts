import { isIP } from "node:net";
import { serve } from "@hono/node-server";
import { extension, LEVELS, type Observe, type Scope } from "@tinker/core";
import type { HonoScope } from "@tinker/hono";
import { raise } from "./errors.ts";
import { mountClient } from "./client.ts";

export declare namespace Server {
  export type Env = { PORT?: string; HOST?: string };
  export type Options = {
    env: Env;
    clientDir: string;
    observe?: Observe.Config;
  };
}

/** List first, before the Hono extension passed in: validate before other starts,
 * listen after they finish. The scope owns the listener; requests drain before
 * its deferred close. Env and app are borrowed; no scope is made here. */
export function server(
  web: Scope.Extension<Parameters<HonoScope.Serve>[0]>,
  options: Server.Options,
): Scope.Extension<void> {
  return extension({
    label: "stack.server",
    start: async (scope, ctx, next) => {
      const settings = readSettings(options.env);
      await next();
      const app = scope.resolve(web);
      mountClient(app, options.clientDir);
      let close: (() => Promise<void>) | undefined;
      let stopped = false;
      ctx.defer(() => {
        stopped = true;
        return close?.();
      });
      close = await listen(app, settings);
      if (stopped) await close();
      else
        options.observe?.log?.({
          time: options.observe.clock?.() ?? ctx.clock.currentTimeMillis(),
          level: LEVELS.info,
          message: "listening",
          attributes: settings,
          span: undefined,
        });
    },
  });
}

function readSettings(env: Server.Env): { host: string; port: number } {
  const keys: string[] = [];
  const port = /^\d+$/.test(env.PORT ?? "") ? Number(env.PORT) : Number.NaN;
  if (!(port >= 1 && port <= 65535)) keys.push("PORT");
  const host = env.HOST ?? "";
  if (!isHost(host)) keys.push("HOST");
  if (keys.length > 0) raise("BadListenSettings", { keys });
  return { host, port };
}

function isHost(host: string): boolean {
  if (isIP(host) !== 0) return true;
  return (
    host.length <= 253 &&
    host.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
  );
}

function listen(
  app: Parameters<HonoScope.Serve>[0],
  settings: { host: string; port: number },
): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const listener = serve({ fetch: app.fetch, hostname: settings.host, port: settings.port }, () =>
      resolve(
        () =>
          new Promise<void>((done, fail) => {
            listener.close((error) => (error ? fail(error) : done()));
          }),
      ),
    );
    listener.once("error", reject);
  });
}
