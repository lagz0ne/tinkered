import { createFileRoute } from "@tanstack/react-router";
import { refreshBookings } from "../backend/bookings.ts";
import { startRequests } from "../scaffold/start.ts";
import { flightSettings, readFlightSettings } from "../backend/flight-settings.server.ts";
import { readResult } from "../scaffold/backend/result.server.ts";
export const Route = createFileRoute("/api/flights/bookings")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      GET: async ({ context }) =>
        Response.json(
          readResult(
            await context.session.settle(refreshBookings, {
              tags: flightSettings(readFlightSettings(process.env)),
              signal: context.signal,
            }),
          ),
        ),
    },
  },
});
