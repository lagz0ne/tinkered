import { getEventListeners } from "node:events";

import { expect, expectTypeOf, test } from "vite-plus/test";

import { createScope, data, capsule, operation, resource, type Scope } from "@/index";

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
  const piece = capsule({
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
  const scope = createScope({ capsules: [piece] });
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
  const first = capsule({
    label: "first",
    hooks: {
      start: (event) => event.next(),
      close: async (event) => {
        events.push("first:before");
        const ended = await event.next();
        events.push("first:after");
        return ended;
      },
    },
  });
  const second = capsule({
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
  const scope = createScope({ capsules: [first, second] });
  const close = scope.close.bind(scope);
  scope.close = async (options) => {
    events.push("handle:before");
    const ended = await close(options);
    events.push("handle:after");
    return ended;
  };
  await expect(scope.ready).rejects.toBe(error);

  expect(events).toEqual([
    "handle:before",
    "second:before",
    "first:before",
    "first:after",
    "second:after",
    "handle:after",
  ]);
});

test("close cancels a pending start and joins the hooks already running", async () => {
  const start = gate();
  const closing = gate();
  const cleanup = gate();
  const events: string[] = [];
  const error = new Error("late start failure");
  let closeSignal!: AbortSignal;
  const piece = capsule({
    label: "overlap",
    hooks: {
      start: async (event) => {
        closeSignal = event.closing;
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
  const scope = createScope({ capsules: [piece] });
  const ready = scope.ready.catch((cause: unknown) => {
    events.push("ready");
    return cause;
  });
  const ended = scope.close();
  await closing.promise;
  start.release();
  expect(await Promise.race([ready, Promise.resolve("pending")])).toBe("pending");

  cleanup.release();
  expect(await ready).toBe(closeSignal.reason);
  const result = await ended;
  if (result.status !== "failed") throw result;
  expect(result.error).toBe(error);
  expect(result.teardownErrors).toEqual([error]);
  expect(events).toEqual(["close:before", "close:after", "ready"]);
});

test("closed reports the start error after cleanup even when a stop was requested", async () => {
  const stop = new AbortController();
  const cleanupStarted = gate();
  const cleanup = gate();
  const error = new Error("start failed");
  const closes: Scope.CloseOptions[] = [];
  const piece = capsule({
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
  const scope = createScope({ signal: stop.signal, capsules: [piece] });
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

test("a stop during start waits for running hooks, then ends the start", async () => {
  const stop = new AbortController();
  const start = gate();
  const events: string[] = [];
  const piece = capsule({
    label: "slow-start",
    hooks: {
      start: async (event) => {
        await start.promise;
        event.defer(() => {
          events.push("cleanup");
        });
        events.push("start");
      },
    },
  });
  const scope = createScope({ signal: stop.signal, capsules: [piece] });
  stop.abort();

  scope.controller(count).set(2);
  expect(scope.resolve(count)).toBe(2);
  expect(await Promise.race([scope.closed, Promise.resolve("pending")])).toBe("pending");

  start.release();
  await expect(scope.ready).rejects.toBe(stop.signal.reason);
  expect((await scope.closed).status).toBe("cancelled");
  expect(events).toEqual(["start", "cleanup"]);
});

test("a stop during start skips the after-work of every hook", async () => {
  const stop = new AbortController();
  const held = gate();
  const events: string[] = [];
  const serve = capsule({
    label: "serve",
    hooks: {
      start: async ({ next }) => {
        await next();
        events.push("listen");
      },
      close: ({ next }) => {
        events.push("close");
        return next();
      },
    },
  });
  const db = capsule({
    label: "db",
    hooks: {
      start: async ({ next }) => {
        await held.promise;
        events.push("db");
        await next();
      },
    },
  });
  const scope = createScope({ signal: stop.signal, capsules: [serve, db] });
  stop.abort();
  held.release();

  await expect(scope.ready).rejects.toBe(stop.signal.reason);
  await scope.closed;
  expect(events).toEqual(["db", "close"]);
});

test("a root stopped before it starts runs no start hook", async () => {
  const stop = new AbortController();
  stop.abort();
  const events: string[] = [];
  const piece = capsule({
    label: "never",
    hooks: {
      start: () => {
        events.push("start");
      },
    },
  });
  const scope = createScope({ signal: stop.signal, capsules: [piece] });

  await expect(scope.ready).rejects.toBe(stop.signal.reason);
  expect((await scope.closed).status).toBe("cancelled");
  expect(events).toEqual([]);
});

test("a close during start skips the after-work of every hook", async () => {
  const held = gate();
  const events: string[] = [];
  const serve = capsule({
    label: "serve",
    hooks: {
      start: async ({ next }) => {
        await next();
        events.push("listen");
      },
    },
  });
  const db = capsule({
    label: "db",
    hooks: {
      start: async () => {
        await held.promise;
      },
    },
  });
  const scope = createScope({ capsules: [serve, db] });
  const closed = scope.close();
  held.release();

  await expect(scope.ready).rejects.toMatchObject({ code: 20 });
  await closed;
  await Promise.resolve();
  expect(events).toEqual([]);
});

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
  const piece = capsule({
    label: "close-start",
    hooks: {
      close: (event) => {
        closing.release();
        return event.next();
      },
    },
  });
  const scope = createScope({ signal: stop.signal, capsules: [piece] });
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
  const piece = capsule({
    label: "close-once",
    hooks: {
      close: (event) => {
        modes.push(event.options);
        return event.next();
      },
    },
  });
  const scope = createScope({ signal: stop.signal, capsules: [piece] });
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
  const piece = capsule({
    label: "waiting-hook",
    hooks: {
      run: (event) => {
        const value = event.next();
        event.defer(() => {
          events.push("cleanup");
        });
        events.push("waiting");
        return resume.promise.then(() => {
          events.push(
            `resumed:${event.load(count, { role: "state", explain: "Counts runs" }).get()}`,
          );
          return value;
        });
      },
    },
  });
  const scope = createScope({ signal: stop.signal, capsules: [piece] });
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
  const piece = capsule({
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
  const scope = createScope({ signal: new AbortController().signal, capsules: [piece] });
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
  const piece = capsule({
    label: "throw-after-close",
    hooks: {
      close: async (event) => {
        await event.next();
        throw error;
      },
    },
  });
  const scope = createScope({ signal: new AbortController().signal, capsules: [piece] });
  await scope.ready;
  const ended = await scope.close({ graceful: true });

  expect(await scope.closed).toBe(ended);
  expect(ended).toEqual({ status: "success", teardownErrors: [error] });
});

test("closed keeps close-hook and resource cleanup errors together", async () => {
  const before = new Error("before close");
  const cleanup = new Error("resource cleanup");
  const after = new Error("after close");
  const first = capsule({
    label: "throw-before-close",
    hooks: {
      close: () => {
        throw before;
      },
    },
  });
  const last = capsule({
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
  const scope = createScope({ signal: new AbortController().signal, capsules: [first, last] });
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
    const piece = capsule({
      label: "skip-close",
      hooks: {
        close: () => {
          if (throws) throw error;
          return Promise.resolve({ status: "success" });
        },
      },
    });
    const innerCalls: string[] = [];
    const inner = capsule({
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
    const scope = createScope({ signal: new AbortController().signal, capsules: [piece, inner] });
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
  const piece = capsule({
    label: "check-listener",
    hooks: {
      close: (event) => {
        listeners.push(getEventListeners(stop.signal, "abort").length);
        stop.abort();
        return event.next();
      },
    },
  });
  const scope = createScope({ signal: stop.signal, capsules: [piece] });
  await scope.ready;

  expect(getEventListeners(stop.signal, "abort")).toHaveLength(1);
  await scope.close();
  expect(listeners).toEqual([0]);
});

test("a signal close runs every close hook gracefully through the current handle", async () => {
  const stop = new AbortController();
  const modes: Scope.CloseOptions[] = [];
  const first = capsule({
    label: "first",
    hooks: {
      start: (event) => event.next(),
      close: (event) => {
        modes.push(event.options);
        return event.next();
      },
    },
  });
  const second = capsule({
    label: "second",
    hooks: {
      close: (event) => {
        modes.push(event.options);
        return event.next();
      },
    },
  });
  const scope = createScope({ signal: stop.signal, capsules: [first, second] });
  const close = scope.close.bind(scope);
  scope.close = (options) => {
    modes.push(options ?? {});
    return close(options);
  };
  await scope.ready;

  stop.abort();

  expect((await scope.closed).status).toBe("success");
  expect(modes).toEqual([{ graceful: true }, { graceful: true }, { graceful: true }]);
});

test("only a root given a signal has closed and sessions take no signal", async () => {
  const plain = createScope();
  const extended = createScope({ capsules: [capsule({ label: "plain" })] });
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

test("a stop, then a close during start, leaves no teardown error", async () => {
  const stop = new AbortController();
  const held = gate();
  const piece = capsule({
    label: "held",
    hooks: { start: () => held.promise },
  });
  const scope = createScope({ signal: stop.signal, capsules: [piece] });
  stop.abort();
  const closing = scope.close();
  held.release();

  await expect(scope.ready).rejects.toMatchObject({ code: 20 });
  const ended = await closing;
  expect(ended.teardownErrors ?? []).toEqual([]);
});

test("a hook that catches next() after a stop does not keep the start", async () => {
  const stop = new AbortController();
  const piece = capsule({
    label: "catcher",
    hooks: {
      start: async ({ next }) => {
        stop.abort();
        await next().catch(() => undefined);
      },
    },
  });
  const scope = createScope({ signal: stop.signal, capsules: [piece] });

  await expect(scope.ready).rejects.toBe(stop.signal.reason);
  expect((await scope.closed).status).toBe("cancelled");
});

test("a hook that drops next() gets no unhandled rejection from a stop", async () => {
  const stop = new AbortController();
  const held = gate();
  const dropper = capsule({
    label: "dropper",
    hooks: {
      start: async ({ next }) => {
        void next();
        await held.promise;
      },
    },
  });
  const inner = capsule({ label: "inner", hooks: { start: () => undefined } });
  const scope = createScope({ signal: stop.signal, capsules: [dropper, inner] });
  stop.abort();
  held.release();

  await expect(scope.ready).rejects.toBe(stop.signal.reason);
});
