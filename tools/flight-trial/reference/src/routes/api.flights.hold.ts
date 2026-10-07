import { createFileRoute } from "@tanstack/react-router";
import { holdFlight } from "../backend/bookings";
import { startRequests } from "../scaffold/start";
import { flightSettings, flightSettingsSchema } from "../backend/flight-settings.server";
import { readResult } from "../scaffold/backend/result.server";
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
