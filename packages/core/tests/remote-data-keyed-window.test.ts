import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData } from "@/main";
import type { Data, Scope } from "@/main";

// A window in a keyed read (ADR 0139 2): the store sorts and cuts, Core passes the window.

type Task = { project: string; id: string; created: number };

const tasks = data({
  label: "window.tasks",
  mode: "keyed",
  key: (t: Task) => ({ project: t.project, id: t.id }),
});

const board = remoteData({ tasks });

const task = (project: string, id: string, created: number): Task => ({ project, id, created });

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

const newest = { order: "-created", limit: 2 };

async function boot() {
  const rows = new Map<string, Task>();
  const asked: unknown[] = [];
  let gate: Promise<void> | undefined;
  const hold = () => {
    let open = () => undefined as void;
    gate = new Promise<void>((done) => (open = done));
    return () => {
      gate = undefined;
      open();
    };
  };
  const loadTasks = operation({
    label: "window.load",
    input: z.object({
      project: z.string(),
      order: z.enum(["-created"]).optional(),
      limit: z.number().max(50).optional(),
    }),
    run: async (_, { input }) => {
      asked.push(input);
      await gate;
      const all = [...rows.values()].filter((t) => t.project === input.project);
      if (input.order) all.sort((a, b) => b.created - a.created);
      return input.limit === undefined ? all : all.slice(0, input.limit);
    },
  });

  const server = await createScope({
    capsules: [
      board({ serve: true, load: { tasks: loadTasks } }),
      memory.server({ services: [board] }),
    ],
  }).ready;
  closers.push(() => server.close());

  const write = (t: Task) => {
    rows.set(`${t.project}/${t.id}`, t);
    void server.run(board.invalidate, { input: { tasks: { project: t.project, id: t.id } } });
  };
  rows.set("p1/a", task("p1", "a", 1));
  rows.set("p1/b", task("p1", "b", 2));
  rows.set("p1/c", task("p1", "c", 3));
  rows.set("p2/d", task("p2", "d", 4));

  const client = async () => {
    const scope = await createScope({
      capsules: [memory.client({ peer: server }), board({ read: memory.client })],
    }).ready;
    closers.push(() => scope.close());
    return scope;
  };
  return { server, client, write, rows, asked, hold };
}

/** A reader kept in use until `stop`. */
const watch = <T>(scope: Scope.Handle, read: Data.Read<T>) => {
  const reader = scope.resolve(read);
  return { get: () => reader.get(), stop: reader.watch(() => undefined) };
};

const ids = (list: readonly Task[]) => list.map((t) => t.id);

test("a window reads the store's order and limit, and load gets the part and the window", async () => {
  const app = await boot();
  const tab = await app.client();

  const top = watch(tab, board.tasks.where({ project: "p1" }, newest));
  await until(() => top.get().length > 0);

  expect(ids(top.get())).toEqual(["c", "b"]);
  expect(app.asked).toEqual([{ project: "p1", order: "-created", limit: 2 }]);
  expect(
    tab.resolve(board.status(board.tasks.where({ project: "p1" }, newest))).get(),
  ).toMatchObject({
    status: "ready",
  });
});

test("a write in the part asks the window again: a new member comes in, the oldest goes out", async () => {
  const app = await boot();
  const tab = await app.client();
  const top = watch(tab, board.tasks.where({ project: "p1" }, newest));
  await until(() => top.get().length > 0);

  app.write(task("p1", "e", 9));
  await until(() => ids(top.get())[0] === "e");

  expect(ids(top.get())).toEqual(["e", "c"]);
  expect(app.asked.at(-1)).toEqual({ project: "p1", order: "-created", limit: 2 });
});

test("a write in another part does not ask the window again", async () => {
  const app = await boot();
  const tab = await app.client();
  const top = watch(tab, board.tasks.where({ project: "p1" }, newest));
  await until(() => top.get().length > 0);

  app.write(task("p2", "f", 9));
  await new Promise((done) => setTimeout(done, 30));

  expect(app.asked).toHaveLength(1);
});

test("a window and its whole part are two reads: neither rides the other", async () => {
  const app = await boot();
  const tab = await app.client();
  const whole = watch(tab, board.tasks.where({ project: "p1" }));
  const top = watch(tab, board.tasks.where({ project: "p1" }, newest));
  await until(() => whole.get().length === 3 && top.get().length === 2);

  expect(ids(whole.get())).toEqual(["a", "b", "c"]);
  expect(ids(top.get())).toEqual(["c", "b"]);
  expect(app.asked).toContainEqual({ project: "p1" });
  expect(app.asked).toContainEqual({ project: "p1", order: "-created", limit: 2 });
});

