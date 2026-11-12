import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, transport } from "@/main";
import type { Data, Scope } from "@/main";

const { hook } = transport;

type Task = { project: string; id: string; title: string };

const Task = z.object({ project: z.string(), id: z.string(), title: z.string() });

const tasks = data({
  label: "task.items",
  mode: "keyed",
  parse: Task,
  key: (t) => ({ project: t.project, id: t.id }),
});

type Tag = { name: string; color: string };

const labels = data({ label: "labels", mode: "keyed", key: (t: Tag) => t.name });

const board = remoteData({ tasks, labels });

const task = (project: string, id: string, title = id): Task => ({ project, id, title });

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

/**
 * A server with tasks in two projects and one tag, and its clients. `asks` lists each ask's
 * input; `hold()` keeps the next answer back until its `release`.
 */
async function boot() {
  const asks: unknown[] = [];
  let gate: { reached: boolean; release: () => void; wait: Promise<void> } | undefined;
  const guard = operation({
    label: "guard",
    input: hook.start,
    run: (_, { input }) => void (input.key.endsWith(".ask") && asks.push(input.input)),
  });
  const late = operation({
    label: "late",
    input: hook.success,
    run: async () => {
      const held = gate;
      gate = undefined;
      if (!held) return;

      held.reached = true;
      await held.wait;
    },
  });
  const items = operation({
    label: "tasks.write",
    input: z.object({ set: z.array(Task), gone: z.array(z.string()) }),
    depends: { items: tasks.controller },
    run: ({ items }, { input }) => {
      for (const t of input.set) items.set(t);
      for (const id of input.gone) items.delete({ project: "p1", id });
    },
  });
  const paint = operation({
    label: "labels.write",
    input: z.object({ name: z.string(), color: z.string().optional() }),
    depends: { list: labels.controller },
    run: ({ list }, { input }) =>
      input.color === undefined
        ? list.delete(input.name)
        : list.set({ ...input, color: input.color }),
  });

  const server = await createScope({
    capsules: [
      board({ serve: true, onStart: [guard], onSuccess: [late] }),
      memory.server({ services: [board] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const set = (...list: Task[]) => server.run(items, { input: { set: list, gone: [] } });
  const remove = (id: string) => server.run(items, { input: { set: [], gone: [id] } });
  await set(task("p1", "a"), task("p2", "b"), task("p3", "c"), task("p3", "d"));
  await server.run(paint, { input: { name: "red", color: "#f00" } });
  await server.run(paint, { input: { name: "re", color: "#0f0" } });

  const client = async () => {
    const scope = await createScope({
      capsules: [memory.client({ peer: server }), board({ read: memory.client })],
    }).ready;
    closers.push(() => scope.close());
    return scope;
  };
  const hold = () => {
    let release = () => undefined as void;
    const wait = new Promise<void>((done) => (release = done));
    const held = { reached: false, release, wait };
    gate = held;
    return held;
  };
  return {
    server,
    client,
    asks,
    set,
    remove,
    hold,
    paint: (color: string) => server.run(paint, { input: { name: "red", color } }),
    unpaint: (name: string) => server.run(paint, { input: { name } }),
  };
}

/** A reader kept in use. */
const watch = <T>(scope: Scope.Handle, read: Data.Read<T>) => {
  const reader = scope.resolve(read);
  reader.watch(() => undefined);
  return reader;
};

const where = (scope: Scope.Handle, project: string) =>
  watch(scope, board.tasks.where({ project }));

const titles = (list: readonly Task[]) => list.map((t) => t.title);

test("a set on the server makes each reader of its part ask for one member", async () => {
  const app = await boot();
  const [a, b] = await Promise.all([app.client(), app.client()]);
  const pa = where(a, "p1");
  const pb = where(b, "p1");
  await until(() => pa.get().length > 0 && pb.get().length > 0);
  app.asks.length = 0;

  await app.set(task("p1", "a", "renamed"));
  await until(() => titles(pa.get())[0] === "renamed" && titles(pb.get())[0] === "renamed");

  const one = { read: "of", part: { project: "p1", id: "a" } };
  expect(app.asks).toEqual([one, one]);
});

test("a client that reads another part gets no signal", async () => {
  const app = await boot();
  const [a, b] = await Promise.all([app.client(), app.client()]);
  const p1 = where(a, "p1");
  const p2 = where(b, "p2");
  await until(() => p1.get().length > 0 && p2.get().length > 0);
  app.asks.length = 0;

  await app.set(task("p1", "c"));
  await until(() => p1.get().length === 2);

  expect(app.asks).toEqual([{ read: "of", part: { project: "p1", id: "c" } }]);
  expect(p2.get()).toEqual([task("p2", "b")]);
});

test("two keys of one part in one pass make one signal for the part", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = where(tab, "p1");
  await until(() => p1.get().length > 0);
  app.asks.length = 0;

  await app.set(task("p1", "c"), task("p1", "d"));
  await until(() => p1.get().length === 3);

  expect(app.asks).toEqual([{ read: "where", part: { project: "p1" } }]);
});

test("a delete on the server takes the member from each reader", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = where(tab, "p1");
  const one = watch(tab, board.tasks.of({ project: "p1", id: "a" }));
  await until(() => p1.get().length > 0 && one.get() !== undefined);

  await app.remove("a");
  await until(() => one.get() === undefined && p1.get().length === 0);

  expect(tab.resolve(board.tasks).get()).toEqual([]);
});

test("an answer that arrives after a later ask started is dropped", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = where(tab, "p1");
  await until(() => p1.get().length > 0);

  const first = app.hold();
  await app.set(task("p1", "a", "one"));
  await until(() => first.reached);
  await app.set(task("p1", "a", "two"));
  await until(() => titles(p1.get())[0] === "two");
  first.release();
  await new Promise((done) => setTimeout(done, 30));

  expect(titles(p1.get())).toEqual(["two"]);
});

test("a client's invalidate asks again and resolves with the fresh members in", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = where(tab, "p1");
  await until(() => p1.get().length > 0);
  app.asks.length = 0;

  const first = app.hold();
  await app.set(task("p1", "a", "fresh"));
  await until(() => first.reached);
  const asked = tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  first.release();
  await asked;

  expect(titles(p1.get())).toEqual(["fresh"]);
  expect(app.asks).toContainEqual({ read: "where", part: { project: "p1" } });
});

test("an invalidate asks only for the share of each part in use", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = where(tab, "p1");
  const one = watch(tab, board.tasks.of({ project: "p2", id: "b" }));
  await until(() => p1.get().length > 0 && one.get() !== undefined);
  app.asks.length = 0;

  await tab.run(board.invalidate, { input: { tasks: { project: "p1", id: "a" } } });
  await tab.run(board.invalidate, { input: { tasks: { project: "p9" } } });
  await tab.run(board.invalidate, { input: { tasks: { project: "p2" } } });

  expect(app.asks).toEqual([
    { read: "where", part: { project: "p1", id: "a" } },
    { read: "of", part: { project: "p2", id: "b" } },
  ]);
});

