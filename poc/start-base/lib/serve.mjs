import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve as listen } from "@hono/node-server";

const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

/**
 * @param {string} root - From the CLI; why: static files live under its dist/client.
 * @param {Request} request - From the Node host; why: answer an asset or pass it on.
 */
async function asset(root, request) {
  const publicRoot = resolve(root, "dist/client");
  const path = new URL(request.url).pathname;
  const file = resolve(publicRoot, `.${decodeURIComponent(path)}`);
  if (!path.startsWith("/assets/") || !file.startsWith(`${publicRoot}/assets/`)) return null;
  try {
    return new Response(await readFile(file), {
      headers: {
        "content-type": types[extname(file)] ?? "application/octet-stream",
        "cache-control": "public,max-age=31536000,immutable",
      },
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return new Response(null, { status: 404 });
  }
}

/**
 * The Node host for a built app: assets, then the base's server entry (ADR 0106).
 * @param {string} root - From the CLI; why: the built app to serve.
 */
export async function serve(root) {
  const built = await import(pathToFileURL(join(root, "dist/server/server.js")).href);
  const server = listen({
    overrideGlobalObjects: false,
    hostname: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 4318),
    fetch: async (request) => (await asset(root, request)) ?? built.default.fetch(request),
  });
  console.log(
    `tinker serve: http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 4318}`,
  );
  const stopped = Promise.withResolvers();
  process.once("SIGINT", () => stopped.resolve());
  process.once("SIGTERM", () => stopped.resolve());
  await stopped.promise;
  await Promise.all([
    built.close(),
    new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
  ]);
  return 0;
}
