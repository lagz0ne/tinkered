import { operation, type Operation } from "@tinker/core";
import { z } from "zod";
import { offer, type Flights } from "../contracts/flights";
import { httpRequest } from "../scaffold/backend/http";
import { flightSettings } from "./flight-settings.server";
import { flightQuote } from "./bookings.schema";
import { database } from "./database";
import { isError, raise } from "../errors";
const searchReply = z.object({ data: z.object({ offers: z.array(offer) }) });
const searchSupplier = operation({
  label: "search flight supplier",
  depends: { request: httpRequest.controller },
  async run({ request }, ctx: Operation.Ctx<{ query: Flights.Query; url: string }>) {
    const response = await request.run({
      rawInput: {
        url: `${ctx.input.url}/air/offer_requests`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: {
            slices: [
              {
                origin: ctx.input.query.origin,
                destination: ctx.input.query.destination,
                departure_date: ctx.input.query.date,
              },
            ],
            passengers: [{ type: "adult" }],
            cabin_class: "economy",
          },
        }),
      },
    });
    if (response.status < 200 || response.status >= 300)
      raise("ServiceRejected", { service: "supplier search" });
    return searchReply.parse(JSON.parse(response.body)).data.offers;
  },
});
export const searchFlights = operation({
  label: "search flights",
  depends: { settings: flightSettings, database, search: searchSupplier.controller },
  async run(
    { settings, database, search },
    ctx: Operation.Ctx<{
      query: Flights.Query;
      send: (event: Flights.Event) => void;
    }>,
  ) {
    await Promise.all(
      [
        { supplier: "supplier-a", url: settings.SUPPLIER_A_URL },
        { supplier: "supplier-b", url: settings.SUPPLIER_B_URL },
        { supplier: "supplier-c", url: settings.SUPPLIER_C_URL },
      ].map(async ({ supplier, url }) => {
        const result = await search.settle({ input: { query: ctx.input.query, url } });
        if (result.status === "cancelled") return;
        if (result.status === "failed") {
          if (
            !isError(result.error, "ServiceRejected") &&
            !isError(result.error, "HttpRequestFailed")
          )
            throw result.error;
          ctx.input.send({ supplier, status: "failed", offers: [] });
          return;
        }
        const offers = result.value;
        if (offers.length)
          await database
            .insert(flightQuote)
            .values(offers.map((entry) => ({ id: entry.id, offer: { ...entry, supplier } })));
        ctx.input.send({
          supplier,
          status: "done",
          offers: offers
            .filter((entry) => entry.fare_class === "saver")
            .map((entry) => ({ ...entry, supplier })),
        });
      }),
    );
  },
});
