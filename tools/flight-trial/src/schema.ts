import { z } from "zod";

const positiveInt = z.number().int().positive();
const count = z.number().int().nonnegative();
const cents = z.number().int().nonnegative();
const airportCode = z.string().regex(/^[A-Z]{3}$/);

export const sourceSchema = z.object({
  airports: z.array(
    z.object({
      id: positiveInt,
      name: z.string(),
      city: z.string(),
      country: z.string(),
      code: airportCode,
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
  ),
  airlines: z.array(z.object({ id: positiveInt, name: z.string(), code: z.string() })),
  routes: z.array(
    z.object({ airlineId: positiveInt, origin: airportCode, destination: airportCode }),
  ),
});

export const supplierSchema = z.object({
  id: z.enum(["supplier-a", "supplier-b", "supplier-c"]),
  airlineIds: z.array(positiveInt),
  markupBasisPoints: count,
  feeCents: cents,
});

export const cabinSchema = z.object({
  cabin: z.enum(["economy", "business"]),
  capacity: positiveInt,
  seatsAvailable: count,
  fares: z.array(
    z.object({ fareClass: z.enum(["saver", "standard", "flex"]), amountCents: cents }),
  ),
});

export const flightSchema = z.object({
  id: z.string(),
  airlineId: positiveInt,
  flightNumber: z.string(),
  origin: airportCode,
  destination: airportCode,
  date: z.iso.date(),
  departsAt: z.iso.datetime(),
  arrivesAt: z.iso.datetime(),
  distanceKm: positiveInt,
  durationMinutes: positiveInt,
  cabins: z.array(cabinSchema),
});

export const dataSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff),
  dates: z.array(z.iso.date()),
  currency: z.literal("USD"),
  suppliers: z.array(supplierSchema),
  flights: z.array(flightSchema),
});
