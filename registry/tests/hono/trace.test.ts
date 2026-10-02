import { expect, test } from "vite-plus/test";
import { createScope, operation } from "@tinker/core";
import { hono, route } from "../../src/hono/index.ts";

const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const parentSpanId = "00f067aa0ba902b7";
const ping = operation({ label: "ping", run: () => "pong" });

test("a valid traceparent joins the request spans to the remote parent", async () => {
  const { extension: web } = hono([route.get("/ping", ping)]);
  const scope = createScope({ extensions: web, observe: { history: 20 } });
  await scope.ready;
  const response = await scope
    .resolve(web)
    .request("/ping", { headers: { traceparent: `00-${traceId}-${parentSpanId}-00` } });
  expect(await response.json()).toBe("pong");
  const request = scope.spans().find((span) => span.name === "GET /ping")!;
  const body = scope.spans().find((span) => span.name === "ping")!;
  expect(request).toMatchObject({ traceId, parentSpanId, sampled: false });
  expect(body).toMatchObject({ traceId, parentSpanId: request.spanId, sampled: false });
  await scope.close();
});

test("a malformed or absent traceparent starts a new trace and still answers", async () => {
  const { extension: web } = hono([route.get("/ping", ping)]);
  const scope = createScope({
    extensions: web,
    observe: { history: 50 },
    trace: { traceId, parentSpanId },
  });
  await scope.ready;
  const bad = [
    undefined,
    "bad",
    `00-${traceId.toUpperCase()}-${parentSpanId}-01`,
    `00-${"0".repeat(32)}-${parentSpanId}-01`,
    `00-${traceId}-${"0".repeat(16)}-01`,
    `ff-${traceId}-${parentSpanId}-01`,
    `00-${traceId}-${parentSpanId}-01-extra`,
    `00-${traceId}-${parentSpanId}-zz`,
    `01-${traceId}-${parentSpanId}-01extra`,
    `00-${traceId}-${parentSpanId}-01,00-${traceId}-${parentSpanId}-01`,
  ];
  for (const traceparent of bad) {
    const response = await scope
      .resolve(web)
      .request("/ping", { headers: traceparent === undefined ? {} : { traceparent } });
    expect(await response.json()).toBe("pong");
    const span = scope.spans().at(-1)!;
    expect(span.traceId).not.toBe(traceId);
    expect(span.parentSpanId).toBeUndefined();
  }
  await scope.close();
});

test("a future traceparent version keeps its known ids and sampled bit", async () => {
  const { extension: web } = hono([route.get("/ping", ping)]);
  const scope = createScope({ extensions: web, observe: { history: 10 } });
  await scope.ready;
  await scope
    .resolve(web)
    .request("/ping", { headers: { traceparent: `01-${traceId}-${parentSpanId}-03-future` } });
  expect(scope.spans().at(-1)).toMatchObject({ traceId, parentSpanId, sampled: true });
  await scope.close();
});
