import type { Server } from "node:http";
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
 * listen after they finish. Close stops accepting requests before draining the scope;
 * the defer joins the listener's close after those requests finish.
 * Env and app are borrowed; no scope is made here. */
export function server(
  web: Scope.Extension<Parameters<HonoScope.Serve>[0]>,
  options: Server.Options,
): Scope.Extension<void> {
  let owner: Scope.Handle | undefined;
  return extension({
    label: "stack.server",
    start: async (scope, ctx, next) => {
      if (owner) raise("PieceInUse", { label: ctx.label });
      owner = scope;
      let close: (() => Promise<void>) | undefined;
      let stopping: Promise<void> | undefined;
      let stopped = false;
      let closingScope = false;
      const stop = (): Promise<void> | undefined => {
        stopped = true;
        if (close) stopping ??= close();
        return stopping;
      };
      const release = () => {
        if (owner === scope) owner = undefined;
      };
      const closeScope = scope.close.bind(scope);
      /** The close hook has no scope. Bind here so a rejected or old root
       * cannot close the live owner's listener (as in the NATS piece). */
      scope.close = async (options) => {
        closingScope = true;
        try {
          /** The defer joins this promise after requests drain and reports listener errors. */
          stop()?.then(
            () => undefined,
            () => undefined,
          );
          return await closeScope(options);
        } finally {
          release();
        }
      };
      ctx.defer(async () => {
        try {
          await stop();
        } finally {
          /** Failed boot closes through core without calling the scope handle. */
          if (!closingScope) release();
        }
      });
      const settings = readSettings(options.env);
      await next();
      const app = scope.resolve(web);
      mountClient(app, options.clientDir);
      close = await listen(app, settings);
      if (stopped) await stop();
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
    let closing = false;
    /** No custom createServer: the adapter always opens HTTP/1, though its type includes HTTP/2. */
    const listener = serve({ fetch: app.fetch, hostname: settings.host, port: settings.port }, () =>
      resolve(
        () =>
          new Promise<void>((done, fail) => {
            closing = true;
            listener.close((error) => (error ? fail(error) : done()));
          }),
      ),
    ) as Server;
    /** Streams can finish after close began; reap their now-idle keep-alive sockets too. */
    listener.on("request", (_request, response) => {
      response.once("finish", () => {
        if (closing) listener.closeIdleConnections();
      });
    });
    listener.once("error", reject);
  });
}
