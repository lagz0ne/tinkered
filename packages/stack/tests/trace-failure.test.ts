import { createScope, extension, makeTestClock, operation, resource } from "@tinker/core";
import { hono, route } from "@tinker/hono";
import { expect, test } from "vite-plus/test";
import { isError, traceSink, type TraceSink } from "../src/index.ts";
import { Receiver, spans } from "./otlp-fixture.ts";

const ping = operation({ label: "ping", run: () => "pong" });
const cleanupLog = resource({
  label: "cleanup log",
  factory: (_deps, ctx) => {
    ctx.defer(() => ctx.log("cleanup"));
  },
});

test.each<TraceSink.Env>([
  {},
  { OTEL_EXPORTER_OTLP_ENDPOINT: "file:///tmp/collector", OTEL_SERVICE_NAME: " " },
])("missing or bad OTLP settings stop boot and name every key (%j)", async (env) => {
  let started = false;
  const sink = traceSink({ env, write: () => {} });
  const scope = createScope({
    extensions: [
      sink.extension,
      extension({
        label: "later",
        start: () => {
          started = true;
        },
      }),
    ],
    observe: sink.observe,
  });
  try {
    await scope.ready;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "BadTraceSettings")) throw error;
    expect(error.payload.keys).toEqual(["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_SERVICE_NAME"]);
    expect(started).toBe(false);
  } finally {
    await scope.close();
  }
});

test.each([
  "",
  "bad",
  "ftp://localhost",
  "https://u:p@localhost",
  "https://localhost?x=1",
  "https://localhost/#x",
])("a bad OTLP endpoint fails boot naming only its key (%s)", async (endpoint) => {
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_SERVICE_NAME: "valid" },
    write: () => {},
  });
  const scope = createScope({ extensions: sink.extension });
  try {
    await scope.ready;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "BadTraceSettings")) throw error;
    expect(error.payload.keys).toEqual(["OTEL_EXPORTER_OTLP_ENDPOINT"]);
  } finally {
    await scope.close();
  }
});

test("a missing service name fails boot naming only its key", async () => {
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example" },
    write: () => {},
  });
  const scope = createScope({ extensions: sink.extension });
  try {
    await scope.ready;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "BadTraceSettings")) throw error;
    expect(error.payload.keys).toEqual(["OTEL_SERVICE_NAME"]);
  } finally {
    await scope.close();
  }
});

test.each(["down", "500", "slow", "partial"])(
  "a %s collector keeps requests and close working and logs once per burst",
  async (failure) => {
    const collector = await new Receiver().listen();
    collector.state.status = 500;
    if (failure === "partial") collector.state.statusByPath["/v1/traces"] = 200;
    collector.state.hang = failure === "slow";
    if (failure === "down") await collector.close();
    const lines: string[] = [];
    const clock = makeTestClock();
    const sink = traceSink({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "fails" },
      write: (line) => lines.push(line),
    });
    const web = hono([route.get("/", ping)]).extension;
    const scope = createScope({ extensions: [sink.extension, web], observe: sink.observe, clock });
    try {
      await scope.ready;
      expect(await (await scope.resolve(web).request("/")).json()).toBe("pong");
      clock.advance(1000);
      await expect
        .poll(() => lines.filter((line) => line.includes("OTLP records dropped")), {
          timeout: 3000,
        })
        .toHaveLength(1);
      expect(await (await scope.resolve(web).request("/")).json()).toBe("pong");
      expect(await scope.close({ graceful: true })).toEqual({ status: "success" });
      expect(
        lines
          .map((line) => JSON.parse(line))
          .filter((line) => line.message === "OTLP records dropped"),
      ).toEqual([
        {
          kind: "log",
          time: 1000,
          level: 40,
          message: "OTLP records dropped",
          reason: "collector unavailable",
        },
      ]);
    } finally {
      await scope.close();
      await collector.close();
    }
  },
);

