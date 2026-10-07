import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { makeTestRandom } from "@tinker/core/testing";
import type { z } from "zod";
import { failFlightData } from "./errors";
import { cabinSchema, dataSchema, flightSchema, sourceSchema, supplierSchema } from "./schema";

export declare namespace Flights {
  type Source = z.infer<typeof sourceSchema>;
  type Flight = z.infer<typeof flightSchema>;
  type Cabin = z.infer<typeof cabinSchema>;
  type Supplier = z.infer<typeof supplierSchema>;
  type Data = z.infer<typeof dataSchema>;
  type Query = { supplier: string; origin: string; destination: string; date: string };
  type Offer = Flight & { offerId: string; supplier: Supplier["id"]; currency: "USD" };
  /** Each result is a deep copy. The service owns it and may change fares and seats. */
  type Reader = {
    search(query: Query): Offer[];
    offers(supplier: string): Offer[];
  };
}

const dataDirectory = new URL("../data/", import.meta.url);

function readJson(bytes: Uint8Array, file: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return failFlightData({ file, reason: "Invalid JSON" });
  }
}

async function readSource(): Promise<Flights.Source> {
  const file = new URL("source.json", dataDirectory);
  const parsed = sourceSchema.safeParse(readJson(await readFile(file), file.href));
  if (!parsed.success) failFlightData({ file: file.href, reason: parsed.error.message });
  return parsed.data;
}

/** Dates are UTC departure dates. Loading needs no network or current clock. */
export function readFlights(): Promise<Flights.Reader>;
export function readFlights(bytes: Uint8Array): Promise<Flights.Reader>;
export async function readFlights(bytes?: Uint8Array): Promise<Flights.Reader> {
  const file = new URL("flights.json.gz", dataDirectory);
  const compressed = bytes ?? (await readFile(file));
  let json: Uint8Array;
  try {
    json = gunzipSync(compressed);
  } catch {
    return failFlightData({ file: file.href, reason: "Invalid gzip" });
  }
  const parsed = dataSchema.safeParse(readJson(json, file.href));
  if (!parsed.success) failFlightData({ file: file.href, reason: parsed.error.message });
  const data = parsed.data;
  return {
    search(query) {
      const flights = data.flights.filter(
        (flight) =>
          flight.origin === query.origin &&
          flight.destination === query.destination &&
          flight.date === query.date,
      );
      return createOffers(
        flights,
        data.suppliers.find((supplier) => supplier.id === query.supplier),
      );
    },
    offers(supplier) {
      return createOffers(
        data.flights,
        data.suppliers.find((entry) => entry.id === supplier),
      );
    },
  };
}

function createOffers(
  flights: Flights.Flight[],
  supplier: Flights.Supplier | undefined,
): Flights.Offer[] {
  if (!supplier) return [];
  return flights
    .filter((flight) => supplier.airlineIds.includes(flight.airlineId))
    .map((flight) => {
      const offer = structuredClone(flight);
      for (const cabin of offer.cabins) {
        for (const fare of cabin.fares) {
          fare.amountCents =
            Math.round(fare.amountCents * (1 + supplier.markupBasisPoints / 10000)) +
            supplier.feeCents;
        }
      }
      return {
        ...offer,
        offerId: `${supplier.id}:${flight.id}`,
        supplier: supplier.id,
        currency: "USD",
      };
    });
}

/** Haversine on a 6,371 km sphere; thirty minutes covers taxi and climb. */
function measureRoute(
  origin: Flights.Source["airports"][number],
  destination: Flights.Source["airports"][number],
) {
  const radians = Math.PI / 180;
  const latitude = (destination.latitude - origin.latitude) * radians;
  const longitude = (destination.longitude - origin.longitude) * radians;
  const arc =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(origin.latitude * radians) *
      Math.cos(destination.latitude * radians) *
      Math.sin(longitude / 2) ** 2;
  const distanceKm = Math.max(1, Math.round(6371 * 2 * Math.asin(Math.sqrt(Math.min(1, arc)))));
  return { distanceKm, durationMinutes: Math.ceil(30 + (distanceKm / 800) * 60) };
}

