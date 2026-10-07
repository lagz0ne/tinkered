import { operation, tag, type Operation } from "@tinker/core";
import { z } from "zod";
import { httpRequest } from "../scaffold/backend/http";
import { raise } from "../errors";
export const paymentSettingsSchema = z.object({
  PAYMENT_URL: z.url(),
  WEBHOOK_SECRET: z.string().min(1),
});
export const paymentSettings = tag<z.infer<typeof paymentSettingsSchema>>({
  label: "flight payment settings",
});
const intent = z.object({
  id: z.string(),
  amount: z.number().int().positive(),
  currency: z.literal("usd"),
});
export const createPaymentIntent = operation({
  label: "create flight payment intent",
  depends: { settings: paymentSettings, request: httpRequest.controller },
  async run({ settings, request }, ctx: Operation.Ctx<{ bookingId: string; amount: number }>) {
    const reply = await request.run({
      rawInput: {
        url: `${settings.PAYMENT_URL}/v1/payment_intents`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `create-${ctx.input.bookingId}`,
        },
        body: JSON.stringify({ amount: ctx.input.amount, currency: "usd" }),
      },
    });
    if (reply.status < 200 || reply.status >= 300) raise("ServiceRejected", { service: "payment" });
    return intent.parse(JSON.parse(reply.body));
  },
});
export const confirmPaymentIntent = operation({
  label: "confirm flight payment intent",
  depends: { settings: paymentSettings, request: httpRequest.controller },
  async run({ settings, request }, ctx: Operation.Ctx<{ bookingId: string; paymentId: string }>) {
    const reply = await request.run({
      rawInput: {
        url: `${settings.PAYMENT_URL}/v1/payment_intents/${ctx.input.paymentId}/confirm`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `confirm-${ctx.input.bookingId}`,
        },
        body: "{}",
      },
    });
    if (reply.status < 200 || reply.status >= 300) raise("ServiceRejected", { service: "payment" });
    return intent.parse(JSON.parse(reply.body));
  },
});
export const refundPayment = operation({
  label: "refund flight payment",
  depends: { settings: paymentSettings, request: httpRequest.controller },
  async run({ settings, request }, ctx: Operation.Ctx<{ bookingId: string; paymentId: string }>) {
    const reply = await request.run({
      rawInput: {
        url: `${settings.PAYMENT_URL}/v1/refunds`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `refund-${ctx.input.bookingId}`,
        },
        body: JSON.stringify({ payment_intent: ctx.input.paymentId }),
      },
    });
    if (reply.status < 200 || reply.status >= 300) raise("ServiceRejected", { service: "refund" });
    return z
      .object({ amount: z.number(), status: z.literal("succeeded") })
      .parse(JSON.parse(reply.body));
  },
});
