import { getEventListeners } from "node:events";
import { expect, expectTypeOf, test } from "vite-plus/test";
import { createScope, data, extension, operation, resource, type Scope } from "../src/index";

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
    hooks: {
      start: (event) => {
        event.defer(async () => {
          cleanupStarted.release();
          await cleanup.promise;
          events.push("cleanup");
        });
        throw error;
      },
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
    hooks: {
      start: (event) => {
        const close = event.scope.close.bind(event.scope);
        event.scope.close = async (options) => {
          events.push("handle:before");
          const ended = await close(options);
          events.push("handle:after");
          return ended;
        };
        return event.next();
      },
      close: async (event) => {
        events.push("first:before");
        const ended = await event.next();
        events.push("first:after");
        return ended;
      },
    },
  });
  const second = extension({
    label: "second",
    hooks: {
      start: () => {
        throw error;
      },
      close: async (event) => {
        events.push("second:before");
        const ended = await event.next();
        events.push("second:after");
        return ended;
      },
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
    hooks: {
      start: async () => {
        await start.promise;
        throw error;
      },
      close: async (event) => {
        events.push("close:before");
        closing.release();
        await cleanup.promise;
        const ended = await event.next();
        events.push("close:after");
        return ended;
      },
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
    hooks: {
      start: (event) => {
        event.defer(async () => {
          cleanupStarted.release();
          await cleanup.promise;
        });
        stop.abort();
        throw error;
      },
      close: (event) => {
        closes.push(event.options);
        return event.next();
      },
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
      hooks: {
        start: async (event) => {
          await start.promise;
          event.scope.controller(count).set(3);
          event.defer(() => {
            events.push("cleanup");
          });
          events.push("start");
        },
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
    hooks: {
      close: (event) => {
        closing.release();
        return event.next();
      },
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
    hooks: {
      close: (event) => {
        modes.push(event.options);
        return event.next();
      },
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
    hooks: {
      close: async (event) => {
        result = await event.next();
        afterStarted.release();
        await after.promise;
        return { status: "success" };
      },
    },
  });
  const scope = createScope({ signal: new AbortController().signal, extensions: [piece] });
  await scope.ready;
  const closing = scope.close();
  await afterStarted.promise;
  expect(await Promise.race([scope.closed, Promise.resolve("pending")])).toBe("pending");
  after.release();
  expect(await closing).toBe(result);
  expect(await scope.closed).toBe(result);
  expect(result?.status).toBe("cancelled");
});

test("closed counts a close hook throw after next as a teardown error", async () => {
  const error = new Error("close hook failed");
  const piece = extension({
    label: "throw-after-close",
    hooks: {
      close: async (event) => {
        await event.next();
        throw error;
      },
    },
  });
  const scope = createScope({ signal: new AbortController().signal, extensions: [piece] });
  await scope.ready;
  const ended = await scope.close({ graceful: true });
  expect(await scope.closed).toBe(ended);
  expect(ended).toEqual({ status: "success", teardownErrors: [error] });
});

test("closed keeps close-hook and resource cleanup errors together", async () => {
  const before = new Error("before close");
  const cleanup = new Error("resource cleanup");
  const after = new Error("after close");
  const first = extension({
    label: "throw-before-close",
    hooks: {
      close: () => {
        throw before;
      },
    },
  });
  const last = extension({
    label: "throw-after-close",
    hooks: {
      close: async (event) => {
        await event.next();
        throw after;
      },
    },
  });
  const owned = resource({
    label: "failed-cleanup",
    factory: (_deps, ctx) => {
      ctx.defer(() => {
        throw cleanup;
      });
      return 7;
    },
  });
  const scope = createScope({ signal: new AbortController().signal, extensions: [first, last] });
  await scope.ready;
  scope.resolve(owned);
  const ended = await scope.close({ graceful: true });
  expect(await scope.closed).toBe(ended);
  expect(ended).toEqual({ status: "success", teardownErrors: [before, cleanup, after] });
});

test.each([false, true])(
  "closed includes cleanup when a close hook skips next (throws: %s)",
  async (throws) => {
    const error = new Error("close refused");
    const piece = extension({
      label: "skip-close",
      hooks: {
        close: () => {
          if (throws) throw error;
          return Promise.resolve({ status: "success" });
        },
      },
    });
    const innerCalls: string[] = [];
    const inner = extension({
      label: "inner-close",
      hooks: {
        close: (event) => {
          innerCalls.push("inner");
          const first = event.next();
          expect(event.next()).toBe(first);
          return first;
        },
      },
    });
    const scope = createScope({ signal: new AbortController().signal, extensions: [piece, inner] });
    await scope.ready;
    const cleaned: string[] = [];
    scope.onClose(() => {
      cleaned.push("cleanup");
    });
    const ended = await scope.close();
    expect(await scope.closed).toBe(ended);
    expect(ended.status).toBe("cancelled");
    expect(ended.teardownErrors).toEqual(throws ? [error] : undefined);
    expect(cleaned).toEqual(["cleanup"]);
    expect(innerCalls).toEqual(["inner"]);
  },
);

test("the root drops its stop listener before any close hook runs", async () => {
  const stop = new AbortController();
  const listeners: number[] = [];
  const piece = extension({
    label: "check-listener",
    hooks: {
      close: (event) => {
        listeners.push(getEventListeners(stop.signal, "abort").length);
        stop.abort();
        return event.next();
      },
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
    hooks: {
      start: (event) => {
        const close = event.scope.close.bind(event.scope);
        event.scope.close = (options) => {
          modes.push(options ?? {});
          return close(options);
        };
        return event.next();
      },
      close: (event) => {
        modes.push(event.options);
        return event.next();
      },
    },
  });
  const second = extension({
    label: "second",
    hooks: {
      close: (event) => {
        modes.push(event.options);
        return event.next();
      },
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
  expect(root).toHaveProperty("closed", root.closed);
  await Promise.all([plain.close(), extended.close(), root.close()]);
});
