import { createScope, operation, resource } from "@tinker/core";
import { makeTestClock } from "@tinker/core/testing";
import { emit, hono, route, stream } from "@tinker/hono";
import { expect, test } from "vite-plus/test";
import { traceSink } from "../src/index.ts";
import { logs, Receiver, spans } from "./otlp-fixture.ts";

const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const parentSpanId = "00f067aa0ba902b7";

test("one request exports one trace with its remote parent, span fields, and service", async () => {
  const collector = await new Receiver().listen();
  const clock = makeTestClock({ now: 1_700_000_000_123 });
  const sink = traceSink({
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: `${collector.url}/otel/`,
      OTEL_SERVICE_NAME: "test-service",
    },
    write: () => {},
  });
  const child = operation({
    label: "child",
    run: (_deps, ctx) => {
      ctx.obs.event("saved", { ok: true });
      ctx.obs.span!.attributes.count = 3;
      ctx.obs.child("manual", () => clock.advance(2));
      return "ok";
    },
  });
  const saved = resource({ label: "store", target: "session", factory: () => "db" });
  const root = operation({
    label: "root",
    depends: { child, saved },
    run: ({ child, saved }) => `${saved}:${child.run()}`,
  });
  const web = hono([route.get("/", root)]).extension;
  const scope = createScope({ extensions: [sink.extension, web], observe: sink.observe, clock });
  try {
    await scope.ready;
    const answer = await scope
      .resolve(web)
      .request("/", { headers: { traceparent: `00-${traceId}-${parentSpanId}-00` } });
    expect(await answer.json()).toBe("db:ok");
    expect(await scope.close({ graceful: true })).toEqual({ status: "success" });
    const exported = spans(collector.state.packets);
    const server = exported.find((span) => span.name === "GET /")!;
    const rootSpan = exported.find((span) => span.name === "root")!;
    const childSpan = exported.find((span) => span.name === "child")!;
    expect(
      exported.map((span) => ({
        name: span.name,
        traceId: span.traceId,
        parent: span.parentSpanId,
        flags: span.flags,
      })),
    ).toEqual([
      { name: "store", traceId, parent: rootSpan.spanId, flags: 0 },
      { name: "manual", traceId, parent: childSpan.spanId, flags: 0 },
      { name: "child", traceId, parent: rootSpan.spanId, flags: 0 },
      { name: "root", traceId, parent: server.spanId, flags: 0 },
      { name: "GET /", traceId, parent: parentSpanId, flags: 0 },
    ]);
    expect(childSpan).toMatchObject({
      kind: 1,
      startTimeUnixNano: "1700000000123000000",
      endTimeUnixNano: "1700000000125000000",
      attributes: [
        { key: "count", value: { intValue: "3" } },
        { key: "tinker.kind", value: { stringValue: "operation" } },
      ],
      events: [
        {
          name: "saved",
          timeUnixNano: "1700000000123000000",
          attributes: [{ key: "ok", value: { boolValue: true } }],
        },
      ],
    });
    expect(childSpan).not.toHaveProperty("status");
    expect(
      collector.state.packets.find((packet) => packet.path === "/otel/v1/traces"),
    ).toMatchObject({
      type: "application/json",
      body: {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: "service.name", value: { stringValue: "test-service" } }],
            },
            scopeSpans: [{ scope: { name: "@tinker/stack" } }],
          },
        ],
      },
    });
  } finally {
    await scope.close();
    await collector.close();
  }
});

test("log lines carry their span ids, mapped severity, time, and attributes", async () => {
  const collector = await new Receiver().listen();
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "logs" },
    write: () => {},
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: sink.observe,
    clock: makeTestClock({ now: 123 }),
  });
  try {
    await scope.ready;
    scope.run({
      label: "logging",
      run: (_deps, ctx) => {
        ctx.log.debug("debug");
        ctx.log.info("info");
        ctx.log.warn("warn");
        ctx.log.error("error", { nested: { a: 1 }, missing: undefined });
      },
    });
    await scope.close({ graceful: true });
    const span = spans(collector.state.packets).find((span) => span.name === "logging")!;
    expect(
      logs(collector.state.packets).filter((line) => line.body.stringValue !== "logging"),
    ).toEqual([
      ...[
        { message: "debug", severity: 5 },
        { message: "info", severity: 9 },
        { message: "warn", severity: 13 },
      ].map(({ message, severity }) => ({
        traceId: span.traceId,
        spanId: span.spanId,
        flags: 1,
        timeUnixNano: "123000000",
        severityNumber: severity,
        body: { stringValue: message },
        attributes: [],
      })),
      {
        traceId: span.traceId,
        spanId: span.spanId,
        flags: 1,
        timeUnixNano: "123000000",
        severityNumber: 17,
        body: { stringValue: "error" },
        attributes: [
          { key: "nested", value: { stringValue: '{"a":1}' } },
          { key: "missing", value: { stringValue: "undefined" } },
        ],
      },
    ]);
    expect(
      collector.state.packets.find((packet) => packet.path === "/v1/logs")?.body.resourceLogs?.[0],
    ).toMatchObject({
      resource: { attributes: [{ key: "service.name", value: { stringValue: "logs" } }] },
      scopeLogs: [{ scope: { name: "@tinker/stack" } }],
    });
  } finally {
    await scope.close();
    await collector.close();
  }
});