test("a recovered collector ends a failure burst so a later fault logs again", async () => {
  const collector = await new Receiver().listen();
  collector.state.status = 500;
  const lines: string[] = [];
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "recovery" },
    write: (line) => lines.push(line),
  });
  const scope = createScope({ extensions: sink.extension, observe: sink.observe });
  try {
    await scope.ready;
    scope.run(ping);
    await expect
      .poll(() => lines.filter((line) => line.includes("OTLP records dropped")), { timeout: 4000 })
      .toHaveLength(1);
    collector.state.status = 200;
    scope.run({ label: "recovered", run: () => "ok" });
    await expect
      .poll(() => spans(collector.state.packets).some((span) => span.name === "recovered"), {
        timeout: 4000,
      })
      .toBe(true);
    collector.state.status = 500;
    scope.run(ping);
    await scope.close({ graceful: true });
    expect(lines.filter((line) => line.includes("OTLP records dropped"))).toHaveLength(2);
  } finally {
    await scope.close();
    await collector.close();
  }
});

test.each([
  { padding: "", count: 2050, kept: 2048, oversized: false },
  { padding: "x".repeat(350_000), count: 3, kept: 2, oversized: true },
])(
  "the queue bounds record count and bytes and drops new records with one local warning (%#)",
  async ({ padding, count, kept, oversized }) => {
    const collector = await new Receiver().listen();
    const lines: string[] = [];
    const sink = traceSink({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "bounded" },
      write: (line) => lines.push(line),
    });
    const scope = createScope({
      extensions: sink.extension,
      observe: { ...sink.observe, log: undefined },
      clock: makeTestClock(),
    });
    try {
      await scope.ready;
      if (oversized)
        scope.run({
          label: "oversized",
          run: (_deps, ctx) => {
            ctx.obs.span!.attributes.large = "界".repeat(400_000);
          },
        });
      const queued = operation({
        label: "queued",
        run: (_deps, ctx) => {
          ctx.obs.span!.attributes.padding = padding;
        },
      });
      for (let i = 0; i < count; i++) scope.run(queued);
      expect(await scope.close({ graceful: true })).toEqual({ status: "success" });
      expect(spans(collector.state.packets).map((span) => span.name)).toEqual(
        Array.from({ length: kept }, () => "queued"),
      );
      expect(lines.map((line) => JSON.parse(line))).toEqual([
        { kind: "log", time: 0, level: 40, message: "OTLP records dropped", reason: "queue full" },
      ]);
    } finally {
      await scope.close();
      await collector.close();
    }
  },
);

test("a broken local writer does not stop export", async () => {
  const collector = await new Receiver().listen();
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "writer" },
    write: () => {
      throw new Error("disk full");
    },
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: sink.observe,
    clock: makeTestClock(),
  });
  try {
    await scope.ready;
    expect(scope.run(ping)).toBe("pong");
    expect(await scope.close({ graceful: true })).toEqual({ status: "success" });
    expect(spans(collector.state.packets).map((span) => span.name)).toEqual(["ping"]);
  } finally {
    await scope.close();
    await collector.close();
  }
});

test("an unencodable record warns locally and leaves later spans exportable", async () => {
  const collector = await new Receiver().listen();
  const lines: string[] = [];
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "encoding" },
    write: (line) => lines.push(line),
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: sink.observe,
    clock: makeTestClock(),
  });
  try {
    await scope.ready;
    scope.run({
      label: "cyclic",
      run: (_deps, ctx) => {
        ctx.obs.span!.attributes.self = ctx.obs.span!.attributes;
      },
    });
    expect(scope.run(ping)).toBe("pong");
    expect(await scope.close({ graceful: true })).toEqual({ status: "success" });
    expect(spans(collector.state.packets).map((span) => span.name)).toEqual(["ping"]);
    expect(
      lines
        .map((line) => JSON.parse(line))
        .filter((line) => line.message === "OTLP records dropped"),
    ).toEqual([
      {
        kind: "log",
        time: 0,
        level: 40,
        message: "OTLP records dropped",
        reason: "record could not be encoded",
      },
    ]);
  } finally {
    await scope.close();
    await collector.close();
  }
});

