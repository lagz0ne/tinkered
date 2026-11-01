import { createMiddleware } from "@tanstack/react-start";
import type { Scope } from "@tinker/core";

import { responseBodies } from "./backend/body.server";
import { requestHeaders } from "./backend/headers.server";
import { requestStop } from "./backend/lifetime";
import { renderLifetime } from "./backend/render-lifetime.server";
import { raise } from "./errors";

/** Start merges this registry to type the context supplied by the server entry. */
declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { scope?: Scope.Handle } };
  }
}

/** This root middleware uses only fetch context, before global middleware has run. */
const middleware = createMiddleware().server(async ({ context, request, next }) => {
  const scope = context.scope;
  if (scope === undefined) raise("StartScopeMissing", {});

  const session = scope.createSession({
    tags: [requestHeaders(new Headers(request.headers)), requestStop(request.signal)],
  });
  session.resolve(renderLifetime).open(request);

  let closed: Promise<void> | undefined;
  const finish = (graceful: boolean) =>
    (closed ??= Promise.resolve(session.close({ graceful })).then((end) => {
      if (end.teardownErrors?.length) throw end.teardownErrors.at(0);
    }));

  try {
    const result = await next({ context: { session, signal: request.signal } });
    return {
      ...result,
      response: await (await session.resolve(responseBodies)).hold(result.response, finish),
    };
  } catch (error) {
    await finish(false);
    throw error;
  }
});

/** The server entry hands each request its root as `requestContext: { scope }` (ADR 0120, X2);
 * all Start boundaries share this middleware. */
export const startRequests = { middleware };
