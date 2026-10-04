import { createServerFn } from "@tanstack/react-start";
import { startRequests } from "../scaffold/start.ts";
import { readResult } from "../scaffold/backend/result.server.ts";
import { readAccount } from "../backend/auth.ts";
import { refreshBookings, holdFlight } from "../backend/bookings.ts";
import { flightSettings, flightSettingsSchema } from "../backend/flight-settings.server.ts";
export const refreshFlightBookings = createServerFn({ method: "GET" })
  .middleware([startRequests.middleware])
  .handler(async ({ context }) => {
    const account = readResult(
      await context.session.settle(readAccount, { signal: context.signal }),
    );
    if (account === null) return { ok: true };
    return readResult(
      await context.session.settle(refreshBookings, {
        tags: flightSettings(flightSettingsSchema.parse(process.env)),
        signal: context.signal,
      }),
    );
  });

import { payBooking } from "../backend/payments.ts";
import { retryBookingMail } from "../backend/booking-mail.ts";
import { holdCommand, bookingCommand } from "../contracts/bookings.ts";
import { paymentSettings, paymentSettingsSchema } from "../backend/payment-http.ts";
import { readReceipt } from "./result.server.ts";
export const holdFlightSeat = createServerFn({ method: "POST" })
  .middleware([startRequests.middleware])
  .validator(holdCommand)
  .handler(async ({ context, data }) =>
    readReceipt(
      await context.session.settle(holdFlight, {
        input: data,
        tags: flightSettings(flightSettingsSchema.parse(process.env)),
        signal: context.signal,
      }),
    ),
  );
export const payFlightBooking = createServerFn({ method: "POST" })
  .middleware([startRequests.middleware])
  .validator(bookingCommand)
  .handler(async ({ context, data }) =>
    readReceipt(
      await context.session.settle(payBooking, {
        input: data,
        tags: [
          flightSettings(flightSettingsSchema.parse(process.env)),
          paymentSettings(paymentSettingsSchema.parse(process.env)),
        ],
        signal: context.signal,
      }),
    ),
  );
export const retryFlightMail = createServerFn({ method: "POST" })
  .middleware([startRequests.middleware])
  .validator(bookingCommand)
  .handler(async ({ context, data }) =>
    readReceipt(
      await context.session.settle(retryBookingMail, {
        input: data,
        signal: context.signal,
      }),
    ),
  );
