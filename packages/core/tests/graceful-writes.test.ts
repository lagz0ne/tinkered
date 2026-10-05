import { expect, test } from "vite-plus/test";
import {
  createScope,
  data,
  extension,
  isError,
  namespace,
  operation,
  resource,
  tag,
} from "../src/index.ts";

function gate() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const count = data({ initial: 0 });
const lifetime = resource({
  label: "lifetime",
  target: "session",
  factory: (_deps, ctx) => ({ closing: ctx.closing, signal: ctx.signal }),
});

for (const mode of ["root stop", "root close", "session close"]) {
  test(`a running call finishes its write during graceful ${mode}`, async () => {
    const finish = gate();
    const write = operation({
      label: "write",
      depends: { count: count.controller },
      run: async ({ count }) => {
        await finish.promise;
        count.set(1);
        return count.get();
      },
    });
    const stop = new AbortController();
    const root = createScope({ signal: stop.signal });
    await root.ready;
    const session = root.createSession();
    const signals = session.resolve(lifetime);
    const began = gate();
    signals.closing.addEventListener("abort", () => began.resolve(), { once: true });
    const running = session.settle(write);
    const closing =
      mode === "session close"
        ? session.close({ graceful: true, withData: true })
        : mode === "root close"
          ? root.close({ graceful: true })
          : root.closed;
    if (mode === "root stop") stop.abort();
    await began.promise;
    await expect.poll(() => session.settle({ run: () => 0 }).status).toBe("failed");
    expect(signals.signal.aborted).toBe(false);
    finish.resolve();
    expect(await running).toMatchObject({ status: "success", value: 1 });
    const ended = await closing;
    expect(ended.status).toBe("success");
    if (mode === "session close") {
      expect(ended.data?.get(count)).toEqual({ present: true, value: 1 });
      await root.close({ graceful: true });
    }
  });
}

test("a running call's async defer can write during graceful close", async () => {
  const finish = gate();
  const cleanup = gate();
  const entered = gate();
  const write = operation({
    label: "write",
    depends: { count: count.controller },
    run: async ({ count }, ctx) => {
      ctx.defer(async () => {
        entered.resolve();
        await cleanup.promise;
        count.set(2);
      });
      await finish.promise;
    },
  });
  const root = createScope();
  const session = root.createSession();
  const running = session.run(write);
  const closing = session.close({ graceful: true, withData: true });
  finish.resolve();
  await entered.promise;
  cleanup.resolve();
  await running;
  const ended = await closing;
  expect(ended.teardownErrors).toBeUndefined();
  expect(ended.data?.get(count)).toEqual({ present: true, value: 2 });
  await root.close();
});

test("graceful close refuses new calls through handles and saved controllers", async () => {
  const finish = gate();
  const work = operation({ label: "work", run: () => finish.promise });
  const root = createScope();
  const saved = root.controller(work);
  const running = root.run(work);
  const closing = root.close({ graceful: true });
  for (const result of [root.settle(work), saved.settle(), root.settle({ run: () => 1 })]) {
    const ended = await result;
    if (ended.status !== "failed" || !isError(ended.error, "Disposed")) throw ended;
  }
  try {
    root.createSession();
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
  const error = await root
    .session(() => 1)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  if (!isError(error, "Disposed")) throw error;
  finish.resolve();
  await running;
  expect((await closing).status).toBe("success");
});

test("forced close aborts a running call without waiting for its write gate", async () => {
  const finish = gate();
  const write = operation({
    label: "write",
    depends: { count: count.controller },
    run: async ({ count }, ctx) => {
      await Promise.race([
        finish.promise,
        new Promise<never>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
        }),
      ]);
      count.set(1);
    },
  });
  const root = createScope();
  const running = root.settle(write);
  const closing = root.close({ withData: true });
  expect((await running).status).toBe("cancelled");
  const ended = await closing;
  expect(ended.status).toBe("cancelled");
  expect(ended.data?.get(count)).toEqual({ present: false });
  finish.resolve();
});

test("closed reports a real failure from a running call's write", async () => {
  const finish = gate();
  const cause = new Error("watch failed");
  const write = operation({
    label: "write",
    depends: { count: count.controller },
    run: async ({ count }) => {
      await finish.promise;
      count.set(1);
    },
  });
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal });
  await root.ready;
  const session = root.createSession();
  const signals = session.resolve(lifetime);
  const began = gate();
  signals.closing.addEventListener("abort", () => began.resolve(), { once: true });
  session.controller(count).watch(() => {
    throw cause;
  });
  const running = session.run(write);
  const rejected = expect(running).rejects.toBe(cause);
  stop.abort();
  await began.promise;
  await expect.poll(() => session.settle({ run: () => 0 }).status).toBe("failed");
  finish.resolve();
  await rejected;
  expect(await root.closed).toMatchObject({ status: "failed", error: cause });
});

