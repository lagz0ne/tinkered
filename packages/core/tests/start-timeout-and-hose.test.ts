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
  let sleepSignal: AbortSignal | undefined;
  const scope = createScope({
    clock: {
      ...clock,
      sleep: (ms, signal) => {
        sleepSignal = signal;
        return clock.sleep(ms, signal);
      },
    },
    startTimeout: 1,
    extensions: [extension({ label: "done", hooks: { start: (event) => event.next() } })],
  });

  await scope.ready;
  clock.advance(10_000);
  await Promise.resolve();

  expect(sleepSignal?.aborted).toBe(true);
  expect(scope.run(operation({ label: "still-open", run: () => 42 }))).toBe(42);
  await scope.close();
});

test("one start tap receives a span and misses work before the tap", async () => {
  const spans: Observe.Span[] = [];
  const logs: string[] = [];
  const work = operation({ label: "work", run: () => 42 });
  const scope = createScope({
    extensions: [
      extension({
        label: "telemetry",
        hooks: {
          start(event) {
            event.run(work);
            event.log("before");
            event.tap({
              level: LEVELS.info,
              log: (line) => logs.push(line.message),
              export: (span) => {
                spans.push(span);
              },
            });
            event.log("after");
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
  expect(logs).toEqual(["after"]);
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

test("close cancels a hanging start and its timer with the close reason", async () => {
  const clock = makeTestClock();
  let sleepSignal: AbortSignal | undefined;
  let fired = false;
  const scope = createScope({
    clock: {
      ...clock,
      sleep: (ms, signal) => {
        sleepSignal = signal;
        return clock.sleep(ms, signal).then(() => {
          fired = true;
        });
      },
    },
    startTimeout: 25,
    extensions: [extension({ label: "hung", hooks: { start: () => new Promise<void>(() => {}) } })],
  });
  const ready = scope.ready.catch((error: unknown) => error);

  const closed = await scope.close({ graceful: true });
  const error = await ready;
  clock.advance(25);
  await Promise.resolve();

  expect(sleepSignal?.aborted).toBe(true);
  expect(error).toBe(sleepSignal?.reason);
  expect(closed).toEqual({ status: "success" });
  expect(fired).toBe(false);
});

test.each([0, Infinity])("startTimeout %s leaves the start timer off", async (startTimeout) => {
  const clock = makeTestClock();
  let sleeps = 0;
  let finish!: () => void;
  const start = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const scope = createScope({
    startTimeout,
    clock: {
      ...clock,
      sleep: (ms, signal) => {
        sleeps++;
        return clock.sleep(ms, signal);
      },
    },
    extensions: [extension({ label: "waiting", hooks: { start: () => start } })],
  });

  clock.advance(2 ** 31);
  finish();
  await scope.ready;
  const closed = await scope.close({ graceful: true });

  expect(sleeps).toBe(0);
  expect(closed).toEqual({ status: "success" });
});

test.each([-1, NaN])("startTimeout %s raises a managed error", (startTimeout) => {
  let error: unknown;

  try {
    createScope({ startTimeout });
  } catch (cause) {
    error = cause;
  }

  if (!isError(error, "BadStartTimeout")) throw error;
  expect(error.payload).toEqual({ timeout: startTimeout });
});

test("a finite start timeout is clamped to the largest timer delay", async () => {
  const clock = makeTestClock();
  const scope = createScope({
    clock,
    startTimeout: 2 ** 31,
    extensions: [extension({ label: "hung", hooks: { start: () => new Promise<void>(() => {}) } })],
  });
  const ready = scope.ready.catch((error: unknown) => error);

  clock.advance(2 ** 31 - 1);
  const error = await ready;

  if (!isError(error, "StartTimeout")) throw error;
  expect(error.payload).toEqual({ label: "hung" });
});

test("a recovered inner start leaves ready and close successful", async () => {
  const scope = createScope({
    extensions: [
      extension({
        label: "recover",
        hooks: {
          async start(event) {
            try {
              await event.next();
            } catch {
              return;
            }
          },
        },
      }),
      extension({ label: "fail", hooks: { start: () => Promise.reject(new Error("inner")) } }),
    ],
  });

  await scope.ready;
  const closed = await scope.close({ graceful: true });

  expect(closed).toEqual({ status: "success" });
});

test("a tap called after ready raises a managed error", async () => {
  let tap!: (config: Observe.Config) => void;
  let error: unknown;
  const scope = createScope({
    extensions: [
      extension({
        label: "telemetry",
        hooks: {
          start(event) {
            tap = event.tap;
            return event.next();
          },
        },
      }),
    ],
  });

  await scope.ready;
  try {
    tap({ history: 1 });
  } catch (cause) {
    error = cause;
  }
  await scope.close();

  if (!isError(error, "LateTap")) throw error;
  expect(error.payload).toEqual({});
});

test.each(["rejected", "thrown"])(
  "a %s clock sleep leaves startup waiting without a timeout",
  async (kind) => {
    const clock = makeTestClock();
    let finish!: () => void;
    let settled = false;
    const start = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const scope = createScope({
      clock: {
        ...clock,
        sleep: () => {
          const error = new Error("clock unavailable");
          if (kind === "thrown") throw error;
          return Promise.reject(error);
        },
      },
      extensions: [extension({ label: "waiting", hooks: { start: () => start } })],
    });
    const ready = scope.ready.then(() => {
      settled = true;
    });

    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    const pending = !settled;
    finish();
    await ready;
    const closed = await scope.close({ graceful: true });

    expect(pending).toBe(true);
    expect(closed).toEqual({ status: "success" });
  },
);

test("close wins while a completed start still has ready pending", async () => {
  const clock = makeTestClock();
  let sleepSignal: AbortSignal | undefined;
  let closingSignal!: AbortSignal;
  let release!: () => void;
  let settled = false;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scope = createScope({
    clock: {
      ...clock,
      sleep: (ms, signal) => {
        sleepSignal = signal;
        return clock.sleep(ms, signal);
      },
    },
    extensions: [
      extension({
        label: "completed",
        hooks: {
          start(event) {
            closingSignal = event.closing;
            event.defer(() => cleanup);
          },
        },
      }),
    ],
  });
  const ready = scope.ready.then(
    () => {
      settled = true;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );

  await Promise.resolve();
  const closing = scope.close({ graceful: true });
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  const pending = !settled;
  const aborted = sleepSignal?.aborted;
  release();
  await closing;
  const error = await ready;
  clock.advance(10_000);

  expect(pending).toBe(true);
  expect(aborted).toBe(true);
  expect(error).toBe(closingSignal.reason);
});

test("closed keeps a real start error after close has claimed startup", async () => {
  const clock = makeTestClock();
  const error = new Error("real start bug");
  let rejectStart!: (error: unknown) => void;
  let releaseCleanup!: () => void;
  let beginCleanup!: () => void;
  const start = new Promise<void>((_resolve, reject) => {
    rejectStart = reject;
  });
  const cleanup = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const cleaning = new Promise<void>((resolve) => {
    beginCleanup = resolve;
  });
  const scope = createScope({
    clock,
    signal: new AbortController().signal,
    extensions: [
      extension({
        label: "late-failure",
        hooks: {
          start(event) {
            event.defer(() => {
              beginCleanup();
              return cleanup;
            });
            return start;
          },
        },
      }),
    ],
  });

  const closing = scope.close({ graceful: true });
  await cleaning;
  rejectStart(error);
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  releaseCleanup();
  await closing;
  const closed = await scope.closed;

  if (closed.status !== "failed") throw closed;
  expect(closed.error).toBe(error);
  expect(closed.teardownErrors).toEqual([error]);
});

test("an explicit nested namespace chooses its own observation setting", async () => {
  const names: string[] = [];
  const quiet = namespace({ observe: false });
  const loud = namespace();
  const child = operation({ label: "child", run: () => 42 });
  const parent = operation({
    label: "parent",
    depends: { child },
    run: ({ child }) => child.run({ ns: loud }),
  });
  const scope = createScope({ observe: { export: (span) => names.push(span.name) } });

  const value = scope.run(parent, { ns: quiet });
  await scope.close();

  expect(value).toBe(42);
  expect(names).toEqual(["child"]);
});