function createCabin(
  cabin: Flights.Cabin["cabin"],
  distanceKm: number,
  nearlyFull: boolean,
  next: () => number,
): Flights.Cabin {
  const capacity = cabin === "economy" ? 180 : 24;
  const seatsAvailable = nearlyFull
    ? 1 + Math.floor(next() * 3)
    : Math.floor(capacity * (0.2 + next() * 0.7));
  const base = Math.round(
    (3500 + distanceKm * 9) * (cabin === "business" ? 2.8 : 1) * (0.9 + next() * 0.2),
  );
  return {
    cabin,
    capacity,
    seatsAvailable,
    fares: [
      { fareClass: "saver", amountCents: base },
      { fareClass: "standard", amountCents: Math.round(base * 1.2) },
      { fareClass: "flex", amountCents: Math.round(base * 1.5) },
    ],
  };
}

/** Each airline is at two suppliers with the same starting seats. Owners change their own copies. */
function createSuppliers(airlines: Flights.Source["airlines"]): Flights.Supplier[] {
  return [
    {
      id: "supplier-a",
      airlineIds: airlines.filter((_, n) => n % 3 !== 0).map((airline) => airline.id),
      markupBasisPoints: 200,
      feeCents: 100,
    },
    {
      id: "supplier-b",
      airlineIds: airlines.filter((_, n) => n % 3 !== 1).map((airline) => airline.id),
      markupBasisPoints: 450,
      feeCents: 0,
    },
    {
      id: "supplier-c",
      airlineIds: airlines.filter((_, n) => n % 3 !== 2).map((airline) => airline.id),
      markupBasisPoints: 100,
      feeCents: 500,
    },
  ];
}

/** Returns owned data. The uint32 seed replays Core's mulberry32 stream. */
export async function generateFlights(seed: number): Promise<Flights.Data> {
  const source = await readSource();
  const random = makeTestRandom({ seed });
  const dates = ["2027-01-15", "2027-01-16"];
  const airports = new Map(source.airports.map((airport) => [airport.code, airport]));
  const airlines = new Map(source.airlines.map((airline) => [airline.id, airline]));
  const flights: Flights.Flight[] = [];
  for (const [routeIndex, route] of source.routes.entries()) {
    const origin = airports.get(route.origin);
    const destination = airports.get(route.destination);
    const airline = airlines.get(route.airlineId);
    if (!origin || !destination || !airline)
      failFlightData({ file: "source.json", reason: "Route references missing data" });
    const { distanceKm, durationMinutes } = measureRoute(origin, destination);
    const departuresPerDay = random.next() < 0.35 ? 2 : 1;
    for (const date of dates) {
      for (let departure = 0; departure < departuresPerDay; departure++) {
        const minute = 360 + departure * 480 + Math.floor(random.next() * 480);
        const departsAt = new Date(`${date}T00:00:00.000Z`).getTime() + minute * 60000;
        const nearlyFull = flights.length % 47 === 0;
        flights.push({
          id: `${route.airlineId}-${route.origin}-${route.destination}-${date}-${departure + 1}`,
          airlineId: route.airlineId,
          flightNumber: `${airline.code}${routeIndex * 2 + departure + 1}`,
          origin: route.origin,
          destination: route.destination,
          date,
          departsAt: new Date(departsAt).toISOString(),
          arrivesAt: new Date(departsAt + durationMinutes * 60000).toISOString(),
          distanceKm,
          durationMinutes,
          cabins: [
            createCabin("economy", distanceKm, nearlyFull, () => random.next()),
            createCabin("business", distanceKm, nearlyFull, () => random.next()),
          ],
        });
      }
    }
  }
  return { seed, dates, currency: "USD", suppliers: createSuppliers(source.airlines), flights };
}
