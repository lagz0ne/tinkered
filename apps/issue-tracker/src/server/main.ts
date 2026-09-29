import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { createScope, type Scope } from "@tinker/core";
import type { HonoScope } from "@tinker/hono";
import { serve } from "@hono/node-server";
import { raise } from "../errors.ts";
import { describeError, jsonLines } from "./observe.ts";
import { draftTags, type DraftConfig } from "./draft.ts";
import { issueServer } from "./routes.ts";
import { publish } from "./publish.ts";
import { store } from "./store.ts";
import { src } from "./sync.ts";

/** The listen port: a missing `PORT` is 4311; anything but a whole number from 1 to 65535
 * raises `BadPort`, so boot fails before the store opens. */
function readPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT ?? "4311";
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (port >= 1 && port <= 65535) return port;
  return raise("BadPort", { value: raw });
}

function readDraftOptIn(
  env: NodeJS.ProcessEnv,
  host: string,
  port: number,
): DraftConfig | undefined {
  if (env.DRAFT_HELPER !== "1" && env.DRAFT_HELPER !== "true") return undefined;
  return {
    enabled: true,
    baseUrl: env.PUBLIC_BASE_URL || `http://${host}:${port}`,
  };
}

/** A read that found no file; any other read error is the server's and rethrows
 * into the app's `onError` (logged, 500). */
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function serveClient(app: Hono): Promise<void> {
  const dir = join(process.cwd(), "dist", "client");
  app.get("/", async (c) => {
    try {
      return c.html(await readFile(join(dir, "index.html"), "utf8"));
    } catch (error) {
      if (isMissing(error)) return c.text("build the client first: vp run build", 503);
      throw error;
    }
  });
  app.get("/assets/:name", async (c) => {
    const name = c.req.param("name");
    if (name.includes("/") || name.includes("..")) return c.text("bad", 400);
    try {
      const body = await readFile(join(dir, "assets", name));
      const type = name.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : name.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "application/octet-stream";
      return new Response(body, { headers: { "content-type": type } });
    } catch (error) {
      if (isMissing(error)) return c.text("missing", 404);
      throw error;
    }
  });
}

/** Bind the app to the process edge: the client routes first (hand-mounted
 * extras inside the same session middleware), then serve the fetch on the
 * port and hand the node server's `close` back — the `issueServer` extension defers it, so
 * `scope.close()` stops the listener. The unmapped-error handler is already
 * in (`issueServer` installs it in `mount`, before this runs). A refusing port
 * rejects the listen wait, so boot fails here, never at a request. The stop
 * waits for the node server to close before the root returns its exit code. */
function servePort(host: string, port: number): HonoScope.Serve {
  return async (app) => {
    await serveClient(app);
    return new Promise<{ close: () => Promise<void> }>((resolve, reject) => {
      const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
        writeLog("listening", { host, port: info.port });
        resolve({
          close: () =>
            new Promise<void>((done, fail) => {
              server.close((error) => (error ? fail(error) : done()));
            }),
        });
      });
      server.once("error", reject);
    });
  };
}

/** The server's one root. First listed is outermost; work after `await next()`
 * runs inside out, so the server listed first opens its port last. A failed
 * `ready` starts cleanup but does not await it: this root waits for `close()`
 * before logging the boot failure. On stop, in-flight requests finish before
 * the port closes. Invalid `PORT` fails before the store opens. */
export async function runServer(env: NodeJS.ProcessEnv, stop: AbortSignal): Promise<number> {
  try {
    const port = readPort(env);
    const host = env.HOST ?? "127.0.0.1";
    const observe = jsonLines(writeLine);
    const scope = createScope({
      tags: [
        store.config(env.DATA_PATH ?? "./data/issues"),
        draftTags(readDraftOptIn(env, host, port)),
      ],
      extensions: [issueServer({ observe, serve: servePort(host, port) }), src, publish()],
      observe,
    });
    try {
      await scope.ready;
    } catch (error: unknown) {
      await scope.close();
      throw error;
    }
    await new Promise<void>((resolve) => {
      if (stop.aborted) resolve();
      else stop.addEventListener("abort", () => resolve(), { once: true });
    });
    return readShutdown(await scope.close({ graceful: true }));
  } catch (error) {
    writeLog("boot failed", describeError(error));
    return 1;
  }
}

/** One JSON line to stdout: the same shape the scope's sink writes. */
function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

function writeLog(message: string, attributes: Record<string, unknown>): void {
  writeLine(JSON.stringify({ kind: "log", time: Date.now(), message, ...attributes }));
}

function readShutdown(result: Scope.Result): number {
  if (result.status === "failed") {
    writeLog("shutdown failed", describeError(result.error));
    return 1;
  }
  if (result.teardownErrors !== undefined && result.teardownErrors.length > 0) {
    writeLog("shutdown failed", { teardown: result.teardownErrors.map(describeError) });
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  process.exitCode = await runServer(process.env, stop.signal);
}
