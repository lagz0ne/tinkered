import { createScope } from "@tinker/core";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { extensions } from "#tinker/app.server";
import type { getRouter } from "./router.tsx";
import { responseBodies } from "../backend/body.server.ts";
import { backendStop } from "../backend/lifetime.ts";
import { env } from "../env.ts";
import { raise } from "../errors.ts";
import { startRequests } from "../start.ts";

const renderRequest = createStartHandler(async (context) => {
  const { requestContext } = await (entry.owned ??= start());
  const bodies = requestContext.scope.resolve(responseBodies);
  const router: typeof context.router & {
    close?: Awaited<ReturnType<typeof getRouter>>["close"];
  } = context.router;
  if (typeof router.close !== "function") raise("StartScopeMissing", {});
  try {
    const output = await defaultStreamHandler(context);
    if (bodies.isResponse(output)) return bodies.hold(output, router.close);
    return { ...output, response: await bodies.hold(output.response, router.close) };
  } catch (error) {
    await router.close();
    throw error;
  }
});

/** The base's server entry owns the process root and its stop signal (ADR 0100). */
async function start() {
  const stop = new AbortController();
  const app = createScope({
    signal: stop.signal,
    extensions: [startRequests, extensions],
    tags: [backendStop(stop.signal), env({ ...process.env })],
  });
  await app.ready;
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= Promise.resolve().then(async () => {
      stop.abort();
      const end = await app.closed;
      if (end.status === "failed") throw end.error;
      if (end.teardownErrors?.length) throw end.teardownErrors.at(0);
    }));
  if (import.meta.hot) import.meta.hot.dispose(close);
  return { requestContext: app.resolve(startRequests), close };
}

const entry: {
  owned?: ReturnType<typeof start>;
  fetch(request: Request): ReturnType<typeof renderRequest>;
} = {
  async fetch(request: Request) {
    const { requestContext } = await (entry.owned ??= start());
    return renderRequest(request, { context: requestContext });
  },
};
export default entry;
export async function close() {
  if (entry.owned) await (await entry.owned).close();
}