test("two windows of one part keep two lists", async () => {
  const app = await boot();
  const tab = await app.client();
  const two = watch(tab, board.tasks.where({ project: "p1" }, newest));
  const one = watch(tab, board.tasks.where({ project: "p1" }, { order: "-created", limit: 1 }));
  await until(() => two.get().length === 2 && one.get().length === 1);

  expect(ids(two.get())).toEqual(["c", "b"]);
  expect(ids(one.get())).toEqual(["c"]);
});

test("an invalidate of the part asks each window of it again", async () => {
  const app = await boot();
  const tab = await app.client();
  const two = watch(tab, board.tasks.where({ project: "p1" }, newest));
  const one = watch(tab, board.tasks.where({ project: "p1" }, { order: "-created", limit: 1 }));
  await until(() => two.get().length === 2 && one.get().length === 1);

  app.rows.set("p1/g", task("p1", "g", 7));
  await app.server.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  await until(() => ids(two.get())[0] === "g" && ids(one.get())[0] === "g");

  expect(ids(two.get())).toEqual(["g", "c"]);
  expect(ids(one.get())).toEqual(["g"]);
});

test("a member that leaves the window stays for a reader of its key", async () => {
  const app = await boot();
  const tab = await app.client();
  const top = watch(tab, board.tasks.where({ project: "p1" }, newest));
  const b = watch(tab, board.tasks.of({ project: "p1", id: "b" }));
  await until(() => top.get().length > 0 && b.get() !== undefined);

  app.write(task("p1", "e", 9));
  await until(() => ids(top.get())[0] === "e");

  expect(b.get()).toEqual(task("p1", "b", 2));
});

test("the last reader of a window leaves: its members go from the cell", async () => {
  const app = await boot();
  const tab = await app.client();
  const top = watch(tab, board.tasks.where({ project: "p1" }, newest));
  await until(() => top.get().length > 0);

  top.stop();

  expect(tab.resolve(board.tasks).get()).toEqual([]);
  expect(tab.resolve(board.tasks.where({ project: "p1" }, newest)).get()).toEqual([]);
});

test("an empty window empties its part in the cell", async () => {
  const app = await boot();
  const tab = await app.client();
  const top = watch(tab, board.tasks.where({ project: "p1" }, newest));
  await until(() => top.get().length > 0);

  app.rows.clear();
  await app.server.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  await until(() => top.get().length === 0);

  expect(tab.resolve(board.tasks).get()).toEqual([]);
});

test("a window that the load's input does not take is refused", async () => {
  const app = await boot();
  const tab = await app.client();
  const read = board.tasks.where({ project: "p1" }, { order: "-created", limit: 500 });
  const top = watch(tab, read);
  const state = tab.resolve(board.status(read));
  await until(() => state.get()?.status === "fault");

  expect(state.get()).toMatchObject({ status: "fault", fault: { fault: "refused" } });
  expect(top.get()).toEqual([]);
});

test("a board with no load cannot sort: a window fails", async () => {
  const items = data({
    label: "window.served",
    mode: "keyed",
    key: (t: Task) => ({ project: t.project, id: t.id }),
  });
  const served = remoteData({ items });
  const server = await createScope({
    capsules: [served({ serve: true }), memory.server({ services: [served] })],
  }).ready;
  closers.push(() => server.close());
  server.controller(items).set(task("p1", "a", 1));
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), served({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  const read = served.items.where({ project: "p1" }, newest);
  const top = watch(tab, read);
  const state = tab.resolve(served.status(read));
  await until(() => state.get()?.status === "fault");

  expect(state.get()).toMatchObject({ status: "fault", fault: { fault: "failed" } });
  expect(top.get()).toEqual([]);
});

test("a window that comes back shows no rows until its new answer", async () => {
  const app = await boot();
  const tab = await app.client();
  const b = watch(tab, board.tasks.of({ project: "p1", id: "b" }));
  const first = watch(tab, board.tasks.where({ project: "p1" }, newest));
  await until(() => first.get().length === 2 && b.get() !== undefined);

  first.stop();
  const open = app.hold();
  const back = watch(tab, board.tasks.where({ project: "p1" }, newest));
  const shown = back.get();
  open();
  await until(() => back.get().length === 2);

  expect(shown).toEqual([]);
  expect(ids(back.get())).toEqual(["c", "b"]);
});

test.each([
  ["a string", "newest"],
  ["a nested value", { order: { by: "created" } }],
])("a window that is %s never leaves the client", async (_, window) => {
  const app = await boot();
  const tab = await app.client();
  const read = board.tasks.where({ project: "p1" }, window as never);
  const top = watch(tab, read);
  const state = tab.resolve(board.status(read));
  await until(() => state.get()?.status === "fault");

  expect(state.get()).toMatchObject({ status: "fault", fault: { from: "local" } });
  expect(top.get()).toEqual([]);
  expect(app.asked).toEqual([]);
});
