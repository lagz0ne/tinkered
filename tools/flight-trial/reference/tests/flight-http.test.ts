import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import {
  readSupplierOffer,
  holdSupplierOffer,
  createPaymentIntent,
  flightSettings,
  paymentSettings,
  isError,
} from "@tinker-start-scaffold/backend";
import { httpBackend } from "@tinker-start-scaffold/transport";
const settings = flightSettings({
  SUPPLIER_A_URL: "http://supplier-a:4311",
  SUPPLIER_B_URL: "http://supplier-b:4312",
  SUPPLIER_C_URL: "http://supplier-c:4313",
});
const fare = {
  id: "offer-1",
  flight_id: "flight-1",
  cabin_class: "economy",
  fare_class: "saver",
  total_amount: "25.00",
  total_currency: "USD",
  available_seats: 1,
  slices: [
    {
      origin: { iata_code: "LHR" },
      destination: { iata_code: "AMS" },
      segments: [{ departing_at: "2027-01-15T10:00:00Z", arriving_at: "2027-01-15T11:00:00Z" }],
    },
  ],
};
test("a supplier offer returns fare facts and owns an HTTP child span", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    observe: { history: 20 },
    tags: [settings, httpBackend(async () => Response.json({ data: fare }))],
  });
  await scope.ready;
  try {
    expect(
      await scope.run(readSupplierOffer, { input: { supplier: "supplier-a", offerId: "offer-1" } }),
    ).toEqual(fare);
    const spans = scope.spans();
    const caller = spans.find((span) => span.name === "read supplier offer");
    const request = spans.find((span) => span.name === "http.request");
    expect(request?.parentId).toBe(caller?.id);
    expect(
      spans.find((span) => span.name === "http GET /air/offers/offer-1")?.attributes[
        "http.response.status_code"
      ],
    ).toBe(200);
  } finally {
    stop.abort();
    await scope.closed;
  }
});
test("a sold out supplier hold raises OfferSoldOut for the booking", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    tags: [
      settings,
      httpBackend(async () =>
        Response.json({ errors: [{ code: "offer_sold_out" }] }, { status: 409 }),
      ),
    ],
  });
  await scope.ready;
  try {
    const result = await scope.settle(holdSupplierOffer, {
      input: { supplier: "supplier-a", offerId: "offer-1" },
    });
    if (result.status !== "failed") throw result;
    if (!isError(result.error, "OfferSoldOut")) throw result.error;
    expect(result.error.payload).toEqual({ offerId: "offer-1" });
  } finally {
    stop.abort();
    await scope.closed;
  }
});
test("creating a payment returns intent facts without a wire reply", async () => {
  const stop = new AbortController();
  const intent = { id: "pi-1", amount: 2500, currency: "usd" };
  const scope = createScope({
    signal: stop.signal,
    tags: [
      paymentSettings({ PAYMENT_URL: "http://payment:4314", WEBHOOK_SECRET: "test-secret" }),
      httpBackend(async () => Response.json(intent)),
    ],
  });
  await scope.ready;
  try {
    expect(
      await scope.run(createPaymentIntent, { input: { bookingId: "booking-1", amount: 2500 } }),
    ).toEqual(intent);
  } finally {
    stop.abort();
    await scope.closed;
  }
});