test("the timer exports finished spans while a stream is still open", async () => {
  const collector = await new Receiver().listen();
  const clock = makeTestClock();
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "stream" },
    write: () => {},
  });
  const release = Promise.withResolvers<void>();
  const chunk = operation({ label: "chunk", run: () => "first" });
  const body = operation({
    label: "body",
    depends: { emit: emit.required, chunk },
    run: async ({ emit, chunk }) => {
      emit(chunk.run());
      await release.promise;
    },
  });
  const web = hono([
    route.get("/", operation({ label: "open", run: () => undefined }), {
      respond: (_, c) => stream(c, body),
    }),
  ]).extension;
  const scope = createScope({ extensions: [sink.extension, web], observe: sink.observe, clock });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    clock.advance(1000);
    await expect
      .poll(() => spans(collector.state.packets).map((span) => span.name))
      .toContain("chunk");
    expect(spans(collector.state.packets).map((span) => span.name)).not.toContain("body");
    release.resolve();
    await reader.read();
    await scope.close({ graceful: true });
    expect(spans(collector.state.packets).map((span) => span.name)).toContain("body");
  } finally {
    release.resolve();
    await scope.close();
    await collector.close();
  }
});

test("graceful close exports queued spans, failed status, and cleanup logs", async () => {
  const collector = await new Receiver().listen();
  const lines: string[] = [];
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "close" },
    write: (line) => lines.push(line),
  });
  const owned = resource({
    label: "owned",
    factory: (_deps, ctx) => {
      ctx.defer(() => ctx.log("cleanup"));
      return 1;
    },
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: sink.observe,
    clock: makeTestClock(),
  });
  try {
    await scope.ready;
    const failed = scope.settle({
      label: "fails",
      depends: { owned },
      run: ({ owned }) => {
        throw new Error(String(owned));
      },
    });
    await scope.close({ graceful: true });
    if (failed.status !== "failed") return expect.unreachable();
    expect(spans(collector.state.packets).find((span) => span.name === "fails")?.status).toEqual({
      code: 2,
      message: "1",
    });
    expect(
      lines.map((line) => JSON.parse(line)).filter((line) => line.kind === "span"),
    ).toMatchObject([{ name: "fails", status: "failed" }]);
    expect(
      logs(collector.state.packets).find((line) => line.body.stringValue === "cleanup"),
    ).toMatchObject({ traceId: expect.any(String), spanId: expect.any(String) });
  } finally {
    await scope.close();
    await collector.close();
  }
});

test("OTLP reads span and log attributes only when the batch flushes", async () => {
  const collector = await new Receiver().listen();
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "deferred" },
    write: () => {},
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: sink.observe,
    clock: makeTestClock(),
  });
  let phase = "request";
  const reads: string[] = [];
  const attribute = {
    toJSON: () => {
      reads.push(phase);
      return phase;
    },
  };
  try {
    await scope.ready;
    scope.run({
      label: "deferred",
      run: (_deps, ctx) => {
        ctx.obs.span!.attributes.value = attribute;
        ctx.log("deferred log", { value: attribute });
      },
    });
    expect(reads).toEqual(["request"]);
    phase = "flush";
    await scope.close({ graceful: true });
    expect(spans(collector.state.packets)[0].attributes[0]).toEqual({
      key: "value",
      value: { stringValue: '"flush"' },
    });
    expect(
      logs(collector.state.packets).find((line) => line.body.stringValue === "deferred log")
        ?.attributes,
    ).toEqual([{ key: "value", value: { stringValue: '"flush"' } }]);
  } finally {
    await scope.close();
    await collector.close();
  }
});

test("bigint and safe integer attributes arrive as decimal integers without losing the span", async () => {
  const collector = await new Receiver().listen();
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "numbers" },
    write: () => {},
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: sink.observe,
    clock: makeTestClock(),
  });
  try {
    await scope.ready;
    scope.run({
      label: "numbers",
      run: (_deps, ctx) => {
        Object.assign(ctx.obs.span!.attributes, {
          big: 10n,
          status: 200,
          negative: -3,
          max: Number.MAX_SAFE_INTEGER,
          fraction: 1.5,
          unsafe: Number.MAX_SAFE_INTEGER + 1,
        });
      },
    });
    await scope.close({ graceful: true });
    expect(spans(collector.state.packets).map((span) => span.attributes)).toEqual([
      [
        { key: "big", value: { intValue: "10" } },
        { key: "status", value: { intValue: "200" } },
        { key: "negative", value: { intValue: "-3" } },
        { key: "max", value: { intValue: "9007199254740991" } },
        { key: "fraction", value: { doubleValue: 1.5 } },
        { key: "unsafe", value: { doubleValue: 9007199254740992 } },
        { key: "tinker.kind", value: { stringValue: "operation" } },
      ],
    ]);
  } finally {
    await scope.close();
    await collector.close();
  }
});

test("a failed span keeps a thrown value as its status message", async () => {
  const collector = await new Receiver().listen();
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "status" },
    write: () => {},
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: sink.observe,
    clock: makeTestClock(),
  });
  try {
    await scope.ready;
    expect(
      scope.settle({
        label: "string failure",
        run: () => {
          throw "broken";
        },
      }).status,
    ).toBe("failed");
    await scope.close({ graceful: true });
    expect(spans(collector.state.packets)[0].status).toEqual({ code: 2, message: "broken" });
  } finally {
    await scope.close();
    await collector.close();
  }
});
