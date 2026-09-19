import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scope } from "@tinker/core";
import { serve } from "@hono/node-server";
import { bootScope } from "./bridge.ts";
import { buildApp } from "./app.ts";

/** Read HOST/PORT at the door; the later preview honors them. */
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

/** Serve the built client bundle at /; API and sync own their prefixes. */
async function serveClient(app: ReturnType<typeof buildApp>): Promise<void> {
  const dir = join(process.cwd(), "dist", "client");
  app.get("/", async (c) => {
    try {
      return c.html(await readFile(join(dir, "index.html"), "utf8"));
    } catch {
      return c.text("build the client first: vp run build", 503);
    }
  });
  app.get("/assets/:name", async (c) => {
    try {
      const name = c.req.param("name");
      if (name.includes("/") || name.includes("..")) return c.text("bad", 400);
      const body = await readFile(join(dir, "assets", name));
      const type = name.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : name.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "application/octet-stream";
      return new Response(body, { headers: { "content-type": type } });
    } catch {
      return c.text("missing", 404);
    }
  });
}

/** A normal explicit shutdown exits 0: a forced scope close settles
 * `cancelled` by design, which is the expected stop — not a failure.
 * Anything else (failed, teardown errors) exits 1. */
function readShutdown(result: Scope.Result): number {
  if (result.status === "failed") return 1;
  if (result.teardownErrors !== undefined && result.teardownErrors.length > 0) return 1;
  return 0;
}

/** Start the app: own the scope, serve the built client plus API and sync.
 * Shutdown is forced: endless SSE streams settle through their own close,
 * so the process never hangs waiting on a live tab. One owned shutdown
 * promise: the first signal wins, a stop failure still exits the process. */
async function main(): Promise<number> {
  const booted = await bootScope(readDataPath());
  const app = buildApp(booted);
  await serveClient(app);
  const host = readHost();
  const port = readPort();
  const server = serve({ fetch: app.fetch, hostname: host, port });
  const stopped = new Promise<number>((resolve) => {
    let stopping = false;
    const stop = async (): Promise<void> => {
      if (stopping) return;
      stopping = true;
      server.close();
      const result = await booted.scope.close();
      resolve(readShutdown(result));
    };
    const onSignal = (): void => {
      stop().then(reportStopSettled, reportStopFailed);
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
  });
  return stopped;
}

function reportStopSettled(): void {}

function reportStopFailed(error: unknown): void {
  throw error;
}

async function entry(): Promise<void> {
  try {
    process.exitCode = await main();
  } catch {
    process.exitCode = 1;
  }
}

await entry();
