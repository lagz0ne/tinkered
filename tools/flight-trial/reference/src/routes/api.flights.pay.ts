import { createFileRoute } from "@tanstack/react-router";
import { payBooking } from "../backend/payments.ts";
import { readAccount } from "../backend/auth.ts";
import { startRequests } from "../scaffold/start.ts";
import { flightSettings, flightSettingsSchema } from "../backend/flight-settings.server.ts";
import { paymentSettings, paymentSettingsSchema } from "../backend/payment-http.ts";
import { readResult } from "../scaffold/backend/result.server.ts";
import { isError } from "../errors.ts";
export const Route = createFileRoute("/api/flights/pay")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      POST: async ({ request, context }) => {
        const account = readResult(
          await context.session.settle(readAccount, { signal: context.signal }),
        );
        if (account === null)
          return Response.json({ message: "Sign in required" }, { status: 401 });
        const result = await context.session.settle(payBooking, {
          rawInput: await request.json(),
          tags: [
            flightSettings(flightSettingsSchema.parse(process.env)),
            paymentSettings(paymentSettingsSchema.parse(process.env)),
          ],
          signal: context.signal,
        });
        if (result.status === "failed" && isError(result.error, "BookingDenied"))
          return Response.json({ message: "Booking belongs to another traveler" }, { status: 403 });
        return Response.json(readResult(result));
      },
    },
  },
});
