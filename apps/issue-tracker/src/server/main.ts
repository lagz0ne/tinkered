import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scope } from "@tinker/core";
import { serve } from "@hono/node-server";
import { bootScope } from "./bridge.ts";
import { buildApp } from "./app.ts";

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

function readDraftOptIn(): { readonly draft?: { readonly enabled: boolean; readonly baseUrl: string } } {
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

function readShutdown(result: Scope.Result): number {
  if (result.status === "failed") return 1;
  if (result.teardownErrors !== undefined && result.teardownErrors.length > 0) return 1;
  return 0;
}

async function main(): Promise<number> {
  const booted = await bootScope(readDataPath(), readDraftOptIn());
  const app = buildApp(booted);
  await serveClient(app);
  const host = readHost();
  const port = readPort();
  const server = serve({ fetch: app.fetch, hostname: host, port });
  await new Promise<void>((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
  server.close();
  return readShutdown(await booted.scope.close());
}

async function entry(): Promise<void> {
  try {
    process.exitCode = await main();
  } catch {
    process.exitCode = 1;
  }
}

await entry();
