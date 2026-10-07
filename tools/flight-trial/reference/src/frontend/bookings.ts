import { operation } from "@tinker/core";
import { z } from "zod";
import { syncClient } from "../scaffold/frontend/sync";
import { profile, bookingNotice } from "./state";
import { holdFlightSeat, payFlightBooking, retryFlightMail } from "../transport/bookings.functions";
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
      { send: holdFlightSeat, data: { executionId, offerId: ctx.input } },
      ctx.signal,
    );
    notice.set(result.kind === "failed" ? result.message : "Held");
  },
});
export const payHold = operation({
  label: "pay saved flight hold",
  input: z.string(),
  depends: { sync: syncClient, notice: bookingNotice.controller },
  async run({ sync, notice }, ctx) {
    const executionId = ctx.random.uuid();
    const result = await sync.execute(
      executionId,
      { send: payFlightBooking, data: { executionId, bookingId: ctx.input } },
      ctx.signal,
    );
    notice.set(result.kind === "failed" ? result.message : "Processing");
  },
});
export const retryConfirmation = operation({
  label: "retry saved flight confirmation",
  input: z.string(),
  depends: { sync: syncClient, notice: bookingNotice.controller },
  async run({ sync, notice }, ctx) {
    const executionId = ctx.random.uuid();
    const result = await sync.execute(
      executionId,
      { send: retryFlightMail, data: { executionId, bookingId: ctx.input } },
      ctx.signal,
    );
    notice.set(result.kind === "partial" ? result.notification.message : "Email sent");
  },
});
