import { z } from "zod";
export const searchInput = z.object({
  origin: z.string().regex(/^[A-Z]{3}$/),
  destination: z.string().regex(/^[A-Z]{3}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export const offer = z.object({
  id: z.string(),
  flight_id: z.string(),
  cabin_class: z.enum(["economy", "business"]),
  fare_class: z.enum(["saver", "standard", "flex"]),
  total_amount: z.string().regex(/^\d+\.\d{2}$/),
  total_currency: z.literal("USD"),
  available_seats: z.number().int().nonnegative(),
  slices: z
    .array(
      z.object({
        origin: z.object({ iata_code: z.string() }),
        destination: z.object({ iata_code: z.string() }),
        segments: z.array(z.object({ departing_at: z.string(), arriving_at: z.string() })).min(1),
      }),
    )
    .min(1),
});
export const flightRow = offer.extend({ supplier: z.string() });
export const searchEvent = z.object({
  supplier: z.string(),
  status: z.enum(["done", "failed"]),
  offers: z.array(flightRow),
});
export declare namespace Flights {
  type Query = z.infer<typeof searchInput>;
  type Offer = z.infer<typeof offer>;
  type Row = z.infer<typeof flightRow>;
  type Event = z.infer<typeof searchEvent>;
}
