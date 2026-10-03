import { createFileRoute } from "@tanstack/react-router";
import { holdFlight } from "../backend/bookings.ts";
import { startRequests } from "../scaffold/start.ts";
import { flightSettings, flightSettingsSchema } from "../backend/flight-settings.server.ts";
import { readResult } from "../scaffold/backend/result.server.ts";
export const Route = createFileRoute("/api/flights/hold")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      POST: async ({ request, context }) =>
        Response.json(
          readResult(
            await context.session.settle(holdFlight, {
              rawInput: await request.json(),
              tags: flightSettings(flightSettingsSchema.parse(process.env)),
              signal: context.signal,
            }),
          ),
        ),
    },
  },
});
