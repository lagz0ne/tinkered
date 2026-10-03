import { createFileRoute } from "@tanstack/react-router";
import { receivePayment } from "../backend/payments.ts";
import { startRequests } from "../scaffold/start.ts";
import { flightSettings, readFlightSettings } from "../backend/flight-settings.server.ts";
import { paymentSettings, readPaymentSettings } from "../backend/payment-http.ts";
import { readResult } from "../scaffold/backend/result.server.ts";
export const Route = createFileRoute("/webhooks/stripe")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      POST: async ({ request, context }) => {
        const result = readResult(
          await context.session.settle(receivePayment, {
            input: {
              body: new Uint8Array(await request.arrayBuffer()),
              signature: request.headers.get("Stripe-Signature"),
            },
            tags: [
              flightSettings(readFlightSettings(process.env)),
              paymentSettings(readPaymentSettings(process.env)),
            ],
            signal: context.signal,
          }),
        );
        return Response.json({ accepted: result.accepted }, { status: result.status });
      },
    },
  },
});
