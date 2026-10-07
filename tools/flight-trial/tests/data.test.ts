import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { expect, test } from "vite-plus/test";
import { generateFlights, isError, readFlights, type Flights } from "../src/index";

const knownFlight: Flights.Flight = {
  id: "1355-LHR-JFK-2027-01-15-1",
  airlineId: 1355,
  flightNumber: "BA2005",
  origin: "LHR",
  destination: "JFK",
  date: "2027-01-15",
  departsAt: "2027-01-15T06:54:00.000Z",
  arrivesAt: "2027-01-15T14:20:00.000Z",
  distanceKm: 5540,
  durationMinutes: 446,
  cabins: [
    {
      cabin: "economy",
      capacity: 180,
      seatsAvailable: 161,
      fares: [
        { fareClass: "saver", amountCents: 55173 },
        { fareClass: "standard", amountCents: 66208 },
        { fareClass: "flex", amountCents: 82760 },
      ],
    },
    {
      cabin: "business",
      capacity: 24,
      seatsAvailable: 18,
      fares: [
        { fareClass: "saver", amountCents: 152083 },
        { fareClass: "standard", amountCents: 182500 },
        { fareClass: "flex", amountCents: 228125 },
      ],
    },
  ],
};
const fixture: Flights.Data = {
  seed: 97,
  dates: ["2027-01-15"],
  currency: "USD",
  flights: [knownFlight],
  suppliers: [
    { id: "supplier-a", airlineIds: [1355], markupBasisPoints: 200, feeCents: 100 },
    { id: "supplier-b", airlineIds: [1355], markupBasisPoints: 450, feeCents: 0 },
    { id: "supplier-c", airlineIds: [1355], markupBasisPoints: 100, feeCents: 500 },
  ],
};
const file = new URL("../data/flights.json.gz", import.meta.url).href;

function encode(value: unknown): Uint8Array {
  return gzipSync(Buffer.from(JSON.stringify(value)));
}

async function readFailure(bytes: Uint8Array) {
  try {
    await readFlights(bytes);
  } catch (error) {
    if (!isError(error, "InvalidFlightData")) throw error;
    return error.payload;
  }
  throw new Error("Expected InvalidFlightData");
}

async function assertRejected(value: unknown, field: string) {
  const payload = await readFailure(encode(value));
  expect(payload.file).toBe(file);
  expect(payload.reason).toContain(`"${field}"`);
}

test("seed 97 produces the saved flight JSON bytes", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../data/manifest.json", import.meta.url), "utf8"),
  );
  const data = await generateFlights(97);
  const hash = createHash("sha256")
    .update(`${JSON.stringify(data)}\n`)
    .digest("hex");
  expect(hash).toBe(manifest.generated.jsonSha256);
});

test("seed 97 gives the known flight its fixed fares seats and times", async () => {
  const data = await generateFlights(97);
  expect(data.flights.find((flight) => flight.id === knownFlight.id)).toEqual(knownFlight);
});

test("each supplier applies its exact markup and fee", async () => {
  const reader = await readFlights(encode(fixture));
  const expected = [
    { supplier: "supplier-a", prices: [56376, 67632, 84515, 155225, 186250, 232788] },
    { supplier: "supplier-b", prices: [57656, 69187, 86484, 158927, 190713, 238391] },
    { supplier: "supplier-c", prices: [56225, 67370, 84088, 154104, 184825, 230906] },
  ];
  for (const row of expected) {
    const offers = reader.offers(row.supplier);
    expect(offers).toHaveLength(1);
    const [offer] = offers;
    expect({
      offerId: offer.offerId,
      supplier: offer.supplier,
      currency: offer.currency,
      prices: offer.cabins.flatMap((cabin) => cabin.fares.map((fare) => fare.amountCents)),
    }).toEqual({
      offerId: `${row.supplier}:${knownFlight.id}`,
      supplier: row.supplier,
      currency: "USD",
      prices: row.prices,
    });
  }
});

test("an unknown supplier returns no offers", async () => {
  const reader = await readFlights();
  expect(reader.offers("supplier-x")).toEqual([]);
  expect(
    reader.search({
      supplier: "supplier-x",
      origin: "LHR",
      destination: "JFK",
      date: "2027-01-15",
    }),
  ).toEqual([]);
});

