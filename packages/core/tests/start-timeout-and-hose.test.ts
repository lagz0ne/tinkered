import { makeTestClock } from "@tinker/core/testing";
import { expect, test } from "vite-plus/test";

import {
  createScope,
  extension,
  isError,
  LEVELS,
  namespace,
  operation,
  resource,
  type Observe,
} from "@/index";

test("a hanging inner start times out on the scope clock and closes with its label", async () => {
  const clock = makeTestClock();
  const cleanups: string[] = [];
  const hang = extension({
    label: "telemetry",
    hooks: {
      start(event) {
        event.defer(() => {
          cleanups.push("closed");
        });
        return new Promise<void>(() => {});
      },
    },
  });
  const scope = createScope({
    clock,
    signal: new AbortController().signal,
    startTimeout: 25,
    extensions: [extension({ label: "outer", hooks: { start: (event) => event.next() } }), hang],
  });
  const ready = scope.ready.catch((error: unknown) => error);

  clock.advance(24);
  expect(cleanups).toEqual([]);
  clock.advance(1);
  const error = await ready;

  if (!isError(error, "StartTimeout")) throw error;
  expect(error.payload).toEqual({ label: "telemetry" });
  expect(cleanups).toEqual(["closed"]);
  expect(await scope.closed).toEqual({ status: "failed", error });
});

test("start defaults to ten seconds and names an outer hook hanging after next", async () => {
  const clock = makeTestClock();
  let waiting = false;
  const scope = createScope({
    clock,
    signal: new AbortController().signal,
    extensions: [
      extension({
        label: "outer",
        hooks: {
          async start(event) {
            await event.next();
            waiting = true;
            await new Promise<void>(() => {});
          },
        },
      }),
      extension({ label: "inner", hooks: { start: (event) => event.next() } }),
    ],
  });
  const ready = scope.ready.catch((error: unknown) => error);

  await expect.poll(() => waiting).toBe(true);
  clock.advance(10_000);
  const error = await ready;

  if (!isError(error, "StartTimeout")) throw error;
  expect(error.payload).toEqual({ label: "outer" });
  expect(await scope.closed).toEqual({ status: "failed", error });
});

test("a settled start cancels its timeout", async () => {
  const clock = makeTestClock();
  const scope = createScope({
    clock,
    startTimeout: 1,
    extensions: [extension({ label: "done", hooks: { start: (event) => event.next() } })],
  });

  await scope.ready;
  clock.advance(10_000);
  await Promise.resolve();

  expect(scope.run(operation({ label: "still-open", run: () => 42 }))).toBe(42);
  await scope.close();
});

test("one start tap receives a span and misses work before the tap", async () => {
  const spans: Observe.Span[] = [];
  const work = operation({ label: "work", run: () => 42 });
  const scope = createScope({
    extensions: [
      extension({
        label: "telemetry",
        hooks: {
          start(event) {
            event.run(work);
            event.tap({
              export: (span) => {
                spans.push(span);
              },
            });
            return event.next();
          },
        },
      }),
    ],
  });

  await scope.ready;
  const value = scope.run(work);
  await scope.close();

  expect(value).toBe(42);
  expect(spans.map((span) => span.name)).toEqual(["work"]);
});

test("two taps receive the same span, filter their own levels, and keep the largest history", async () => {
  const first: Observe.Span[] = [];
  const second: Observe.Span[] = [];
  const info: Observe.Log[] = [];
  const debug: Observe.Log[] = [];
  const work = operation({
    label: "work",
    run: (_deps, ctx) => {
      ctx.log.debug("detail");
      ctx.log.info("body");
    },
  });
  const scope = createScope({
    observe: {
      export: (span) => {
        first.push(span);
      },
      history: 1,
      level: LEVELS.info,
      log: (line) => {
        info.push(line);
      },
    },
    extensions: [
      extension({
        label: "telemetry",
        hooks: {
          start(event) {
            const { log } = event;
            event.tap({
              export: (span) => {
                second.push(span);
              },
              history: 3,
              level: LEVELS.debug,
              log: (line) => {
                debug.push(line);
              },
            });
            log.debug("boot");
            return event.next();
          },
        },
      }),
    ],
  });

  await scope.ready;
  scope.run(work);
  scope.run(work);
  scope.run(work);
  scope.run(work);
  await scope.close();

  expect(first).toHaveLength(4);
  for (let i = 0; i < first.length; i++) expect(second[i]).toBe(first[i]);
  expect(scope.spans()).toEqual(first.slice(-3));
  expect(info.map((line) => line.message)).toEqual(["body", "body", "body", "body"]);
  expect(debug.map((line) => line.message)).toEqual([
    "boot",
    "detail",
    "body",
    "work",
    "detail",
    "body",
    "work",
    "detail",
    "body",
    "work",
    "detail",
    "body",
    "work",
  ]);
});

test("a throwing tap does not stop another tap", async () => {
  const spans: Observe.Span[] = [];
  const lines: Observe.Log[] = [];
  const scope = createScope({
    observe: {
      export: () => {
        throw new Error("sink");
      },
      log: () => {
        throw new Error("sink");
      },
    },
    extensions: [
      extension({
        label: "telemetry",
        hooks: {
          start(event) {
            event.tap({
              export: (span) => {
                spans.push(span);
              },
              log: (line) => {
                lines.push(line);
              },
            });
            return event.next();
          },
        },
      }),
    ],
  });
  const work = operation({ label: "work", run: () => 42 });

  await scope.ready;
  const value = scope.run(work);
  await scope.close();

  expect(value).toBe(42);
  expect(spans.map((span) => span.name)).toEqual(["work"]);
  expect(lines.map((line) => line.message)).toEqual(["work"]);
});

test("a quiet namespace emits no spans or logs from its work and hooks", async () => {
  const spans: Observe.Span[] = [];
  const lines: Observe.Log[] = [];
  const quiet = namespace({ observe: false });
  const client = resource({
    label: "client",
    target: "namespace",
    factory: (_deps, ctx) => {
      ctx.log("build");
      return 42;
    },
  });
  const nested = operation({
    label: "nested",
    run: (_deps, ctx) => {
      ctx.log("nested");
    },
  });
  const work = operation({
    label: "work",
    depends: { client, nested },
    run: async ({ client, nested }, ctx) => {
      await Promise.resolve();
      ctx.log("body");
      ctx.obs.child("send", () => ctx.log("send"));
      nested.run();
      return client;
    },
  });
  const scope = createScope({
    observe: {
      export: (span) => {
        spans.push(span);
      },
      log: (line) => {
        lines.push(line);
      },
      history: 10,
    },
    extensions: [
      extension({
        label: "hooks",
        hooks: {
          run(event) {
            event.log("hook");
            return event.next();
          },
        },
      }),
    ],
  });

  await scope.ready;
  const value = await scope.run(work, { ns: quiet });
  await scope.close();

  expect(value).toBe(42);
  expect(spans).toEqual([]);
  expect(lines).toEqual([]);
  expect(scope.spans()).toEqual([]);
});