test("closing refuses new calls before a waiting root close hook resumes", async () => {
  const finish = gate();
  const zone = tag({ label: "zone", default: "home" });
  const named = namespace();
  const work = operation({ label: "work", run: () => 1 });
  const root = createScope({
    extensions: [
      extension({
        label: "wait",
        hooks: {
          close: async (event) => {
            await finish.promise;
            return event.next();
          },
        },
      }),
    ],
  });
  await root.ready;
  const saved = root.controller(work);
  const closing = root.close({ graceful: true });
  for (const result of [
    root.settle(work),
    saved.settle(),
    saved.settle({ tags: [zone("away")] }),
    saved.settle({ ns: named }),
    saved.settle({ signal: new AbortController().signal }),
  ]) {
    const ended = await result;
    if (ended.status !== "failed" || !isError(ended.error, "Disposed")) throw ended;
  }
  finish.resolve();
  expect((await closing).status).toBe("success");
});

test("a first closing read during graceful root drain is already aborted", async () => {
  const finish = gate();
  const capture = resource({ label: "late closing", factory: (_deps, ctx) => ctx });
  const root = createScope();
  const ctx = root.resolve(capture);
  const running = root.run({ run: () => finish.promise });
  const closing = root.close({ graceful: true });
  const aborted = ctx.closing.aborted;
  finish.resolve();
  await running;
  await closing;
  expect(aborted).toBe(true);
});

test("graceful close refuses new calls before run hooks start", async () => {
  const finish = gate();
  const active = operation({ label: "active", run: () => finish.promise });
  const later = operation({ label: "later", run: () => 7 });
  const root = createScope({
    extensions: [extension({ label: "run hook", hooks: { run: (event) => event.next() } })],
  });
  await root.ready;
  const saved = root.controller(later);
  const running = root.run(active);
  const closing = root.close({ graceful: true });
  try {
    const ended = saved.settle();
    if (ended.status !== "failed" || !isError(ended.error, "Disposed")) throw ended;
  } finally {
    finish.resolve();
    await running;
    await closing;
  }
});

test("graceful close refuses new sessions through session hooks", async () => {
  const finish = gate();
  const root = createScope({
    extensions: [extension({ label: "session hook", hooks: { session: (event) => event.next() } })],
  });
  await root.ready;
  const running = root.run({ run: () => finish.promise });
  const closing = root.close({ graceful: true });
  try {
    root.createSession();
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  } finally {
    finish.resolve();
    await running;
    await closing;
  }
});

test("a draining session refuses to release its parent's resource", async () => {
  const finish = gate();
  const owned = resource({ label: "parent owned", factory: () => 1 });
  const root = createScope();
  root.resolve(owned);
  const session = root.createSession();
  const running = session.run({ run: () => finish.promise });
  const closing = session.close({ graceful: true });
  try {
    session.release(owned);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  } finally {
    finish.resolve();
    await running;
    await closing;
    await root.close();
  }
});

for (const named of [false, true]) {
  test(`a parent release keeps a draining child's ${named ? "named" : "plain"} resource usable`, async () => {
    const finish = gate();
    const ns = namespace();
    const input = data({ initial: 0 });
    const owned = resource({
      label: "child owned",
      target: "session",
      depends: { input },
      factory: ({ input }) => input,
    });
    const root = createScope();
    const session = root.createSession();
    if (named) root.controller(input, { ns }).set(1);
    else root.controller(input).set(1);
    const held = session.controller(owned, named ? { ns } : undefined);
    held.resolve();
    const read = operation({
      label: "read after release",
      depends: { owned },
      run: async () => {
        await finish.promise;
        return held.get();
      },
    });
    const running = session.run(read, named ? { ns } : undefined);
    const closing = session.close({ graceful: true });
    if (named) root.releaseNs(input, ns);
    else root.release(input);
    finish.resolve();
    try {
      expect(await running).toBe(1);
      expect((await closing).status).toBe("success");
    } finally {
      await closing;
      await root.close();
    }
  });
}
