import { operation, type Operation } from "@tinker/core";
import { z } from "zod";
import { offer, type Flights } from "../contracts/flights.ts";
import { flightSettings } from "./flight-settings.server.ts";
const searchReply = z.object({ data: z.object({ offers: z.array(offer) }) });
export const searchFlights = operation({
  label: "search flights",
  depends: { settings: flightSettings },
  async run(
    { settings },
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
        try {
          const response = await fetch(`${url}/air/offer_requests`, {
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
            signal: ctx.signal,
          });
          if (!response.ok) {
            ctx.input.send({ supplier, status: "failed", offers: [] });
            return;
          }
          const result = searchReply.parse(await response.json());
          ctx.input.send({
            supplier,
            status: "done",
            offers: result.data.offers
              .filter((entry) => entry.fare_class === "saver")
              .map((entry) => ({ ...entry, supplier })),
          });
        } catch (error) {
          if (ctx.signal.aborted) return;
          if (!(error instanceof TypeError)) throw error;
          ctx.input.send({ supplier, status: "failed", offers: [] });
        }
      }),
    );
  },
});