test("a supplier without matching airlines returns no offers", async () => {
  const reader = await readFlights(
    encode({ ...fixture, suppliers: [{ ...fixture.suppliers[0], airlineIds: [24] }] }),
  );
  expect(reader.offers("supplier-a")).toEqual([]);
});

test("corrupt gzip is rejected with its named error and reason", async () => {
  expect(await readFailure(Buffer.from("broken gzip"))).toEqual({ file, reason: "Invalid gzip" });
});

test("corrupt JSON is rejected with its named error and reason", async () => {
  expect(await readFailure(gzipSync(Buffer.from("{")))).toEqual({ file, reason: "Invalid JSON" });
});

test("the reader rejects currency other than USD", async () => {
  await assertRejected({ ...fixture, currency: "EUR" }, "currency");
});

test("the reader rejects missing flight data", async () => {
  await assertRejected({ ...fixture, flights: undefined }, "flights");
});

test("the reader rejects unknown supplier names in saved data", async () => {
  await assertRejected(
    { ...fixture, suppliers: [{ ...fixture.suppliers[0], id: "supplier-x" }] },
    "id",
  );
});

test("the reader rejects unknown cabin names", async () => {
  await assertRejected(
    {
      ...fixture,
      flights: [{ ...knownFlight, cabins: [{ ...knownFlight.cabins[0], cabin: "first" }] }],
    },
    "cabin",
  );
});

test("the reader rejects unknown fare classes", async () => {
  await assertRejected(
    {
      ...fixture,
      flights: [
        {
          ...knownFlight,
          cabins: [
            { ...knownFlight.cabins[0], fares: [{ fareClass: "unknown", amountCents: 10 }] },
          ],
        },
      ],
    },
    "fareClass",
  );
});

test("the reader rejects negative seats and fractional counts", async () => {
  for (const seatsAvailable of [-1, 1.5]) {
    await assertRejected(
      {
        ...fixture,
        flights: [{ ...knownFlight, cabins: [{ ...knownFlight.cabins[0], seatsAvailable }] }],
      },
      "seatsAvailable",
    );
  }
});

test("the reader rejects nonpositive and fractional airline IDs", async () => {
  for (const airlineId of [0, -1, 1.5]) {
    await assertRejected({ ...fixture, flights: [{ ...knownFlight, airlineId }] }, "airlineId");
  }
});

test("the reader rejects negative and fractional prices", async () => {
  for (const amountCents of [-1, 1.5]) {
    await assertRejected(
      {
        ...fixture,
        flights: [
          {
            ...knownFlight,
            cabins: [{ ...knownFlight.cabins[0], fares: [{ fareClass: "saver", amountCents }] }],
          },
        ],
      },
      "amountCents",
    );
  }
});

test("the reader rejects seeds outside the unsigned 32 bit range", async () => {
  for (const seed of [-1, 4294967296, 1.5]) await assertRejected({ ...fixture, seed }, "seed");
});

test("the reader accepts zero counts and both seed bounds", async () => {
  for (const seed of [0, 4294967295]) {
    const reader = await readFlights(
      encode({
        ...fixture,
        seed,
        suppliers: [{ ...fixture.suppliers[0], markupBasisPoints: 0, feeCents: 0 }],
        flights: [
          {
            ...knownFlight,
            cabins: [
              {
                cabin: "economy",
                capacity: 1,
                seatsAvailable: 0,
                fares: [{ fareClass: "saver", amountCents: 0 }],
              },
            ],
          },
        ],
      }),
    );
    expect(reader.offers("supplier-a").flatMap((offer) => offer.cabins)).toEqual([
      {
        cabin: "economy",
        capacity: 1,
        seatsAvailable: 0,
        fares: [{ fareClass: "saver", amountCents: 0 }],
      },
    ]);
  }
});

test("the reader rejects invalid departure dates", async () => {
  await assertRejected({ ...fixture, flights: [{ ...knownFlight, date: "2027-02-30" }] }, "date");
});

test("the reader rejects invalid arrival timestamps", async () => {
  await assertRejected(
    { ...fixture, flights: [{ ...knownFlight, arrivesAt: "tomorrow" }] },
    "arrivesAt",
  );
});

test("the reader rejects airport codes with extra or lowercase letters", async () => {
  for (const origin of ["lhr", "XLHR", "LHRX", "LH"]) {
    await assertRejected({ ...fixture, flights: [{ ...knownFlight, origin }] }, "origin");
  }
});