test("forced close keeps cleanup logs local and warns that their export was dropped", async () => {
  const collector = await new Receiver().listen();
  const lines: string[] = [];
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "cleanup" },
    write: (line) => lines.push(line),
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: { ...sink.observe, export: undefined },
    clock: makeTestClock(),
  });
  try {
    await scope.ready;
    scope.resolve(cleanupLog);
    await scope.close();
    expect(
      lines.map((line) => JSON.parse(line)).map(({ message, reason }) => ({ message, reason })),
    ).toEqual([
      { message: "cleanup", reason: undefined },
      { message: "OTLP records dropped", reason: "scope closed" },
    ]);
    expect(collector.state.packets).toEqual([]);
  } finally {
    await scope.close();
    await collector.close();
  }
});

test.each([202, 204])("a collector response of %i delivers the batch", async (status) => {
  const collector = await new Receiver().listen();
  collector.state.status = status;
  const lines: string[] = [];
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "accepted" },
    write: (line) => lines.push(line),
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: sink.observe,
    clock: makeTestClock(),
  });
  try {
    await scope.ready;
    scope.run(ping);
    await scope.close({ graceful: true });
    expect(spans(collector.state.packets).map((span) => span.name)).toEqual(["ping"]);
    expect(lines.filter((line) => line.includes("OTLP records dropped"))).toEqual([]);
  } finally {
    await scope.close();
    await collector.close();
  }
});

test.each([false, true])(
  "forced close drops queued records and makes no new request (in flight: %s)",
  async (inFlight) => {
    const collector = await new Receiver().listen();
    collector.state.hang = true;
    const lines: string[] = [];
    const clock = makeTestClock();
    const sink = traceSink({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "forced" },
      write: (line) => lines.push(line),
    });
    const scope = createScope({
      extensions: sink.extension,
      observe: { ...sink.observe, log: undefined },
      clock,
    });
    try {
      await scope.ready;
      scope.run(ping);
      if (inFlight) {
        clock.advance(1000);
        await expect.poll(() => collector.state.packets.length).toBe(1);
        scope.run(ping);
      }
      expect(await scope.close()).toMatchObject({ status: "cancelled", teardownErrors: undefined });
      expect(collector.state.packets).toHaveLength(inFlight ? 1 : 0);
      expect(lines.filter((line) => line.includes("OTLP records dropped"))).toHaveLength(1);
    } finally {
      await scope.close();
      await collector.close();
    }
  },
);

test("graceful close shares one deadline between an in-flight batch and the final batch", async () => {
  const collector = await new Receiver().listen();
  collector.state.hang = true;
  const clock = makeTestClock();
  const lines: string[] = [];
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "deadline" },
    write: (line) => lines.push(line),
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: { ...sink.observe, log: undefined },
    clock,
  });
  try {
    await scope.ready;
    scope.run(ping);
    clock.advance(1000);
    await expect.poll(() => collector.state.packets.length).toBe(1);
    scope.run(ping);
    const closing = scope.close({ graceful: true });
    clock.advance(1000);
    expect(await closing).toEqual({ status: "success" });
    expect(collector.state.packets).toHaveLength(1);
    expect(lines.filter((line) => line.includes("OTLP records dropped"))).toHaveLength(1);
  } finally {
    await scope.close();
    await collector.close();
  }
});

test("a full queue drops a new record without encoding it", async () => {
  const collector = await new Receiver().listen();
  const sink = traceSink({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, OTEL_SERVICE_NAME: "full" },
    write: () => {},
  });
  const scope = createScope({
    extensions: sink.extension,
    observe: { ...sink.observe, log: undefined },
    clock: makeTestClock(),
  });
  let encoded = false;
  try {
    await scope.ready;
    for (let i = 0; i < 2048; i++) scope.run(ping);
    scope.run({
      label: "dropped",
      run: (_deps, ctx) => {
        ctx.obs.span!.attributes.value = {
          toJSON: () => {
            encoded = true;
            return "dropped";
          },
        };
      },
    });
    await scope.close({ graceful: true });
    expect(encoded).toBe(false);
    expect(spans(collector.state.packets)).toHaveLength(2048);
  } finally {
    await scope.close();
    await collector.close();
  }
});
