import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { connect, headers, type Msg } from "@nats-io/transport-node";
import { startNatsServer, type NatsServer } from "@tinker/nats/testing";
import { createScope, operation, type Observe, type Operation } from "@tinker/core";
import { nats, subscribe, type Nats } from "../src/index.ts";

let server: NatsServer.Handle;
beforeAll(async () => {
  server = await startNatsServer();
});
afterAll(async () => {
  await server.close();
});
const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const parentSpanId = "00f067aa0ba902b7";

test.each([false, true])(
  "a traced publish joins the subscriber operation to the same trace and parent (%s)",
  async (sampled) => {
    const spans: Observe.Span[] = [];
    const received = Promise.withResolvers<void>();
    const receive = operation({
      label: "receive",
      run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => received.resolve(),
    });
    const listener = nats([subscribe("trace", receive)], { env: { NATS_URL: server.url } });
    const sender = nats([], { env: { NATS_URL: server.url } });
    const observe = { export: (span: Observe.Span) => spans.push(span) };
    const from = createScope({
      extensions: sender.extension,
      observe,
      trace: { traceId, parentSpanId, sampled },
    });
    const to = createScope({ extensions: listener.extension, observe });
    try {
      await Promise.all([from.ready, to.ready]);
      spans.length = 0;
      await from.run({
        label: "send",
        depends: { publish: sender.publish },
        run: ({ publish }) =>
          publish.run({ input: { subject: "trace", payload: new Uint8Array() } }),
      });
      await received.promise;
      await from.close({ graceful: true });
      await to.close({ graceful: true });
      const publish = spans.find((span) => span.name === "nats.publish")!;
      const send = spans.find((span) => span.name === "send")!;
      const delivery = spans.find((span) => span.name === "nats trace")!;
      expect(
        spans.map((span) => ({
          name: span.name,
          traceId: span.traceId,
          parent: span.parentSpanId,
          sampled: span.sampled,
        })),
      ).toEqual([
        { name: "nats.publish", traceId, parent: send.spanId, sampled },
        { name: "send", traceId, parent: parentSpanId, sampled },
        { name: "receive", traceId, parent: delivery.spanId, sampled },
        { name: "nats trace", traceId, parent: publish.spanId, sampled },
      ]);
    } finally {
      await from.close();
      await to.close();
    }
  },
);

test("a malformed or absent NATS traceparent starts a new trace without failing the message", async () => {
  const peer = await connect({ servers: server.url });
  const spans: Observe.Span[] = [];
  const receive = operation({
    label: "receive",
    run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => "ok",
  });
  const bus = nats([subscribe("bad-trace", receive)], { env: { NATS_URL: server.url } });
  const scope = createScope({
    extensions: bus.extension,
    observe: { export: (span) => spans.push(span) },
    trace: { traceId, parentSpanId },
  });
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
  try {
    await scope.ready;
    for (const traceparent of bad) {
      const carrier = headers();
      if (traceparent) carrier.set("traceparent", traceparent);
      peer.publish("bad-trace", new Uint8Array(), { headers: carrier });
    }
    await peer.flush();
    await expect
      .poll(() => spans.filter((span) => span.name === "nats bad-trace"))
      .toHaveLength(bad.length);
    const deliveries = spans.filter((span) => span.name === "nats bad-trace");
    expect(
      deliveries.map((span) => ({
        parent: span.parentSpanId,
        status: span.status,
        trace: span.traceId === traceId,
      })),
    ).toEqual(bad.map(() => ({ parent: undefined, status: "ok", trace: false })));
    expect(new Set(deliveries.map((span) => span.traceId)).size).toBe(bad.length);
  } finally {
    await scope.close({ graceful: true });
    await peer.close();
  }
});

test("a future NATS traceparent preserves its known ids and sampled bit", async () => {
  const peer = await connect({ servers: server.url });
  const spans: Observe.Span[] = [];
  const receive = operation({
    label: "receive",
    run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => "ok",
  });
  const bus = nats([subscribe("future-trace", receive)], { env: { NATS_URL: server.url } });
  const scope = createScope({
    extensions: bus.extension,
    observe: { export: (span) => spans.push(span) },
  });
  try {
    await scope.ready;
    const carrier = headers();
    carrier.set("traceparent", `01-${traceId}-${parentSpanId}-03-extra`);
    peer.publish("future-trace", new Uint8Array(), { headers: carrier });
    await peer.flush();
    await expect
      .poll(() => spans.find((span) => span.name === "nats future-trace"))
      .toMatchObject({ traceId, parentSpanId, sampled: true, status: "ok" });
  } finally {
    await scope.close({ graceful: true });
    await peer.close();
  }
});

test("publish with observation off sends only payload bytes and no headers", async () => {
  const peer = await connect({ servers: server.url });
  const received = Promise.withResolvers<Msg>();
  const sub = peer.subscribe("plain", {
    callback: (error, message) => (error ? received.reject(error) : received.resolve(message)),
  });
  const bus = nats([], { env: { NATS_URL: server.url }, connection: peer });
  const scope = createScope({ extensions: bus.extension });
  try {
    await scope.ready;
    await peer.flush();
    const before = peer.stats();
    const payload = new TextEncoder().encode("plain message");
    await scope.run(bus.publish, { input: { subject: "plain", payload } });
    const message = await received.promise;
    expect(message.headers).toBeUndefined();
    expect(peer.stats().outBytes - before.outBytes).toBe(payload.length);
  } finally {
    await scope.close();
    sub.unsubscribe();
    await peer.close();
  }
});
