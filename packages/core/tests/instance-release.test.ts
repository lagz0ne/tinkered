import { expect, test } from "vite-plus/test";
import { createScope, data, isError, operation, resource, type Resource } from "../src/index.ts";

test("a late default dependency stays open through its dependent's async cleanup", async () => {
  let finishBuild!: () => void;
  const buildGate = new Promise<void>((resolve) => (finishBuild = resolve));
  let finishRun!: () => void;
  const runGate = new Promise<void>((resolve) => (finishRun = resolve));
  let finishCleanup!: () => void;
  const cleanupGate = new Promise<void>((resolve) => (finishCleanup = resolve));
  let entered!: () => void;
  const runningBody = new Promise<void>((resolve) => (entered = resolve));
  const ended: string[] = [];
  const pool = resource({
    label: "pool",
    factory: async (_deps, ctx) => {
      await buildGate;
      const value = { closed: false };
      ctx.defer((end) => {
        value.closed = true;
        ended.push(`pool:${end.status}`);
      });
      return value;
    },
  });
  const client = resource({
    label: "client",
    depends: { pool },
    factory: async ({ pool }, ctx) => {
      const value = await Promise.resolve(pool);
      ctx.defer(async (end) => {
        ended.push(`client:${end.status}`);
        expect(value.closed).toBe(false);
        await cleanupGate;
        expect(value.closed).toBe(false);
      });
      return value;
    },
  });
  const hold = operation({
    label: "hold",
    depends: { client },
    run: async ({ client }) => {
      const value = await Promise.resolve(client);
      entered();
      await runGate;
      return value.closed;
    },
  });
  const scope = createScope();
  const running = scope.run(hold);
  scope.release(pool);
  finishBuild();
  await runningBody;
  expect(ended).toEqual([]);
  finishRun();
  expect(await running).toBe(false);
  for (let i = 0; i < 10 && ended.length === 0; i++) await Promise.resolve();
  expect(ended).toEqual(["client:released"]);
  finishCleanup();
  await scope.settled();
  expect(ended).toEqual(["client:released", "pool:released"]);
  await scope.close();
});

test("release finishes a borrowed client before its pool", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const ended: string[] = [];
  const pool = resource({
    label: "pool",
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ended.push(`pool:${end.status}`));
      return {};
    },
  });
  const client = resource({
    label: "client",
    depends: { pool },
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ended.push(`client:${end.status}`));
      return {};
    },
  });
  const hold = operation({ label: "hold", depends: { client }, run: async () => gate });
  const scope = createScope();
  const running = scope.run(hold);
  scope.release(pool);
  expect(ended).toEqual([]);
  finish();
  await running;
  await scope.settled();
  expect(ended).toEqual(["client:released", "pool:released"]);
  await scope.close();
});

test("a watcher borrowing a replacement cannot hold the old instance", async () => {
  const cell = data({ label: "cell", initial: 0 });
  const ended: number[] = [];
  let built = 0;
  const client = resource({
    label: "client",
    depends: { cell },
    factory: (_deps, ctx) => {
      const id = ++built;
      ctx.defer(() => void ended.push(id));
      return id;
    },
  });
  let finishOld!: () => void;
  const oldGate = new Promise<void>((resolve) => (finishOld = resolve));
  let finishNew!: () => void;
  const newGate = new Promise<void>((resolve) => (finishNew = resolve));
  const hold = operation({
    label: "hold",
    depends: { client },
    run: async ({ client }) => {
      await (client === 1 ? oldGate : newGate);
      return client;
    },
  });
  const scope = createScope();
  scope.controller(cell).set(1);
  const old = scope.run(hold);
  let replacement!: Promise<number>;
  scope.controller(cell).watch(() => {
    replacement = scope.run(hold);
  });
  scope.release(cell);
  expect(built).toBe(2);
  finishOld();
  expect(await old).toBe(1);
  for (let i = 0; i < 10 && ended.length === 0; i++) await Promise.resolve();
  expect(ended).toEqual([1]);
  finishNew();
  expect(await replacement).toBe(2);
  await scope.close();
});

