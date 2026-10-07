import { expect, test } from "vite-plus/test";
import {
  createScope,
  data,
  extension,
  isError,
  operation,
  resource,
  type Scope,
} from "../src/index";

for (const graceful of [true, false]) {
  test(`sync resource cleanup closes without extra turns (graceful: ${graceful})`, async () => {
    const calls: string[] = [];
    const owned = resource({
      label: "sync-close",
      factory: (_deps, { defer }) => {
        defer(() => {
          calls.push("resource");
        });
        return 1;
      },
    });
    const root = createScope();
    const draft = data({ label: "sync-close-discarded", initial: 0 });
    root.controller(draft).set(7);
    root.resolve(owned);
    root.onClose(() => {
      calls.push("scope");
    });
    let result: Scope.Result | undefined;
    const closing = root.close({ graceful }).then((end) => {
      result = end;
      return end;
    });
    expect(calls).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["scope", "resource"]);
    expect(result).toEqual(
      graceful
        ? { status: "success", teardownErrors: undefined }
        : { status: "cancelled", reason: expect.anything(), teardownErrors: undefined },
    );
    expect(await root.close({ graceful: !graceful })).toBe(await closing);
  });
}

test("close waits for async cleanup before running earlier cleanup", async () => {
  const calls: string[] = [];
  let release = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owned = resource({
    label: "async-close",
    factory: (_deps, { defer }) => {
      defer(() => {
        calls.push("earlier");
      });
      defer(async () => {
        calls.push("waiting");
        await wait;
        calls.push("finished");
      });
      return 1;
    },
  });
  const root = createScope();
  root.resolve(owned);
  const closing = root.close({ graceful: true });
  await expect.poll(() => calls).toEqual(["waiting"]);
  release();
  expect((await closing).status).toBe("success");
  expect(calls).toEqual(["waiting", "finished", "earlier"]);
});

test("a destructured operation defer keeps its run's cleanup", async () => {
  const calls: string[] = [];
  const op = operation({
    label: "borrow-defer",
    run: (_deps, ctx) => {
      const { defer } = ctx;
      defer(() => {
        calls.push("first");
      });
      ctx.defer(() => {
        calls.push("second");
      });
      return 7;
    },
  });
  const root = createScope();
  expect(root.settle(op)).toEqual({ status: "success", value: 7 });
  expect(calls).toEqual(["second", "first"]);
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("closing keeps the web AbortError code for callers", async () => {
  const owned = resource({
    label: "close-reason",
    factory: (_deps, { closing }) => closing,
  });
  const root = createScope();
  const closing = root.resolve(owned);
  expect((await root.close({ graceful: true })).status).toBe("success");
  expect(closing.reason).toMatchObject({
    name: "AbortError",
    code: 20,
    message: expect.stringMatching(/\S/),
  });
});

test("a saved run next refuses to start a body after its run has finished", async () => {
  let next = (): unknown => undefined;
  const around = extension({
    label: "save-next",
    hooks: {
      run: (event) => {
        next = event.next;
        return 7;
      },
    },
  });
  const op = operation({ label: "late-body", run: () => 9 });
  const root = createScope({ extensions: [around] });
  expect(root.settle(op)).toEqual({ status: "success", value: 7 });
  let error: unknown;
  try {
    next();
  } catch (cause) {
    error = cause;
  }
  if (!isError(error, "Disposed")) throw error;
  expect(error.payload.reason).toBe("run is finished");
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("a hooked run waits for its async resource before calling its body", async () => {
  const calls: string[] = [];
  let release = (_value: number): void => undefined;
  const ready = new Promise<number>((resolve) => {
    release = resolve;
  });
  const owned = resource({ label: "async-hook-input", factory: () => ready });
  const op = operation({
    label: "async-hook-body",
    depends: { owned },
    run: async ({ owned }, { defer }) => {
      defer(() => {
        calls.push("cleanup");
      });
      calls.push("body");
      return owned + 1;
    },
  });
  const around = extension({
    label: "around-async-input",
    hooks: {
      run: async (event) => {
        calls.push("before");
        const value = await event.next();
        calls.push("after");
        return value;
      },
    },
  });
  const root = createScope({ extensions: [around] });
  const running = root.settle(op);
  expect(calls).toEqual(["before"]);
  release(7);
  expect(await running).toEqual({ status: "success", value: 8 });
  expect((await root.close({ graceful: true })).status).toBe("success");
  expect(calls).toEqual(["before", "body", "after", "cleanup"]);
});

test("a sync cleanup close keeps written data when withData is set", async () => {
  const draft = data({ label: "sync-close-draft", initial: 0 });
  const root = createScope();
  root.controller(draft).set(7);
  root.onClose(() => undefined);
  const ended = await root.close({ graceful: true, withData: true });
  expect(ended.status).toBe("success");
  expect(ended.data?.get(draft)).toEqual({ present: true, value: 7 });
});

test("an async scope cleanup failure is returned with the close result", async () => {
  const cause = new Error("async cleanup failed");
  const root = createScope();
  root.onClose(() => Promise.reject(cause));
  expect(await root.close({ graceful: true })).toEqual({
    status: "success",
    teardownErrors: [cause],
  });
});

for (const controller of [false, true]) {
  test(`settle keeps the call signal chosen before its body runs (controller: ${controller})`, async () => {
    const root = createScope();
    const stop = new AbortController();
    const cause = new Error("late signal");
    stop.abort(cause);
    const call: { signal?: AbortSignal } = {};
    const op = operation({
      label: "replace-signal",
      run: () => {
        call.signal = stop.signal;
        throw cause;
      },
    });
    const result = controller ? root.controller(op).settle(call) : root.settle(op, call);
    if (result.status !== "failed") throw result;
    expect(result.error).toBe(cause);
    expect((await root.close({ graceful: true })).status).toBe("success");
  });
}
