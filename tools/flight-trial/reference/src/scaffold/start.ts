import { createMiddleware } from "@tanstack/react-start";
import { capsule } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { requestHeaders } from "./backend/headers.server";
import { raise } from "./errors";
import { responseBodies } from "./backend/body.server";
import { requestStop } from "./backend/lifetime";

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
  let closed: Promise<void> | undefined;
  const finish = (graceful: boolean) =>
    (closed ??= Promise.resolve(session.close({ graceful })).then((end) => {
      if (end.teardownErrors?.length) throw end.teardownErrors.at(0);
    }));
  try {
    const result = await next({ context: { session, signal: request.signal } });
    return {
      ...result,
      response: await session.resolve(responseBodies).hold(result.response, finish),
    };
  } catch (error) {
    await finish(false);
    throw error;
  }
});

/** The server entry passes its root as `requestContext.scope` (ADR 0120, X2); all Start
 * boundaries share this middleware. */
export const startRequests = Object.assign(capsule({ label: "start.requests" }), { middleware });
