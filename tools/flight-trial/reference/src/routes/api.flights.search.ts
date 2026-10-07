import { createFileRoute } from "@tanstack/react-router";
import { openFlightSearch } from "../backend/flight-stream";
import { flightSettingsSchema } from "../backend/flight-settings.server";
import { searchInput } from "../contracts/flights";
import { startRequests } from "../scaffold/start";
import { readResult } from "../scaffold/backend/result.server";
export const Route = createFileRoute("/api/flights/search")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      GET: async ({ request, context }) => {
        const query = searchInput.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!query.success) return new Response("Bad search", { status: 400 });
        const result = await context.session.settle(openFlightSearch, {
          input: { query: query.data, settings: flightSettingsSchema.parse(process.env) },
        });
        return new Response(readResult(result), {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
