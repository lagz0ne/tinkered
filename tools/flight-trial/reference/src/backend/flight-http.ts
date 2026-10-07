import { operation, resource, type Operation } from "@tinker/core";
import { z } from "zod";
import { httpRequest } from "../scaffold/backend/http";
import { flightSettings } from "./flight-settings.server";
import { offer } from "../contracts/flights";
import { supplierOrder } from "../contracts/bookings";
import { raise } from "../errors";
const supplierUrls = resource({
  label: "flight supplier URLs",
  target: "session",
  depends: { settings: flightSettings },
  factory: ({ settings }): Record<string, string> => ({
    "supplier-a": settings.SUPPLIER_A_URL,
    "supplier-b": settings.SUPPLIER_B_URL,
    "supplier-c": settings.SUPPLIER_C_URL,
  }),
});
const offerReply = z.object({ data: offer });
const orderReply = z.object({ data: supplierOrder });
export const readSupplierOffer = operation({
  label: "read supplier offer",
  depends: { urls: supplierUrls, request: httpRequest.controller },
  async run({ urls, request }, ctx: Operation.Ctx<{ supplier: string; offerId: string }>) {
    const reply = await request.run({
      rawInput: {
        url: `${urls[ctx.input.supplier]}/air/offers/${ctx.input.offerId}`,
        method: "GET",
      },
    });
    if (reply.status !== 200) raise("ServiceRejected", { service: "supplier offer" });
    return offerReply.parse(JSON.parse(reply.body)).data;
  },
});
export const readSupplierOrder = operation({
  label: "read supplier order",
  depends: { urls: supplierUrls, request: httpRequest.controller },
  async run({ urls, request }, ctx: Operation.Ctx<{ supplier: string; orderId: string }>) {
    const reply = await request.run({
      rawInput: {
        url: `${urls[ctx.input.supplier]}/air/orders/${ctx.input.orderId}`,
        method: "GET",
      },
    });
    if (reply.status !== 200) raise("ServiceRejected", { service: "supplier order" });
    return orderReply.parse(JSON.parse(reply.body)).data;
  },
});
export const holdSupplierOffer = operation({
  label: "hold supplier offer",
  depends: { urls: supplierUrls, request: httpRequest.controller },
  async run({ urls, request }, ctx: Operation.Ctx<{ supplier: string; offerId: string }>) {
    const reply = await request.run({
      rawInput: {
        url: `${urls[ctx.input.supplier]}/air/orders`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { selected_offers: [ctx.input.offerId], type: "hold" } }),
      },
    });
    if (reply.status === 409) raise("OfferSoldOut", { offerId: ctx.input.offerId });
    if (reply.status !== 201) raise("ServiceRejected", { service: "supplier hold" });
    return orderReply.parse(JSON.parse(reply.body)).data;
  },
});
export const paySupplierOrder = operation({
  label: "pay supplier order",
  depends: { urls: supplierUrls, request: httpRequest.controller },
  async run(
    { urls, request },
    ctx: Operation.Ctx<{ supplier: string; orderId: string; price: string }>,
  ) {
    const reply = await request.run({
      rawInput: {
        url: `${urls[ctx.input.supplier]}/air/payments`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: {
            order_id: ctx.input.orderId,
            payment: { type: "balance", amount: ctx.input.price, currency: "USD" },
          },
        }),
      },
    });
    if (reply.status === 409) return false;
    if (reply.status < 200 || reply.status >= 300)
      raise("ServiceRejected", { service: "supplier payment" });
    return true;
  },
});
