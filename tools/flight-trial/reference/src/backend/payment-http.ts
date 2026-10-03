import { operation, tag, type Operation } from "@tinker/core";
import { z } from "zod";
const settings = z.object({ PAYMENT_URL: z.url(), WEBHOOK_SECRET: z.string().min(1) });
/** Parse the fixed process settings.
 * @param env - From the HTTP entry environment; for payment calls and signature verification.
 */
export const readPaymentSettings = (env: { PAYMENT_URL?: string; WEBHOOK_SECRET?: string }) =>
  settings.parse(env);
export const paymentSettings = tag<z.infer<typeof settings>>({ label: "flight payment settings" });
/** The call owns the fetch body and transfers only parsed JSON to its caller. */
export const callPayment = operation({
  label: "call payment service",
  depends: { settings: paymentSettings },
  async run({ settings }, ctx: Operation.Ctx<{ path: string; body: unknown; key: string }>) {
    const response = await fetch(`${settings.PAYMENT_URL}${ctx.input.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": ctx.input.key },
      body: JSON.stringify(ctx.input.body),
      signal: ctx.signal,
    });
    const body: unknown = await response.json();
    return { ok: response.ok, status: response.status, body };
  },
});
