import { expect, test } from "vite-plus/test";
import { createScope, data, operation, resource } from "../src/index.ts";

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
      const value = await pool;
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
      const value = await client;
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
  const read = operation({ label: "read", depends: { slow }, run: async ({ slow }) => await slow });
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
