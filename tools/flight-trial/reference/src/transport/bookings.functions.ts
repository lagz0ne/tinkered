import { createServerFn } from "@tanstack/react-start";
import { startRequests } from "../scaffold/start.ts";
import { readResult } from "../scaffold/backend/result.server.ts";
import { readAccount } from "../backend/auth.ts";
import { refreshBookings } from "../backend/bookings.ts";
import { flightSettings, readFlightSettings } from "../backend/flight-settings.server.ts";
export const refreshFlightBookings = createServerFn({ method: "GET" })
  .middleware([startRequests.middleware])
  .handler(async ({ context }) => {
    const account = readResult(
      await context.session.settle(readAccount, { signal: context.signal }),
    );
    if (account === null) return { ok: true };
    return readResult(
      await context.session.settle(refreshBookings, {
        tags: flightSettings(readFlightSettings(process.env)),
        signal: context.signal,
      }),
    );
  });