test("the server's invalidate signals each reader whose part it touches", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = where(tab, "p1");
  const p2 = where(tab, "p2");
  await until(() => p1.get().length > 0 && p2.get().length > 0);
  app.asks.length = 0;

  await app.server.run(board.invalidate, { input: { tasks: { project: "p1", id: "a" } } });
  await until(() => app.asks.length > 0);
  await new Promise((done) => setTimeout(done, 30));

  expect(app.asks).toEqual([{ read: "where", part: { project: "p1", id: "a" } }]);
});

test("a string key reads, signals and invalidates one member", async () => {
  const app = await boot();
  const tab = await app.client();
  const red = watch(tab, board.labels.of("red"));
  const blue = watch(tab, board.labels.of("blue"));
  await until(() => red.get() !== undefined);
  app.asks.length = 0;

  await app.paint("#e00");
  await until(() => red.get()?.color === "#e00");
  await tab.run(board.invalidate, { input: { labels: "red" } });
  await app.server.run(board.invalidate, { input: { labels: "green" } });

  expect(app.asks).toEqual([
    { read: "of", part: "red" },
    { read: "of", part: "red" },
  ]);
  expect(blue.get()).toBe(undefined);
});

test("an invalidate parses a raw input: a keyed key, and a flat part", async () => {
  const app = await boot();
  const tab = await app.client();
  const bad = [{ nope: { project: "p1" } }, { tasks: { n: Number.NaN } }, { tasks: { a: [] } }];

  const outcomes = await Promise.allSettled(
    bad.map(async (raw) => tab.run(board.invalidate, { rawInput: raw })),
  );

  expect(outcomes.map((o) => o.status)).toEqual(["rejected", "rejected", "rejected"]);
});

test("the answer for a share leaves the other members of the part", async () => {
  const app = await boot();
  const tab = await app.client();
  const p3 = where(tab, "p3");
  await until(() => p3.get().length === 2);

  await tab.run(board.invalidate, { input: { tasks: { project: "p3", id: "c" } } });

  expect(p3.get()).toEqual([task("p3", "c"), task("p3", "d")]);
});

test("an invalidate that shares no member with a part asks nothing", async () => {
  const app = await boot();
  const tab = await app.client();
  const pair = watch(tab, board.tasks.where({ project: "p1", id: "a" }));
  const one = watch(tab, board.tasks.of({ project: "p2", id: "b" }));
  await until(() => pair.get().length > 0 && one.get() !== undefined);
  app.asks.length = 0;
  const dirty = [{ project: "p1", id: "b" }, "a", { project: "p2", id: "b", extra: "x" }];

  for (const part of dirty) await tab.run(board.invalidate, { rawInput: { tasks: part } });

  expect(app.asks).toEqual([]);
});

test("a string key that starts another one is its own member", async () => {
  const app = await boot();
  const tab = await app.client();
  const red = watch(tab, board.labels.of("red"));
  const re = watch(tab, board.labels.of("re"));
  await until(() => red.get() !== undefined && re.get() !== undefined);

  await app.unpaint("re");
  await until(() => re.get() === undefined);

  expect(red.get()).toEqual({ name: "red", color: "#f00" });
});

test("an invalidate with one key that is not keyed refuses the whole input", async () => {
  const app = await boot();
  const tab = await app.client();

  const mixed = { tasks: { project: "p1" }, nope: { project: "p1" } };

  const run = async (raw: unknown) => tab.run(board.invalidate, { rawInput: raw });

  await expect(run(mixed)).rejects.toThrow("DataValidationFailed");
  await expect(run({ tasks: { project: "p1", a: [] } })).rejects.toThrow("DataValidationFailed");
  await expect(run({ tasks: { project: "p1" } })).resolves.toBe(undefined);
  await expect(run({ tasks: { project: 1 } })).resolves.toBe(undefined);
});

test("an answer for one part wakes no reader of another part", async () => {
  const app = await boot();
  const tab = await app.client();
  const woke: string[] = [];
  const p1 = tab.resolve(board.tasks.where({ project: "p1" }));
  const p2 = tab.resolve(board.tasks.where({ project: "p2" }));
  p1.watch(() => woke.push("p1"));
  p2.watch(() => woke.push("p2"));
  await until(() => p1.get().length > 0 && p2.get().length > 0);
  woke.length = 0;

  await tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });

  expect(woke).toEqual(["p1"]);
});
