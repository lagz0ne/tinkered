import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { createScope, type Scope } from "@tinker/core";
import type { HonoScope } from "@tinker/hono";
import { serve } from "@hono/node-server";
import { raise } from "../errors.ts";
import { describeError, jsonLines } from "./observe.ts";
import { draftTags, restore, web, type DraftConfig } from "./parts.ts";
import { publishAfterCommit } from "./publish.ts";
import { store } from "./store.ts";
import { src } from "./sync.ts";

function readHost(): string {
  return process.env.HOST ?? "127.0.0.1";
}

/** The listen port: a missing `PORT` is 4311; anything but a whole number from 1 to 65535
 * raises `BadPort`, so boot fails before the store opens. */
function readPort(): number {
  const raw = process.env.PORT ?? "4311";
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (port >= 1 && port <= 65535) return port;
  return raise("BadPort", { value: raw });
}

function readDataPath(): string {
  return process.env.DATA_PATH ?? "./data/issues";
}

function readDraftOptIn(): DraftConfig | undefined {
  const raw = process.env.DRAFT_HELPER;
  if (raw !== "1" && raw !== "true") return undefined;
  const base = readPublicBase();
  if (base === undefined) return undefined;
  return { enabled: true, baseUrl: base };
}

function readPublicBase(): string | undefined {
  const raw = process.env.PUBLIC_BASE_URL;
  if (raw !== undefined && raw.length > 0) return raw;
  return `http://${readHost()}:${readPort()}`;
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
 * port and hand the node server's `close` back — the `web` part defers it, so
 * `scope.close()` stops the listener. The unmapped-error handler is already
 * in (`web` installs it in `mount`, before this runs). A refusing port
 * rejects the listen wait, so boot fails here, never at a request. A setup
 * failure (a missing client build) rejects the same wait — never an
 * unhandled rejection the process crashes on. */
function servePort(host: string, port: number): HonoScope.Serve {
  return (app) =>
    new Promise<{ readonly close: () => void }>((resolve, reject) => {
      serveClient(app).then(() => {
        const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
          writeLog("listening", { host, port: info.port });
          resolve({ close: () => void server.close() });
        });
        server.once("error", reject);
      }, reject);
    });
}

/** The server's root: every part, listed once. `readPort` runs before
 * `createScope`, so a bad `PORT` fails boot before the store opens. `ready`
 * starts the parts inside-out: the store and the saved list first, the port
 * last. A failed start closes the root (which stops anything bound) before
 * rejecting. Then wait for a signal and close graceful: in-flight requests
 * finish, then the port stops. */
async function main(): Promise<number> {
  const observe = jsonLines(writeLine);
  const scope = createScope({
    tags: [store.config(readDataPath()), draftTags(readDraftOptIn())],
    extensions: [
      src,
      web({ observe, serve: servePort(readHost(), readPort()) }),
      restore,
      publishAfterCommit(),
    ],
    observe,
  });
  try {
    await scope.ready;
  } catch (error: unknown) {
    await scope.close();
    throw error;
  }
  await new Promise<void>((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
  return readShutdown(await scope.close({ graceful: true }));
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

/** A boot failure (the store, the port) is the one error no scope can log:
 * write it to stdout by hand, then exit 1. */
async function entry(): Promise<void> {
  try {
    process.exitCode = await main();
  } catch (error) {
    writeLog("boot failed", describeError(error));
    process.exitCode = 1;
  }
}

await entry();
