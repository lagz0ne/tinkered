import { operation, type Operation } from "@tinker/core";
import { flightSettings } from "./flight-settings.server.ts";
/** The selected supplier comes from a validated server quote, never a caller's URL. */
export const callSupplier = operation({
  label: "call flight supplier",
  depends: { settings: flightSettings },
  async run({ settings }, ctx: Operation.Ctx<{ supplier: string; path: string; body?: unknown }>) {
    const urls: Record<string, string> = {
      "supplier-a": settings.SUPPLIER_A_URL,
      "supplier-b": settings.SUPPLIER_B_URL,
      "supplier-c": settings.SUPPLIER_C_URL,
    };
    return fetch(`${urls[ctx.input.supplier]}${ctx.input.path}`, {
      method: ctx.input.body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      ...(ctx.input.body === undefined ? {} : { body: JSON.stringify(ctx.input.body) }),
      signal: ctx.signal,
    });
  },
});
