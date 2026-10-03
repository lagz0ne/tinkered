import { resource, operation } from "@tinker/core";
import { z } from "zod";
import { syncClient } from "../scaffold/frontend/sync.ts";
import { profile, bookingNotice } from "./state.ts";
import { flightRows } from "./flights.ts";
import { raise } from "../errors.ts";
export const holdSeat = operation({
  label: "hold seat",
  input: z.string(),
  depends: { profile, sync: syncClient, notice: bookingNotice.controller },
  async run({ profile, sync, notice }, ctx) {
    notice.set("");
    if (!profile) {
      notice.set("Sign in required");
      return;
    }
    const executionId = ctx.random.uuid();
    const result = await sync.execute(
      executionId,
      async (signal) => {
        const response = await fetch("/api/flights/hold", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ executionId, offerId: ctx.input }),
          signal,
        });
        if (!response.ok) raise("WriteRejected", { message: "Hold failed" });
        return response.json();
      },
      ctx.signal,
    );
    notice.set(result.kind === "failed" ? result.message : "Held");
  },
});
const seatsReply = z.array(z.object({ id: z.string(), seats: z.number() }));
import { tabStop } from "../scaffold/frontend/owner.ts";
const watchSeats = operation({
  label: "watch flight seats",
  depends: { rows: flightRows.controller, stop: tabStop },
  async run({ rows, stop }, ctx) {
    const signal = AbortSignal.any([ctx.signal, stop]);
    try {
      while (!signal.aborted) {
        const ids = rows.get().map((row) => row.id);
        if (ids.length) {
          const response = await fetch("/api/flights/current", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(ids),
            signal,
          });
          const seats = seatsReply.parse(await response.json());
          rows.update((all) =>
            all.map((row) => ({
              ...row,
              available_seats:
                seats.find((entry) => entry.id === row.id)?.seats ?? row.available_seats,
            })),
          );
        }
        await ctx.clock.sleep(500, signal);
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  },
});
export const seatUpdates = resource({
  label: "flight seat updates",
  depends: { watch: watchSeats.controller },
  factory({ watch }, ctx) {
    const stop = new AbortController();
    const pending = watch.run({ signal: stop.signal });
    ctx.defer(async () => {
      stop.abort();
      await pending;
    });
  },
});
const watchHolds = operation({
  label: "watch holds",
  depends: { stop: tabStop },
  async run({ stop }, ctx) {
    const signal = AbortSignal.any([ctx.signal, stop]);
    try {
      while (!signal.aborted) {
        await fetch("/api/flights/bookings", { signal });
        await ctx.clock.sleep(500, signal);
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  },
});
export const holdUpdates = resource({
  label: "hold updates",
  depends: { watch: watchHolds.controller },
  factory({ watch }, ctx) {
    const stop = new AbortController();
    const pending = watch.run({ signal: stop.signal });
    ctx.defer(async () => {
      stop.abort();
      await pending;
    });
  },
});
