import { createHmac, timingSafeEqual } from "node:crypto";
/** Pure wire checks borrow bytes; the receiver supplies its clock and secret. */
export function verifyPaymentSignature(
  body: Uint8Array,
  header: string | null,
  secret: string,
  now: number,
) {
  if (header === null) return false;
  const parts = /^t=(?<time>\d+),v1=(?<digest>[a-f0-9]{64})$/.exec(header)?.groups;
  if (!parts || Math.abs(Number(parts.time) * 1000 - now) > 300000) return false;
  const expected = createHmac("sha256", secret).update(`${parts.time}.`).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(parts.digest, "hex"));
}