test("a build rejected before release keeps its failed hook outcome", async () => {
  const cause = new Error("build failed");
  const ended: string[] = [];
  const client = resource({
    label: "client",
    factory: async (_deps, ctx) => {
      ctx.defer((end) => void ended.push(end.status));
      throw cause;
    },
  });
  const scope = createScope();
  await expect(scope.resolve(client)).rejects.toBe(cause);
  scope.release(client);
  expect(ended).toEqual(["failed"]);
  await scope.close();
});

test("interleaved resource hooks keep reverse registration order", async () => {
  const order: string[] = [];
  const b = resource({
    label: "b",
    factory: (_deps, ctx) => {
      ctx.defer(() => void order.push("b"));
      return {};
    },
  });
  const scope = createScope();
  const a = resource({
    label: "a",
    factory: (_deps, ctx) => {
      ctx.defer(() => void order.push("a-first"));
      scope.resolve(b);
      ctx.defer(() => void order.push("a-last"));
      return {};
    },
  });
  scope.resolve(a);
  await scope.close();
  expect(order).toEqual(["a-last", "b", "a-first"]);
});

test("interleaved release hooks keep reverse registration order", async () => {
  const order: string[] = [];
  const cell = data({ label: "cell", initial: 0 });
  const scope = createScope();
  const b = resource({
    label: "b",
    depends: { cell },
    factory: (_deps, ctx) => {
      ctx.defer(() => void order.push("b"));
      return {};
    },
  });
  const a = resource({
    label: "a",
    depends: { cell },
    factory: (_deps, ctx) => {
      ctx.defer(() => void order.push("a-first"));
      scope.resolve(b);
      ctx.defer(() => void order.push("a-last"));
      return {};
    },
  });
  scope.resolve(a);
  scope.release(cell);
  expect(order).toEqual(["a-last", "b", "a-first"]);
  await scope.close();
});

test("a circular resource does not hold itself open after rejection", async () => {
  const depends: Record<string, Resource.Handle<unknown>> = {};
  const loop = resource({ label: "loop", depends, factory: () => ({}) });
  depends.self = loop;
  const scope = createScope();
  let thrown: unknown;
  try {
    scope.resolve(loop);
  } catch (error) {
    thrown = error;
  }
  if (!isError(thrown, "CircularResource")) throw thrown;
  expect((await scope.close()).status).toBe("cancelled");
});

test("two dependency slots keep one hold on the same instance", async () => {
  const ended: string[] = [];
  const pool = resource({
    label: "pool",
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ended.push(`pool:${end.status}`));
      return {};
    },
  });
  const client = resource({
    label: "client",
    depends: { first: pool, second: pool },
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ended.push(`client:${end.status}`));
      return {};
    },
  });
  const scope = createScope();
  scope.resolve(client);
  scope.release(pool);
  expect(ended).toEqual(["client:released", "pool:released"]);
  await scope.close();
});

test("release awaits interleaved async hooks in reverse registration order", async () => {
  let finishLast!: () => void;
  const lastGate = new Promise<void>((resolve) => (finishLast = resolve));
  let finishMiddle!: () => void;
  const middleGate = new Promise<void>((resolve) => (finishMiddle = resolve));
  const order: string[] = [];
  const cell = data({ label: "cell", initial: 0 });
  const scope = createScope();
  const middle = resource({
    label: "middle",
    depends: { cell },
    factory: (_deps, ctx) => {
      ctx.defer(async () => {
        order.push("middle");
        await middleGate;
      });
      return {};
    },
  });
  const outer = resource({
    label: "outer",
    depends: { cell },
    factory: (_deps, ctx) => {
      ctx.defer(() => void order.push("first"));
      scope.resolve(middle);
      ctx.defer(async () => {
        order.push("last");
        await lastGate;
      });
      return {};
    },
  });
  scope.resolve(outer);
  scope.release(cell);
  expect(order).toEqual(["last"]);
  finishLast();
  for (let i = 0; i < 10 && order.length < 2; i++) await Promise.resolve();
  expect(order).toEqual(["last", "middle"]);
  finishMiddle();
  await scope.settled();
  expect(order).toEqual(["last", "middle", "first"]);
  await scope.close();
});

