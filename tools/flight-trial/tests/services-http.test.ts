import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  paymentApp,
  port,
  host,
  controlToken,
  stopSignal,
  webhookUrl,
  webhookSecret,
} from "../src/index.ts";
import { httpBackend } from "../services/http-client.ts";

test("each webhook copy has an HTTP span below the webhook operation and its resource", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: paymentApp,
    observe: { history: 200 },
    tags: [
      port(0),
      host("127.0.0.1"),
      controlToken("grader"),
      stopSignal(stop.signal),
      webhookUrl("http://127.0.0.1:1/webhooks/stripe?secret=hidden"),
      webhookSecret("span-test"),
      httpBackend(async () => new Response("accepted", { status: 202 })),
    ],
  });
  try {
    await scope.ready;
    const { url } = scope.resolve(paymentApp);
    const created = await fetch(`${url}/v1/payment_intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 900, currency: "usd" }),
    });
    const intent = z.object({ id: z.string() }).parse(await created.json());
    await (
      await fetch(`${url}/control/webhooks`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer grader" },
        body: JSON.stringify({ intent_id: intent.id, mode: "twice" }),
      })
    ).arrayBuffer();
    await expect
      .poll(() => scope.spans().filter((s) => s.name === "http POST /webhooks/stripe").length)
      .toBe(2);
    const spans = scope.spans();
    const webhook = spans.find((s) => s.name === "deliver signed webhook");
    for (const span of spans.filter((s) => s.name === "http POST /webhooks/stripe")) {
      const request = spans.find((s) => s.id === span.parentId);
      expect(request).toMatchObject({ name: "http.request", parentId: webhook?.id });
      expect(span).toMatchObject({
        status: "ok",
        attributes: {
          "http.request.method": "POST",
          "url.path": "/webhooks/stripe",
          "http.response.status_code": 202,
        },
      });
    }
    expect(spans.some((s) => s.name === "http" && s.kind === "resource")).toBe(true);
  } finally {
    stop.abort();
    await scope.closed;
  }
});
