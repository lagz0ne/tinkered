import { operation, resource, type Operation } from "@tinker/core";
import { flightSettings, readFlightSettings } from "./flight-settings.server.ts";
import { searchFlights } from "./flight-search.ts";
import { backendStop, requestStop } from "../scaffold/backend/lifetime.ts";
import type { Flights } from "../contracts/flights.ts";
/** Each HTTP request retains its search body and stop handle until the body ends or cancels. */
const flightSearchStream = resource({
  label: "flight search body",
  target: "session",
  depends: { search: searchFlights.controller, backendStop, requestStop },
  factory({ search, backendStop, requestStop }, ctx) {
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, requestStop, backendStop, ctx.signal]);
    ctx.defer(() => stop.abort());
    return {
      open(input: { query: Flights.Query; settings: ReturnType<typeof readFlightSettings> }) {
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const result = await search.settle({
              input: {
                query: input.query,
                send: (event) => {
                  if (!signal.aborted)
                    controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
                },
              },
              tags: flightSettings(input.settings),
              signal,
            });
            if (!signal.aborted) {
              if (result.status === "failed") controller.error(result.error);
              else controller.close();
            }
          },
          cancel() {
            stop.abort();
          },
        });
        return new Response(stream, {
          headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
        });
      },
    };
  },
});
export const openFlightSearch = operation({
  label: "open flight search body",
  depends: { stream: flightSearchStream },
  run(
    { stream },
    ctx: Operation.Ctx<{ query: Flights.Query; settings: ReturnType<typeof readFlightSettings> }>,
  ) {
    return stream.open(ctx.input);
  },
});
