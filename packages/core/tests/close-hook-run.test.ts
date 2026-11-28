import { expect, test } from "vite-plus/test";

import { capsule, createScope, data, operation, type Capsule } from "@/index";

const sent = data<number>({ label: "flush.sent", initial: 0 });

const flushOne = operation({
  label: "flush.one",
  depends: { sent: sent.controller },
  run: ({ sent: count }) => {
    count.update((n) => n + 1);
  },
});

const store = capsule({ label: "flush.store", exports: { sent } });

const sends = { role: "worker", explain: "Sends what is left" } as const;

type CloseHook = NonNullable<Capsule.Hooks["close"]>;

/** Start a scope with the store and one capsule that has this close hook. */
async function started(close: CloseHook) {
  const hooked = capsule({ label: "flush.hooked", hooks: { close } });
  return createScope({ capsules: [store(), hooked()] }).ready;
}

/** Close gracefully, and say how many sends the watcher saw and how the close ended. */
async function closed(close: CloseHook) {
  const scope = await started(close);
  const view = scope.resolve(store.sent);
  let count = 0;
  view.watch(() => {
    count = view.get();
  });

  const result = await scope.close({ graceful: true });
  return { count, status: result.status, errors: result.teardownErrors?.length ?? 0 };
}

/** Run a call, and give back "ran" or the error it raised, at once or later. */
async function outcome(call: () => unknown) {
  try {
    await call();
    return "ran";
  } catch (error) {
    return error;
  }
}

test("a close hook runs an op before next(): the op runs and the close succeeds (#78)", async () => {
  const result = await closed(async ({ options, run, next }) => {
    if (options.graceful) await run(flushOne, {}, sends);
    return next();
  });

  expect(result).toMatchObject({ count: 1, status: "success", errors: 0 });
});

test("a close hook's settle before next() runs the op too", async () => {
  let settled: unknown;
  const result = await closed(async ({ settle, next }) => {
    settled = (await settle(flushOne, {}, sends)).status;
    return next();
  });

  expect(settled).toBe("success");
  expect(result).toMatchObject({ count: 1, status: "success", errors: 0 });
});

test("a close hook's run after next() still raises Disposed", async () => {
  let late: unknown;
  const result = await closed(async ({ run, next }) => {
    const done = await next();
    late = await outcome(() => run(flushOne, {}, sends));
    return done;
  });

  expect(result.count).toBe(0);
  expect(String(late)).toContain("Disposed");
});

test("an outside call while a close hook runs is still refused", async () => {
  let outside: unknown;
  let scope: Awaited<ReturnType<typeof started>> | undefined;
  scope = await started(async ({ run, next }) => {
    await run(flushOne, {}, sends);
    outside = await outcome(() => scope?.run(flushOne));
    return next();
  });

  await scope.close({ graceful: true });

  expect(String(outside)).toContain("Disposed");
});

test("a forced close's hook run still raises Disposed: forced stops work now", async () => {
  let ran: unknown;
  const scope = await started(async ({ run, next }) => {
    ran = await outcome(() => run(flushOne, {}, sends));
    return next();
  });

  await scope.close();

  expect(String(ran)).toContain("Disposed");
});
