import { z } from "zod";
import { verifyPaymentSignature } from "../backend/payment-signature";
import { createFileRoute } from "@tanstack/react-router";
import { receivePayment } from "../backend/payments";
import { startRequests } from "../scaffold/start";
import { flightSettings, flightSettingsSchema } from "../backend/flight-settings.server";
import { paymentSettings, paymentSettingsSchema } from "../backend/payment-http";
import { readResult } from "../scaffold/backend/result.server";
const paymentEvent = z.object({
  id: z.string(),
  type: z.enum(["payment_intent.succeeded", "payment_intent.payment_failed"]),
  data: z.object({
    object: z.object({
      id: z.string(),
      amount: z.number().int().positive(),
      currency: z.literal("usd"),
    }),
  }),
});
export const Route = createFileRoute("/webhooks/stripe")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      POST: async ({ request, context }) => {
        const body = new Uint8Array(await request.arrayBuffer());
        const tags = [
          flightSettings(flightSettingsSchema.parse(process.env)),
          paymentSettings(paymentSettingsSchema.parse(process.env)),
        ];
        const verified = readResult(
          await context.session.settle(verifyPaymentSignature, {
            input: { body, signature: request.headers.get("Stripe-Signature") },
            tags,
            signal: context.signal,
          }),
        );
        if (!verified) return Response.json({ accepted: false }, { status: 400 });
        let raw: unknown;
        try {
          raw = JSON.parse(new TextDecoder().decode(body));
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          return Response.json({ accepted: false }, { status: 400 });
        }
        const parsed = paymentEvent.safeParse(raw);
        if (!parsed.success) return Response.json({ accepted: false }, { status: 400 });
        const result = readResult(
          await context.session.settle(receivePayment, {
            input: {
              paymentId: parsed.data.data.object.id,
              amount: parsed.data.data.object.amount,
              succeeded: parsed.data.type === "payment_intent.succeeded",
            },
            tags,
            signal: context.signal,
          }),
        );
        return Response.json(
          { accepted: result.accepted },
          { status: result.accepted ? 200 : 400 },
        );
      },
    },
  },
});
