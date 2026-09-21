import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import type { Scope } from "@tinker/core";
import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app.ts";
import { describeError, jsonLines } from "./observe.ts";

function readHost(): string {
  return process.env.HOST ?? "127.0.0.1";
}

function readPort(): number {
  const raw = process.env.PORT ?? "4311";
  const port = Number.parseInt(raw, 10);
  if (Number.isInteger(port) && port > 0) return port;
  return 4311;
}

function readDataPath(): string {
  return process.env.DATA_PATH ?? "./data/issues";
}

function readDraftOptIn(): {
  readonly draft?: { readonly enabled: boolean; readonly baseUrl: string };
} {
  const raw = process.env.DRAFT_HELPER;
  if (raw !== "1" && raw !== "true") return {};
  const base = readPublicBase();
  if (base === undefined) return {};
  return { draft: { enabled: true, baseUrl: base } };
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

/** Wait for the port: `serve` returns before the listen settles, and a listen
 * error (port taken) fires on the server, not the promise. */
function listening(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
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

/** The server entrypoint: the composition root lives in `createApp`; this only
 * reads the environment, serves the app, and closes graceful on a signal. Log
 * lines and failed spans go to stdout as JSON lines (`jsonLines`). */
async function main(): Promise<number> {
  const { scope, app } = await createApp({
    dataPath: readDataPath(),
    observe: jsonLines(writeLine),
    ...readDraftOptIn(),
  });
  await serveClient(app);
  const host = readHost();
  const port = readPort();
  const server = serve({ fetch: app.fetch, hostname: host, port });
  await listening(server);
  writeLog("listening", { host, port });
  await new Promise<void>((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
  server.close();
  return readShutdown(await scope.close({ graceful: true }));
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
