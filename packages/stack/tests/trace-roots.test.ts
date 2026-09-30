import {
  createScope,
  extension,
  isError,
  makeTestClock,
  operation,
  resource,
  tag,
  type Operation,
} from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { isError as isStackError, traceSink } from "../src/index.ts";
import { logs, Receiver, spans } from "./otlp-fixture.ts";

const work = operation({
  label: "work",
  run: (_deps, ctx: Operation.Ctx<string>) => ctx.log(ctx.input),
});
const owned = resource({
  label: "owned",
  factory: (_deps, ctx) => {
    ctx.defer(() => ctx.obs.child("last span", () => ctx.log("last line")));
    return "open";
  },
});
const required = tag<string>({ label: "required setting" });
const broken = extension({
  label: "broken setup",
  hooks: { start: (event) => event.resolve(required.required) },
});

test("one tracing definition keeps two collectors and writers apart when one root closes", async () => {
  const tracing = traceSink();
  const collectorA = await new Receiver().listen();
  const collectorB = await new Receiver().listen();
  const linesA: string[] = [];
  const linesB: string[] = [];
  const clockB = makeTestClock();
  const stopA = new AbortController();
  const stopB = new AbortController();
  const telemetryA = createScope({
    signal: stopA.signal,
    clock: makeTestClock(),
    extensions: [tracing],
    tags: tracing.config({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collectorA.url, OTEL_SERVICE_NAME: "service A" },
      write: (line) => linesA.push(line),
    }),
  });
  const telemetryB = createScope({
    signal: stopB.signal,
    extensions: [tracing],
    clock: clockB,
    tags: tracing.config({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collectorB.url, OTEL_SERVICE_NAME: "service B" },
      write: (line) => linesB.push(line),
    }),
  });
  try {
    await Promise.all([telemetryA.ready, telemetryB.ready]);
    const appA = createScope({ observe: telemetryA.resolve(tracing) });
    const appB = createScope({ observe: telemetryB.resolve(tracing) });
    try {
      appA.run(work, { input: "A" });
      appB.run(work, { input: "B before" });
      await appA.close({ graceful: true });
      stopA.abort();
      await telemetryA.closed;
      appB.run(work, { input: "B after" });
      clockB.advance(1000);
      await expect
        .poll(() =>
          logs(collectorB.state.packets)
            .filter((line) => line.severityNumber === 9)
            .map((line) => line.body.stringValue),
        )
        .toEqual(["B before", "B after"]);
      await appB.close({ graceful: true });
      stopB.abort();
      await telemetryB.closed;
      expect(
        logs(collectorA.state.packets)
          .filter((line) => line.severityNumber === 9)
          .map((line) => line.body.stringValue),
      ).toEqual(["A"]);
      expect(
        linesA
          .map((line) => JSON.parse(line))
          .filter((line) => line.level === 30)
          .map((line) => line.message),
      ).toEqual(["A"]);
      expect(
        linesB
          .map((line) => JSON.parse(line))
          .filter((line) => line.level === 30)
          .map((line) => line.message),
      ).toEqual(["B before", "B after"]);
      expect(
        [collectorA, collectorB].map((collector) =>
          collector.state.packets.flatMap(
            ({ body }) => body.resourceSpans?.map(({ resource }) => resource.attributes) ?? [],
          ),
        ),
      ).toEqual([
        [[{ key: "service.name", value: { stringValue: "service A" } }]],
        [[{ key: "service.name", value: { stringValue: "service B" } }]],
      ]);
    } finally {
      await Promise.all([appA.close(), appB.close()]);
    }
  } finally {
    stopA.abort();
    stopB.abort();
    await Promise.all([telemetryA.closed, telemetryB.closed]);
    await Promise.all([collectorA.close(), collectorB.close()]);
  }
});