test("a dependency stays open through every hook of its dependent", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const order: string[] = [];
  const pool = resource({
    label: "pool",
    factory: (_deps, ctx) => {
      const value = { closed: false };
      ctx.defer(() => {
        value.closed = true;
        order.push("pool");
      });
      return value;
    },
  });
  const client = resource({
    label: "client",
    depends: { pool },
    factory: ({ pool }, ctx) => {
      ctx.defer(async () => {
        order.push("client-first");
        expect(pool.closed).toBe(false);
        await gate;
        expect(pool.closed).toBe(false);
      });
      ctx.defer(() => void order.push("client-last"));
      return {};
    },
  });
  const scope = createScope();
  scope.resolve(client);
  scope.release(pool);
  expect(order).toEqual(["client-last", "client-first"]);
  finish();
  await scope.settled();
  expect(order).toEqual(["client-last", "client-first", "pool"]);
  await scope.close();
});

test("close joins a release whose next hook is queued behind an async hook", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const order: string[] = [];
  const cell = data({ label: "cell", initial: 0 });
  const first = resource({
    label: "first",
    depends: { cell },
    factory: (_deps, ctx) => {
      ctx.defer(() => void order.push("first"));
      return {};
    },
  });
  const second = resource({
    label: "second",
    depends: { cell },
    factory: (_deps, ctx) => {
      ctx.defer(async () => {
        order.push("second");
        await gate;
      });
      return {};
    },
  });
  const scope = createScope();
  scope.resolve(first);
  scope.resolve(second);
  scope.release(cell);
  const closed = scope.close({ graceful: true });
  expect(order).toEqual(["second"]);
  finish();
  await closed;
  expect(order).toEqual(["second", "first"]);
});

test("a released build keeps its end when it rejects after release", async () => {
  let rejectBuild!: (error: Error) => void;
  const gate = new Promise<void>((_resolve, reject) => (rejectBuild = reject));
  const cause = new Error("late failure");
  const ends: string[] = [];
  const slow = resource({
    label: "slow",
    factory: async (_deps, ctx) => {
      ctx.defer((end) => void ends.push(end.status));
      await gate;
    },
  });
  const scope = createScope();
  const first = scope.resolve(slow);
  scope.release(slow);
  rejectBuild(cause);
  await expect(first).rejects.toBe(cause);
  await scope.settled();
  expect(ends).toEqual(["released"]);
  await scope.close();
});

test("release keeps its end when close joins a borrowed instance", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const ended: string[] = [];
  const pool = resource({
    label: "pool",
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ended.push(end.status));
      return {};
    },
  });
  const hold = operation({ label: "hold", depends: { pool }, run: async () => gate });
  const scope = createScope();
  const running = scope.run(hold);
  scope.release(pool);
  const closing = scope.close({ graceful: true });
  expect(ended).toEqual([]);
  finish();
  await running;
  await closing;
  expect(ended).toEqual(["released"]);
});

test("a late build gives its waiting run a value and ends its hook once as released", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const ends: string[] = [];
  const slow = resource({
    label: "slow",
    factory: async (_deps, ctx) => {
      await gate;
      ctx.defer((end) => void ends.push(end.status));
      return 42;
    },
  });
  const read = operation({
    label: "read",
    depends: { slow },
    run: async ({ slow }) => await Promise.resolve(slow),
  });
  const scope = createScope();
  const running = scope.run(read);
  scope.release(slow);
  finish();
  expect(await running).toBe(42);
  await scope.settled();
  expect(ends).toEqual(["released"]);
  await scope.close();
  expect(ends).toEqual(["released"]);
});
