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
