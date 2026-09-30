import { getEventListeners } from "node:events";
import { expect, expectTypeOf, test } from "vite-plus/test";
import { createScope, data, extension, operation, type Scope } from "../src/index.ts";

const count = data({ label: "count", initial: 0 });

function gate() {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("a rejected start rejects ready only after its forced cleanup ends", async () => {
  const cleanupStarted = gate();
  const cleanup = gate();
  const events: string[] = [];
  const error = new Error("start failed");
  const piece = extension({
    label: "failed-start",
    start: (_scope, ctx) => {
      ctx.defer(async () => {
        cleanupStarted.release();
        await cleanup.promise;
        events.push("cleanup");
      });
      throw error;
    },
  });
  const scope = createScope({ extensions: [piece] });
  const ready = scope.ready.catch((cause: unknown) => {
    events.push("ready");
    return cause;
  });
  await cleanupStarted.promise;
  cleanup.release();
  expect(await ready).toBe(error);
  expect(events).toEqual(["cleanup", "ready"]);
});

test("a rejected start runs every close hook through the current handle", async () => {
  const events: string[] = [];
  const error = new Error("start failed");
  const first = extension({
    label: "first",
    start: (scope, _ctx, next) => {
      const close = scope.close.bind(scope);
      scope.close = async (options) => {
        events.push("handle:before");
        const ended = await close(options);
        events.push("handle:after");
        return ended;
      };
      return next();
    },
    close: async (_options, next) => {
      events.push("first:before");
      const ended = await next();
      events.push("first:after");
      return ended;
    },
  });
  const second = extension({
    label: "second",
    start: () => {
      throw error;
    },
    close: async (_options, next) => {
      events.push("second:before");
      const ended = await next();
      events.push("second:after");
      return ended;
    },
  });
  const scope = createScope({ extensions: [first, second] });
  await expect(scope.ready).rejects.toBe(error);
  expect(events).toEqual([
    "handle:before",
    "first:before",
    "second:before",
    "second:after",
    "first:after",
    "handle:after",
  ]);
});

test("a start that fails during close joins the hooks already running", async () => {
  const start = gate();
  const closing = gate();
  const cleanup = gate();
  const events: string[] = [];
  const error = new Error("late start failure");
  const piece = extension({
    label: "overlap",
    start: async () => {
      await start.promise;
      throw error;
    },
    close: async (_options, next) => {
      events.push("close:before");
      closing.release();
      await cleanup.promise;
      const ended = await next();
      events.push("close:after");
      return ended;
    },
  });
  const scope = createScope({ extensions: [piece] });
  const ready = scope.ready.catch((cause: unknown) => {
    events.push("ready");
    return cause;
  });
  const ended = scope.close();
  await closing.promise;
  start.release();
  expect(await Promise.race([ready, Promise.resolve("pending")])).toBe("pending");
  cleanup.release();
  expect(await ready).toBe(error);
  expect((await ended).status).toBe("failed");
  expect(events).toEqual(["close:before", "close:after", "ready"]);
});

test("closed reports the start error after cleanup even when a stop was requested", async () => {
  const stop = new AbortController();
  const cleanupStarted = gate();
  const cleanup = gate();
  const error = new Error("start failed");
  const closes: Scope.CloseOptions[] = [];
  const piece = extension({
    label: "failed-start",
    start: (_scope, ctx) => {
      ctx.defer(async () => {
        cleanupStarted.release();
        await cleanup.promise;
      });
      stop.abort();
      throw error;
    },
    close: (options, next) => {
      closes.push(options);
      return next();
    },
  });
  const scope = createScope({ signal: stop.signal, extensions: [piece] });
  const ready = expect(scope.ready).rejects.toBe(error);
  await cleanupStarted.promise;
  expect(await Promise.race([scope.closed, Promise.resolve("pending")])).toBe("pending");
  cleanup.release();
  await ready;
  const ended = await scope.closed;
  if (ended.status !== "failed") throw ended;
  expect(ended.error).toBe(error);
  expect(closes).toEqual([{}]);
});

test.each([false, true])(
  "a stop requested before ready waits for start (already aborted: %s)",
  async (alreadyAborted) => {
    const stop = new AbortController();
    if (alreadyAborted) stop.abort();
    const start = gate();
    const events: string[] = [];
    const piece = extension({
      label: "slow-start",
      start: async (scope, ctx) => {
        await start.promise;
        scope.controller(count).set(3);
        ctx.defer(() => {
          events.push("cleanup");
        });
        events.push("start");
      },
    });
    const scope = createScope({ signal: stop.signal, extensions: [piece] });
    if (!alreadyAborted) stop.abort();
    scope.controller(count).set(2);
    expect(scope.resolve(count)).toBe(2);
    expect(await Promise.race([scope.closed, Promise.resolve("pending")])).toBe("pending");
    start.release();
    await scope.ready;
    expect((await scope.closed).status).toBe("success");
    expect(events).toEqual(["start", "cleanup"]);
  },
);

test("a stop lets in-flight work finish without aborting its ctx signal", async () => {
  const stop = new AbortController();
  const work = gate();
  const closing = gate();
  const run = operation({
    label: "finish-work",
    run: async (_deps, ctx) => {
      const signal = ctx.signal;
      await work.promise;
      return signal.aborted;
    },
  });
  const piece = extension({
    label: "close-start",
    close: (_options, next) => {
      closing.release();
      return next();
    },
  });
  const scope = createScope({ signal: stop.signal, extensions: [piece] });
  await scope.ready;
  const running = scope.run(run);
  stop.abort();
  await closing.promise;
  expect(await Promise.race([scope.closed, Promise.resolve("pending")])).toBe("pending");
  work.release();
  expect(await running).toBe(false);
  expect((await scope.closed).status).toBe("success");
});

test("a stop after a manual close does not run close hooks again", async () => {
  const stop = new AbortController();
  const modes: Scope.CloseOptions[] = [];
  const piece = extension({
    label: "close-once",
    close: (options, next) => {
      modes.push(options);
      return next();
    },
  });
  const scope = createScope({ signal: stop.signal, extensions: [piece] });
  await scope.ready;
  const ended = await scope.close();
  stop.abort();
  expect(await scope.closed).toBe(ended);
  expect(modes).toEqual([{}]);
});

test("a stop joins an object run hook through its cleanup", async () => {
  const stop = new AbortController();
  const resume = gate();
  const events: string[] = [];
  const task = operation({
    label: "task",
    run: () => {
      events.push("body");
      return 7;
    },
  });
  const piece = extension({
    label: "waiting-hook",
    hooks: {
      run: (event) => {
        const value = event.next();
        event.defer(() => {
          events.push("cleanup");
        });
        events.push("waiting");
        return resume.promise.then(() => {
          events.push(`resumed:${event.resolve(count)}`);
          return value;
        });
      },
    },
  });
  const scope = createScope({ signal: stop.signal, extensions: [piece] });
  await scope.ready;
  const running = Promise.resolve(scope.run(task));
  expect(events).toEqual(["body", "waiting"]);
  stop.abort();
  expect(await Promise.race([scope.closed, Promise.resolve("pending")])).toBe("pending");
  resume.release();
  expect(await running).toBe(7);
  expect((await scope.closed).status).toBe("success");
  expect(events).toEqual(["body", "waiting", "resumed:0", "cleanup"]);
});

test("a forced close joins the graceful close requested by the stop signal", async () => {
  const stop = new AbortController();
  const cleanupStarted = gate();
  const cleanup = gate();
  const scope = createScope({ signal: stop.signal });
  scope.onClose(async () => {
    cleanupStarted.release();
    await cleanup.promise;
  });
  await scope.ready;
  stop.abort();
  await cleanupStarted.promise;
  const forced = scope.close();
  cleanup.release();
  const ended = await scope.closed;
  expect(await forced).toBe(ended);
  expect(ended.status).toBe("success");
});

test("closed stays pending while the root is open", async () => {
  const scope = createScope({ signal: new AbortController().signal });
  await scope.ready;
  expect(await Promise.race([scope.closed, Promise.resolve("pending")])).toBe("pending");
  await scope.close();
});

test.each([false, true])(
  "closed and repeated closes share the first close's Result (withData: %s)",
  async (withData) => {
    const scope = createScope({ signal: new AbortController().signal });
    await scope.ready;
    scope.controller(count).set(7);
    const first = scope.close({ graceful: true, withData });
    const second = scope.close({ withData: !withData });
    const ended = await first;
    expect(await second).toBe(ended);
    expect(await scope.closed).toBe(ended);
    expect(await scope.close()).toBe(ended);
    expect(ended.data?.get(count)).toEqual(withData ? { present: true, value: 7 } : undefined);
  },
);

test("closed waits for close hooks' after-work and keeps core's Result", async () => {
  const afterStarted = gate();
  const after = gate();
  let result: Scope.Result | undefined;
  const piece = extension({
    label: "after-work",
    close: async (_options, next) => {
      result = await next();
      afterStarted.release();
      await after.promise;
      return { status: "success" };
    },
  });
  const scope = createScope({ signal: new AbortController().signal, extensions: [piece] });
  await scope.ready;
  const closing = scope.close();
  await afterStarted.promise;
  expect(await Promise.race([scope.closed, Promise.resolve("pending")])).toBe("pending");
  after.release();
  await closing;
  expect(await scope.closed).toBe(result);
  expect(result?.status).toBe("cancelled");
});

test("closed resolves core's Result when a close hook throws after next", async () => {
  const error = new Error("close hook failed");
  const piece = extension({
    label: "throw-after-close",
    close: async (_options, next) => {
      await next();
      throw error;
    },
  });
  const scope = createScope({ signal: new AbortController().signal, extensions: [piece] });
  await scope.ready;
  await expect(scope.close({ graceful: true })).rejects.toBe(error);
  expect(await scope.closed).toEqual({ status: "success", teardownErrors: undefined });
});

test.each([false, true])(
  "closed stays pending when a close hook skips next (throws: %s)",
  async (throws) => {
    const error = new Error("close refused");
    const piece = extension({
      label: "skip-close",
      close: () => {
        if (throws) throw error;
        return Promise.resolve({ status: "success" });
      },
    });
    const scope = createScope({ signal: new AbortController().signal, extensions: [piece] });
    await scope.ready;
    if (throws) await expect(scope.close()).rejects.toBe(error);
    else await scope.close();
    expect(await Promise.race([scope.closed, Promise.resolve("pending")])).toBe("pending");
  },
);

test("the root drops its stop listener before any close hook runs", async () => {
  const stop = new AbortController();
  const listeners: number[] = [];
  const piece = extension({
    label: "check-listener",
    close: (_options, next) => {
      listeners.push(getEventListeners(stop.signal, "abort").length);
      stop.abort();
      return next();
    },
  });
  const scope = createScope({ signal: stop.signal, extensions: [piece] });
  await scope.ready;
  expect(getEventListeners(stop.signal, "abort")).toHaveLength(1);
  await scope.close();
  expect(listeners).toEqual([0]);
});

test("a signal close runs every close hook gracefully through the current handle", async () => {
  const stop = new AbortController();
  const modes: Scope.CloseOptions[] = [];
  const first = extension({
    label: "first",
    start: (scope, _ctx, next) => {
      const close = scope.close.bind(scope);
      scope.close = (options) => {
        modes.push(options ?? {});
        return close(options);
      };
      return next();
    },
    close: (options, next) => {
      modes.push(options);
      return next();
    },
  });
  const second = extension({
    label: "second",
    close: (options, next) => {
      modes.push(options);
      return next();
    },
  });
  const scope = createScope({ signal: stop.signal, extensions: [first, second] });
  await scope.ready;
  stop.abort();
  expect((await scope.closed).status).toBe("success");
  expect(modes).toEqual([{ graceful: true }, { graceful: true }, { graceful: true }]);
});

test("only a root given a signal has closed and sessions take no signal", async () => {
  const plain = createScope();
  const extended = createScope({ extensions: [extension({ label: "plain" })] });
  const root = createScope({ signal: new AbortController().signal });
  expectTypeOf(plain).not.toHaveProperty("closed");
  expectTypeOf(extended).not.toHaveProperty("closed");
  expectTypeOf(root).toEqualTypeOf<Scope.RootHandle>();
  expectTypeOf<NonNullable<Parameters<Scope.Handle["createSession"]>[0]>>().not.toHaveProperty(
    "signal",
  );
  expect(plain).not.toHaveProperty("closed");
  expect(extended).not.toHaveProperty("closed");
  expect({ ...root }.closed).toBe(root.closed);
  await Promise.all([plain.close(), extended.close(), root.close()]);
});
