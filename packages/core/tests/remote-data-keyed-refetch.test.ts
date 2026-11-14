import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, transport } from "@/main";
import type { Data, Scope } from "@/main";

const { hook } = transport;

// The time to ask again (ADR 0139 3): a part in use asks again on its cell's clock.

type Task = { project: string; id: string; title: string };

const tasks = data({
  label: "refetch.tasks",
  mode: "keyed",
  key: (t: Task) => ({ project: t.project, id: t.id }),
});

const board = remoteData({ tasks });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const until = async (ok: () => boolean) => {
  for (let tries = 0; !ok(); tries++) {
    if (tries > 300) throw new Error("timed out");
    await new Promise((done) => setTimeout(done, 10));
  }
};

const settle = () => new Promise((done) => setTimeout(done, 30));

async function boot(refetchInterval?: { tasks?: number }) {
  const rows = new Map<string, Task>([["p1/a", { project: "p1", id: "a", title: "a" }]]);
  const asked: unknown[] = [];
  let refuse = false;
  const loadTasks = operation({
    label: "refetch.load",
    input: z.object({ project: z.string(), id: z.string().optional() }),
    run: (_, { input }) => {
      asked.push(input);
      return [...rows.values()].filter((t) => t.project === input.project);
    },
  });
  const guard = operation({
    label: "refetch.guard",
    input: hook.start,
    run: (_, { input }) => (refuse ? input.refuse({ why: "closed" }) : undefined),
  });

  const server = await createScope({
    capsules: [
      board({ serve: true, load: { tasks: loadTasks }, onStart: [guard] }),
      memory.server({ services: [board] }),
    ],
  }).ready;
  closers.push(() => server.close());

  const clock = makeTestClock();
  const tab = await createScope({
    clock,
    capsules: [
      memory.client({ peer: server }),
      board({ read: memory.client, ...(refetchInterval && { refetchInterval }) }),
    ],
  }).ready;
  closers.push(() => tab.close());

  /** Moves the client's time, then lets the asks it starts land. */
  const pass = async (ms: number) => {
    clock.advance(ms);
    await settle();
  };
  const closeGate = (on: boolean) => {
    refuse = on;
  };
  return { tab, rows, asked, pass, closeGate };
}

/** A reader kept in use until `stop`. */
const watch = <T>(scope: Scope.Handle, read: Data.Read<T>) => {
  const reader = scope.resolve(read);
  return { get: () => reader.get(), stop: reader.watch(() => undefined) };
};

const titles = (list: readonly Task[]) => list.map((t) => t.title);

test("a part in use asks again each interval, and sees a write no one signalled", async () => {
  const app = await boot({ tasks: 1000 });
  const p1 = watch(app.tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);

  app.rows.set("p1/a", { project: "p1", id: "a", title: "quiet" });
  await app.pass(999);
  const before = titles(p1.get());
  await app.pass(1);

  expect(before).toEqual(["a"]);
  expect(titles(p1.get())).toEqual(["quiet"]);
  expect(app.asked).toHaveLength(2);

  await app.pass(1000);
  expect(app.asked).toHaveLength(3);
});

test("with no interval, a part never asks again by time", async () => {
  const app = await boot();
  const p1 = watch(app.tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);

  await app.pass(3_600_000);

  expect(app.asked).toHaveLength(1);
});

test("a part with no reader stops its clock", async () => {
  const app = await boot({ tasks: 1000 });
  const p1 = watch(app.tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);

  p1.stop();
  await app.pass(5000);

  expect(app.asked).toHaveLength(1);
});

test("a part that rides a wider part asks nothing on its own clock", async () => {
  const app = await boot({ tasks: 1000 });
  const p1 = watch(app.tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);
  const a = watch(app.tab, board.tasks.where({ project: "p1", id: "a" }));
  await settle();

  await app.pass(1000);

  expect(titles(a.get())).toEqual(["a"]);
  expect(app.asked).toEqual([{ project: "p1" }, { project: "p1" }]);
});

test("a refused part waits for its clock, then asks again", async () => {
  const app = await boot({ tasks: 1000 });
  app.closeGate(true);
  const read = board.tasks.where({ project: "p1" });
  const p1 = watch(app.tab, read);
  const state = app.tab.resolve(board.status(read));
  await until(() => state.get()?.status === "fault");

  app.closeGate(false);
  await app.pass(1000);
  await until(() => state.get()?.status === "ready");

  expect(titles(p1.get())).toEqual(["a"]);
});
