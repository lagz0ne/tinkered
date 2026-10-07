import { expect, test } from "vite-plus/test";
import { createScope, operation, resource, type Scope } from "../src/index";

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
  expect(closing.reason).toMatchObject({ name: "AbortError", code: 20 });
});
