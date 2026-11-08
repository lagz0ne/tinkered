import { createScope, capsule, resource } from "@tinker/core";
import { makeTestClock, makeTestRandom } from "@tinker/core/testing";
import { z } from "zod";
import { expect, test } from "vite-plus/test";
import {
  supplierApp,
  paymentApp,
  supplierId,
  port,
  host,
  controlToken,
  stopSignal,
  webhookUrl,
  webhookSecret,
} from "../src/index";

const observed = resource({
  label: "protocol operation calls",
  factory: (): { label: string; call: unknown; value: unknown }[] => [],
});
const observeMeta = { role: "state", explain: "Records each boundary call" } as const;
const observe = capsule({
  label: "observe protocol boundary",
  hooks: {
    run(event) {
      const value = event.next();
      const label = event.op.label;
      if (
        label !== undefined &&
        ["search supplier flights", "book supplier order", "create payment intent"].includes(label)
      ) {
        void event
          .load(observed, observeMeta)
          .then((list) => list.push({ label, call: event.call, value }));
      }
      return value;
    },
  },
});

test("supplier operations take booking params and return domain values", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    clock: makeTestClock({ now: 10000 }),
    random: makeTestRandom({ seed: 97 }),
    capsules: [observe, supplierApp],
    tags: [
      supplierId("supplier-a"),
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
    ],
  });
  try {
    await scope.ready;
    const { url } = await supplierApp.serve(await scope.ready);
    const search = await fetch(`${url}/air/offer_requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { slices: [{ origin: "LHR", destination: "AMS", departure_date: "2027-01-15" }] },
      }),
    });
    const found = z
      .object({
        data: z
          .object({ offers: z.array(z.object({ id: z.string() }).passthrough()) })
          .passthrough(),
      })
      .parse(await search.json());
    const offerId = found.data.offers.at(0)!.id;
    const booked = await fetch(`${url}/air/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { selected_offers: [offerId], type: "hold" } }),
    });
    const order = z.object({ data: z.record(z.string(), z.unknown()) }).parse(await booked.json());
    expect(scope.resolve(observed)).toEqual([
      {
        label: "search supplier flights",
        call: {
          input: {
            origin: "LHR",
            destination: "AMS",
            date: "2027-01-15",
            cabin: "economy",
            passengers: 1,
          },
        },
        value: found.data,
      },
      {
        label: "book supplier order",
        call: { input: { offerId, type: "hold", passengers: 1 } },
        value: order.data,
      },
    ]);
  } finally {
    stop.abort();
    await scope.closed;
  }
});

test("Hono validates forms before a payment operation sees params", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    capsules: [observe, paymentApp],
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrl("http://127.0.0.1:1"),
      webhookSecret("protocol-test"),
    ],
  });
  try {
    await scope.ready;
    const { url } = await paymentApp.serve(await scope.ready);
    await (await fetch(`${url}/v1/payment_intents`, { method: "POST", body: "{" })).arrayBuffer();
    const created = await fetch(`${url}/v1/payment_intents`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "amount=900&currency=USD&metadata[booking]=one",
    });
    const intent = z.record(z.string(), z.unknown()).parse(await created.json());
    expect(scope.resolve(observed)).toEqual([
      {
        label: "create payment intent",
        call: { input: { amount: 900, currency: "usd", metadata: { booking: "one" } } },
        value: intent,
      },
    ]);
  } finally {
    stop.abort();
    await scope.closed;
  }
});
