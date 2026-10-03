import { createFileRoute } from "@tanstack/react-router";
import { readFlightSeats } from "../backend/bookings.ts";
import { startRequests } from "../scaffold/start.ts";
import { flightSettings, readFlightSettings } from "../backend/flight-settings.server.ts";
import { readResult } from "../scaffold/backend/result.server.ts";
export const Route = createFileRoute("/api/flights/current")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      POST: async ({ request, context }) =>
        Response.json(
          readResult(
            await context.session.settle(readFlightSeats, {
              rawInput: await request.json(),
              tags: flightSettings(readFlightSettings(process.env)),
              signal: context.signal,
            }),
          ),
        ),
    },
  },
});
