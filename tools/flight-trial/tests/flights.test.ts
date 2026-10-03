import { expect, test } from "vite-plus/test";
import { generateFlights, readFlights, type Flights } from "../src/index.ts";

const reader = await readFlights();
const generated = await generateFlights(97);
const suppliers: Flights.Supplier["id"][] = ["supplier-a", "supplier-b", "supplier-c"];
const allOffers = suppliers.flatMap((supplier) => reader.offers(supplier));
const flights = [...new Map(allOffers.map((offer) => [offer.id, offer])).values()];
const query: Flights.Query = {
  supplier: "supplier-a",
  origin: "LHR",
  destination: "JFK",
  date: "2027-01-15",
};

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
  const offer = allOffers.find((entry) => entry.cabins.every((cabin) => cabin.seatsAvailable <= 3));
  if (!offer) throw new Error("Expected a nearly full flight in the supplier's offers");
  for (const cabin of offer.cabins) {
    expect(cabin.seatsAvailable, `${offer.id} ${cabin.cabin}`).toBeGreaterThanOrEqual(1);
    expect(cabin.seatsAvailable, `${offer.id} ${cabin.cabin}`).toBeLessThanOrEqual(3);
  }
});

test("no flight lands before it leaves", () => {
  const badOfferIds = allOffers
    .filter((offer) => Date.parse(offer.arrivesAt) <= Date.parse(offer.departsAt))
    .map((offer) => offer.offerId);
  expect(badOfferIds).toEqual([]);
});

test("changing an offer does not change later reads", () => {
  const offers = reader.offers(query.supplier);
  const before = structuredClone(offers);
  for (const offer of offers) {
    for (const cabin of offer.cabins) {
      cabin.seatsAvailable = 0;
      for (const fare of cabin.fares) fare.amountCents = 1;
    }
  }
  expect(reader.offers(query.supplier)).toEqual(before);
  expect(reader.search(query)).toEqual(
    before.filter(
      (offer) =>
        offer.origin === query.origin &&
        offer.destination === query.destination &&
        offer.date === query.date,
    ),
  );
});

test("a route with no service returns no flights", () => {
  expect(reader.search({ ...query, destination: "ZZZ" })).toEqual([]);
});

test("offers lists every flight the supplier carries", () => {
  for (const supplier of generated.suppliers) {
    const expectedIds = generated.flights
      .filter((flight) => supplier.airlineIds.includes(flight.airlineId))
      .map((flight) => flight.id);
    expect(
      reader.offers(supplier.id).map((offer) => offer.id),
      supplier.id,
    ).toEqual(expectedIds);
  }
});

test("offers uses the same prices as search", () => {
  const matching = reader
    .offers(query.supplier)
    .filter(
      (offer) =>
        offer.origin === query.origin &&
        offer.destination === query.destination &&
        offer.date === query.date,
    );
  expect(matching).toEqual(reader.search(query));
});

test("flight numbers repeat daily for the same route and departure slot", () => {
  const firstDay = new Map(
    flights
      .filter((flight) => flight.date === "2027-01-15")
      .map((flight) => [flight.id.replace(flight.date, ""), flight.flightNumber]),
  );
  const changedIds = flights
    .filter(
      (flight) =>
        flight.date === "2027-01-16" &&
        firstDay.get(flight.id.replace(flight.date, "")) !== flight.flightNumber,
    )
    .map((flight) => flight.id);
  expect(changedIds).toEqual([]);
});

test("flight numbers have one to four digits after the airline code", () => {
  const badIds = flights
    .filter((flight) => !/^[A-Z0-9]{2}[1-9][0-9]{0,3}$/.test(flight.flightNumber))
    .map((flight) => flight.id);
  expect(badIds).toEqual([]);
});

test("flight numbers are unique per airline and date", () => {
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const flight of flights) {
    const key = `${flight.airlineId}:${flight.date}:${flight.flightNumber}`;
    if (seen.has(key)) duplicateIds.push(flight.id);
    seen.add(key);
  }
  expect(duplicateIds).toEqual([]);
});
