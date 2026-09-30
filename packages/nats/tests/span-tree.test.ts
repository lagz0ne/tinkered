import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { createScope, operation, type Operation, type Observe } from "@tinker/core";
import { startNatsServer, type NatsServer } from "@tinker/nats/testing";
import { nats, subscribe, type Nats } from "../src/index.ts";

let server: NatsServer.Handle;
beforeAll(async () => {
  server = await startNatsServer();
});
afterAll(async () => {
  await server.close();
});

test("the graph names connection setup and traces publish and the subscription operation", async () => {
  const spans: Observe.Span[] = [];
  const receive = operation({
    label: "receive",
    run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => undefined,
  });
  const bus = nats([subscribe("trace", receive)], { env: { NATS_URL: server.url } });
  const scope = createScope({
    extensions: [bus.extension],
    observe: { export: (span) => spans.push(span) },
  });
  try {
    await scope.ready;
    expect(spans.map((span) => span.name).toSorted()).toEqual([
      "nats.connection",
      "nats.driver",
      "nats.settings",
    ]);
    spans.length = 0;
    const send = operation({
      label: "send",
      depends: { publish: bus.publish },
      run: ({ publish }) => publish.run({ input: { subject: "trace", payload: new Uint8Array() } }),
    });
    void scope.run(send);
    await expect.poll(() => spans.length).toBe(4);
    expect(
      spans.map((span) => ({
        name: span.name,
        parent: spans.find((parent) => parent.id === span.parentId)?.name,
      })),
    ).toEqual([
      { name: "nats.publish", parent: "send" },
      { name: "send", parent: undefined },
      { name: "receive", parent: "nats trace" },
      { name: "nats trace", parent: undefined },
    ]);
  } finally {
    await scope.close({ graceful: true });
  }
});
