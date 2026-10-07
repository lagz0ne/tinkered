import { operation, type Operation } from "@tinker/core";
import { createHmac, timingSafeEqual } from "node:crypto";
import { paymentSettings } from "./payment-http";
/** The receiver owns its wall clock, secret, raw bytes, and signature check. */
export const verifyPaymentSignature = operation({
  label: "verify payment webhook signature",
  depends: { settings: paymentSettings },
  run({ settings }, ctx: Operation.Ctx<{ body: Uint8Array; signature: string | null }>) {
    const header = ctx.input.signature;
    if (header === null) return false;
    const parts = /^t=(?<time>\d+),v1=(?<digest>[a-f0-9]{64})$/.exec(header)?.groups;
    if (!parts || Math.abs(Number(parts.time) * 1000 - ctx.clock.currentTimeMillis()) > 300000)
      return false;
    const expected = createHmac("sha256", settings.WEBHOOK_SECRET)
      .update(`${parts.time}.`)
      .update(ctx.input.body)
      .digest();
    return timingSafeEqual(expected, Buffer.from(parts.digest, "hex"));
  },
});
