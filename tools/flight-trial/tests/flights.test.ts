import { expect, test } from "vite-plus/test";
import { generateFlights, readFlights, type Flights } from "../src/index.ts";

const reader = await readFlights();
const generated = await generateFlights(97);
const query: Flights.Query = {
  supplier: "supplier-a",
  origin: "LHR",
  destination: "JFK",
  date: "2027-01-15",
};

/** Fares share each cabin's stock. Services can copy it into their own data. */
test("a known route returns only matching flights", () => {
  const offers = reader.search(query);
  expect(offers.length).toBeGreaterThan(0);
  for (const offer of offers) {
    expect({
      supplier: offer.supplier,
      origin: offer.origin,
      destination: offer.destination,
      date: offer.date,
    }).toEqual(query);
  }
});

test("the same flight appears at two suppliers with their own prices", () => {
  const a = reader.search(query).find((offer) => offer.airlineId === 1355);
  const c = reader.search({ ...query, supplier: "supplier-c" }).find((offer) => offer.id === a?.id);
  if (!a || !c) throw new Error("Expected a shared British Airways flight");
  expect(c.id).toBe(a.id);
  expect(c.cabins.map((cabin) => cabin.seatsAvailable)).toEqual(
    a.cabins.map((cabin) => cabin.seatsAvailable),
  );
  expect(c.cabins.flatMap((cabin) => cabin.fares.map((fare) => fare.amountCents))).not.toEqual(
    a.cabins.flatMap((cabin) => cabin.fares.map((fare) => fare.amountCents)),
  );
});

test("a nearly full flight has one to three seats in each cabin", () => {
  const flight = generated.flights.find((entry) =>
    entry.cabins.every((cabin) => cabin.seatsAvailable <= 3),
  );
  const supplier = generated.suppliers.find((entry) =>
    entry.airlineIds.includes(flight?.airlineId ?? 0),
  );
  if (!flight || !supplier) throw new Error("Expected a nearly full flight");
  const offer = reader
    .search({
      supplier: supplier.id,
      origin: flight.origin,
      destination: flight.destination,
      date: flight.date,
    })
    .find((entry) => entry.id === flight.id);
  if (!offer) throw new Error("Expected the nearly full flight in search");
  expect(
    offer.cabins.every((cabin) => cabin.seatsAvailable >= 1 && cabin.seatsAvailable <= 3),
  ).toBe(true);
});

test("no flight lands before it leaves", () => {
  const queries = new Map<string, Flights.Query>();
  for (const flight of generated.flights) {
    const supplier = generated.suppliers.find((entry) =>
      entry.airlineIds.includes(flight.airlineId),
    );
    if (!supplier) throw new Error("Expected a supplier for every airline");
    const query = {
      supplier: supplier.id,
      origin: flight.origin,
      destination: flight.destination,
      date: flight.date,
    };
    queries.set(`${query.supplier}:${query.origin}:${query.destination}:${query.date}`, query);
  }
  const offers = [...queries.values()].flatMap((query) => reader.search(query));
  expect(new Set(offers.map((offer) => offer.id)).size).toBe(generated.flights.length);
  expect(offers.every((offer) => Date.parse(offer.arrivesAt) > Date.parse(offer.departsAt))).toBe(
    true,
  );
});

test("changing a search result does not change the next search", () => {
  const offers = reader.search(query);
  const before = structuredClone(offers);
  for (const offer of offers) {
    for (const cabin of offer.cabins) {
      cabin.seatsAvailable = 0;
      for (const fare of cabin.fares) fare.amountCents = 1;
    }
  }
  expect(reader.search(query)).toEqual(before);
});

test("a route with no service returns no flights", () => {
  expect(reader.search({ ...query, destination: "ZZZ" })).toEqual([]);
});
