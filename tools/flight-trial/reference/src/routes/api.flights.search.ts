import { createFileRoute } from "@tanstack/react-router";
import { searchFlights } from "../backend/flight-search.ts";
import { flightSettings, readFlightSettings } from "../backend/flight-settings.server.ts";
import { searchInput } from "../contracts/flights.ts";
import { startRequests } from "../scaffold/start.ts";
export const Route = createFileRoute("/api/flights/search")({
  server: {
    middleware: [startRequests.middleware],
    handlers: {
      GET: async ({ request, context }) => {
        const query = searchInput.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!query.success) return new Response("Bad search", { status: 400 });
        const stop = new AbortController();
        const signal = AbortSignal.any([request.signal, stop.signal]);
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const result = await context.session.settle(searchFlights, {
              input: {
                query: query.data,
                send: (event) => {
                  if (!signal.aborted)
                    controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
                },
              },
              tags: flightSettings(readFlightSettings(process.env)),
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
    },
  },
});
