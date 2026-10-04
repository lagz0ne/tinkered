import { operation, resource, type Operation } from "@tinker/core";
import { flightSettings, flightSettingsSchema } from "./flight-settings.server.ts";
import { searchFlights } from "./flight-search.ts";
import { backendStop, requestStop } from "../scaffold/backend/lifetime.ts";
import type { Flights } from "../contracts/flights.ts";
/** The request owns SSE framing until search ends or its reader cancels. */
const flightSearchStream = resource({
  label: "flight search body",
  target: "session",
  depends: { search: searchFlights.controller, backendStop, requestStop },
  factory({ search, backendStop, requestStop }, ctx) {
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, requestStop, backendStop, ctx.signal]);
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    let ended = false;
    const close = () => {
      if (ended) return;
      ended = true;
      stop.abort();
      output?.close();
    };
    signal.addEventListener("abort", close, { once: true });
    ctx.defer(() => {
      close();
      signal.removeEventListener("abort", close);
    });
    return {
      open(input: {
        query: Flights.Query;
        settings: ReturnType<typeof flightSettingsSchema.parse>;
      }) {
        const encoder = new TextEncoder();
        return new ReadableStream<Uint8Array>({
          async start(controller) {
            output = controller;
            if (ended) {
              controller.close();
              return;
            }
            const result = await search.settle({
              input: {
                query: input.query,
                send: (event) => {
                  if (!ended)
                    controller.enqueue(
                      encoder.encode(`event: flight\ndata: ${JSON.stringify(event)}\n\n`),
                    );
                },
              },
              tags: flightSettings(input.settings),
              signal,
            });
            if (ended) return;
            if (result.status === "failed") {
              ended = true;
              controller.error(result.error);
            } else {
              controller.enqueue(encoder.encode("event: complete\ndata: {}\n\n"));
              close();
            }
          },
          cancel() {
            ended = true;
            stop.abort();
          },
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
    ctx: Operation.Ctx<{
      query: Flights.Query;
      settings: ReturnType<typeof flightSettingsSchema.parse>;
    }>,
  ) {
    return stream.open(ctx.input);
  },
});
