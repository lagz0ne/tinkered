import { operation } from "@tinker/core";
import { z } from "zod";
import { syncClient } from "../scaffold/frontend/sync.ts";
import { profile, bookingNotice } from "./state.ts";
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
export const payHold = operation({
  label: "pay saved flight hold",
  input: z.string(),
  depends: { sync: syncClient, notice: bookingNotice.controller },
  async run({ sync, notice }, ctx) {
    const executionId = ctx.random.uuid();
    const result = await sync.execute(
      executionId,
      async (signal) => {
        const response = await fetch("/api/flights/pay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ executionId, bookingId: ctx.input }),
          signal,
        });
        if (!response.ok) return { kind: "rejected" as const, message: "Payment request refused" };
        return response.json();
      },
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
      async (signal) => {
        const response = await fetch("/api/flights/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ executionId, bookingId: ctx.input }),
          signal,
        });
        if (!response.ok) return { kind: "rejected" as const, message: "Email retry refused" };
        return response.json();
      },
      ctx.signal,
    );
    notice.set(result.kind === "partial" ? result.notification.message : "Email sent");
  },
});
