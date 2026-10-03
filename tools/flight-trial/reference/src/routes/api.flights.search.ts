import { createFileRoute } from "@tanstack/react-router";
import { openFlightSearch } from "../backend/flight-stream.ts";
import { readFlightSettings } from "../backend/flight-settings.server.ts";
import { searchInput } from "../contracts/flights.ts";
import { startRequests } from "../scaffold/start.ts";
import { readResult } from "../scaffold/backend/result.server.ts";
export const Route = createFileRoute("/api/flights/search")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      GET: async ({ request, context }) => {
        const query = searchInput.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!query.success) return new Response("Bad search", { status: 400 });
        return readResult(
          context.session.settle(openFlightSearch, {
            input: { query: query.data, settings: readFlightSettings(process.env) },
          }),
        );
      },
    },
  },
});