test("closing the app before telemetry exports its last cleanup span and log", async () => {
  const tracing = traceSink();
  const collector = await new Receiver().listen();
  const telemetryStop = new AbortController();
  const telemetry = createScope({
    signal: telemetryStop.signal,
    clock: makeTestClock(),
    extensions: [tracing],
    tags: tracing.config({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "app" },
      write: () => {},
    }),
  });
  try {
    await telemetry.ready;
    const appStop = new AbortController();
    const app = createScope({ signal: appStop.signal, observe: telemetry.resolve(tracing) });
    app.resolve(owned);
    appStop.abort();
    await app.closed;
    telemetryStop.abort();
    await telemetry.closed;
    expect(spans(collector.state.packets).map((span) => span.name)).toEqual(["owned", "last span"]);
    expect(
      logs(collector.state.packets)
        .filter((line) => line.severityNumber === 9)
        .map((line) => line.body.stringValue),
    ).toEqual(["last line"]);
  } finally {
    telemetryStop.abort();
    await telemetry.closed;
    await collector.close();
  }
});

test("failed telemetry setup cleans its root and leaves the other queue running", async () => {
  const tracing = traceSink();
  const collector = await new Receiver().listen();
  const stop = new AbortController();
  const telemetry = createScope({
    signal: stop.signal,
    extensions: [tracing],
    tags: tracing.config({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "live" },
      write: () => {},
    }),
  });
  try {
    await telemetry.ready;
    const failed = createScope({
      signal: new AbortController().signal,
      extensions: [tracing, broken],
      tags: tracing.config({
        env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "failed" },
        write: () => {},
      }),
    });
    try {
      await failed.ready;
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "MissingTag")) throw error;
    }
    expect((await failed.closed).status).toBe("failed");
    const app = createScope({ observe: telemetry.resolve(tracing) });
    try {
      app.run(work, { input: "still live" });
    } finally {
      await app.close({ graceful: true });
    }
    stop.abort();
    await telemetry.closed;
    expect(
      logs(collector.state.packets)
        .filter((line) => line.severityNumber === 9)
        .map((line) => line.body.stringValue),
    ).toEqual(["still live"]);
  } finally {
    stop.abort();
    await telemetry.closed;
    await collector.close();
  }
});

test.each(["missing", "invalid"])(
  "telemetry with %s config rejects ready and settles closed with the same failure",
  async (config) => {
    const tracing = traceSink();
    const telemetry = createScope({
      signal: new AbortController().signal,
      extensions: [tracing],
      tags:
        config === "missing"
          ? undefined
          : tracing.config({
              env: { OTEL_EXPORTER_OTLP_ENDPOINT: "file:///tmp/collector", OTEL_SERVICE_NAME: " " },
              write: () => {},
            }),
    });
    const failure = await telemetry.ready.then(
      () => expect.unreachable(),
      (error: unknown) => error,
    );
    if (config === "missing") {
      if (!isError(failure, "MissingTag")) throw failure;
    } else {
      if (!isStackError(failure, "BadTraceSettings")) throw failure;
      expect(failure.payload.keys).toEqual(["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_SERVICE_NAME"]);
    }
    let status = "pending";
    const closing = telemetry.closed.then((result) => {
      status = result.status;
      return result;
    });
    await expect.poll(() => status).toBe("failed");
    const result = await closing;
    if (result.status !== "failed") expect.unreachable();
    expect(result.error).toBe(failure);
  },
);

test.each([false, true])(
  "forced telemetry close cancels export without cleanup errors (in flight: %s)",
  async (inFlight) => {
    const tracing = traceSink();
    const collector = await new Receiver().listen();
    collector.state.hang = true;
    const clock = makeTestClock();
    const telemetry = createScope({
      extensions: [tracing],
      clock,
      tags: tracing.config({
        env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "forced" },
        write: () => {},
      }),
    });
    try {
      await telemetry.ready;
      const app = createScope({ observe: telemetry.resolve(tracing) });
      try {
        app.run(work, { input: "drop" });
        if (inFlight) {
          clock.advance(1000);
          await expect.poll(() => collector.state.packets.length).toBe(2);
          app.run(work, { input: "queued" });
        }
      } finally {
        await app.close({ graceful: true });
      }
      if (!inFlight) clock.advance(1000);
      expect(await telemetry.close()).toMatchObject({
        status: "cancelled",
        teardownErrors: undefined,
      });
      expect(collector.state.packets).toHaveLength(inFlight ? 2 : 0);
    } finally {
      await telemetry.close();
      await collector.close();
    }
  },
);
