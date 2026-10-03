import { z } from "zod";
import { flightRow } from "./flights.ts";
export const supplierOrder = z.object({
  id: z.string(),
  type: z.enum(["hold", "instant"]),
  total_amount: z.string(),
  total_currency: z.literal("USD"),
  payment_status: z.object({
    awaiting_payment: z.boolean(),
    payment_required_by: z.string().nullable(),
    paid_at: z.string().nullable(),
    price_guarantee_expires_at: z.string().nullable(),
  }),
});
export const bookingRecord = z.object({
  id: z.string(),
  ownerId: z.string(),
  offer: flightRow,
  orderId: z.string(),
  price: z.string(),
  expires: z.string(),
  paymentId: z.string().nullable(),
  emailState: z.enum(["Not sent", "Sent", "Failed"]),
  state: z.enum(["Held", "Expired", "Processing", "Confirmed", "Payment failed", "Refunded"]),
});
export const holdCommand = z.object({ executionId: z.uuid(), offerId: z.string() });
export declare namespace Bookings {
  type Row = z.infer<typeof bookingRecord>;
}

export const bookingCommand = z.object({ executionId: z.uuid(), bookingId: z.uuid() });
