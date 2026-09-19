import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

/** Start the app: own the scope, serve the built client plus API and sync.
 * Shutdown is forced: endless SSE streams settle through their own close,
 * so the process never hangs waiting on a live tab. A failed close exits 1. */
async function main(): Promise<number> {
  const booted = await bootScope(readDataPath());
  const app = buildApp(booted);
  await serveClient(app);
  const host = readHost();
  const port = readPort();
  const server = serve({ fetch: app.fetch, hostname: host, port });
  const stopped = new Promise<number>((resolve) => {
    const stop = async (): Promise<void> => {
      server.close();
      const result = await booted.scope.close();
      resolve(result.status === "success" ? 0 : 1);
    };
    process.on("SIGTERM", () => {
      stop().then(reportSignal, reportSignal);
    });
    process.on("SIGINT", () => {
      stop().then(reportSignal, reportSignal);
    });
  });
  return stopped;
}

function reportSignal(): void {
  process.exitCode = 1;
}

async function entry(): Promise<void> {
  try {
    process.exitCode = await main();
  } catch {
    process.exitCode = 1;
  }
}

await entry();
