import { operation, resource } from "@tinker/core";
import { z } from "zod";
import { syncClient } from "../scaffold/frontend/sync.ts";
import { profile, bookingNotice } from "./state.ts";
import { raise } from "../errors.ts";
/** The browser client owns native requests; the sync resource supplies cancellation. */
const bookingClient = resource({
  label: "flight booking client",
  factory: () => ({
    async hold(
      this: void,
      {
        data,
        signal,
      }: {
        data: { executionId: string; offerId: string };
        signal: AbortSignal;
      },
    ) {
      const response = await fetch("/api/flights/hold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
        signal,
      });
      if (!response.ok) raise("WriteRejected", { message: "Hold failed" });
      return response.json();
    },
    async pay(
      this: void,
      {
        data,
        signal,
      }: {
        data: { executionId: string; bookingId: string };
        signal: AbortSignal;
      },
    ) {
      const response = await fetch("/api/flights/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
        signal,
      });
      if (!response.ok) return { kind: "rejected" as const, message: "Payment request refused" };
      return response.json();
    },
    async retry(
      this: void,
      {
        data,
        signal,
      }: {
        data: { executionId: string; bookingId: string };
        signal: AbortSignal;
      },
    ) {
      const response = await fetch("/api/flights/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
        signal,
      });
      if (!response.ok) return { kind: "rejected" as const, message: "Email retry refused" };
      return response.json();
    },
  }),
});
export const holdSeat = operation({
  label: "hold seat",
  input: z.string(),
  depends: { client: bookingClient, profile, sync: syncClient, notice: bookingNotice.controller },
  async run({ client, profile, sync, notice }, ctx) {
    notice.set("");
    if (!profile) {
      notice.set("Sign in required");
      return;
    }
    const executionId = ctx.random.uuid();
    const result = await sync.execute(
      executionId,
      { send: client.hold, data: { executionId, offerId: ctx.input } },
      ctx.signal,
    );
    notice.set(result.kind === "failed" ? result.message : "Held");
  },
});
export const payHold = operation({
  label: "pay saved flight hold",
  input: z.string(),
  depends: { client: bookingClient, sync: syncClient, notice: bookingNotice.controller },
  async run({ client, sync, notice }, ctx) {
    const executionId = ctx.random.uuid();
    const result = await sync.execute(
      executionId,
      { send: client.pay, data: { executionId, bookingId: ctx.input } },
      ctx.signal,
    );
    notice.set(result.kind === "failed" ? result.message : "Processing");
  },
});
export const retryConfirmation = operation({
  label: "retry saved flight confirmation",
  input: z.string(),
  depends: { client: bookingClient, sync: syncClient, notice: bookingNotice.controller },
  async run({ client, sync, notice }, ctx) {
    const executionId = ctx.random.uuid();
    const result = await sync.execute(
      executionId,
      { send: client.retry, data: { executionId, bookingId: ctx.input } },
      ctx.signal,
    );
    notice.set(result.kind === "partial" ? result.notification.message : "Email sent");
  },
});
