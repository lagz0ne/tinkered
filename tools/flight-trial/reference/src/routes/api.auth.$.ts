import { createFileRoute } from "@tanstack/react-router";
import { handleAuth } from "../scaffold/backend/auth.server";
import { startRequests } from "../scaffold/start";
import { readResult } from "../scaffold/backend/result.server";
export const Route = createFileRoute("/api/auth/$")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      GET: async ({ request, context }) =>
        readResult(
          await context.session.settle(handleAuth, { input: request, signal: context.signal }),
        ),
      POST: async ({ request, context }) =>
        readResult(
          await context.session.settle(handleAuth, { input: request, signal: context.signal }),
        ),
    },
  },
});
