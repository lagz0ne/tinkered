import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, resource, transport } from "@/main";
import type { Data, Observe, Scope } from "@/main";

const { hook } = transport;

// The six cases of ADR 0137 that make a reader stale, with a store that answers late. The board
// has a load, so the store is the truth: the server keeps no member.

type Task = { project: string; id: string; title: string };

const Task = z.object({ project: z.string(), id: z.string(), title: z.string() });

const tasks = data({
  label: "task.items",
  mode: "keyed",
  parse: Task,
  key: (t) => ({ project: t.project, id: t.id }),
});

type Label = { name: string; color: string };

const labels = data({ label: "labels", mode: "keyed", key: (l: Label) => l.name });

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
 * A store with notices, as an outbox: each write adds one, unless the write is quiet (a notice
 * lost while the server was down). `slow()` makes the next read take its rows now and answer
 * only at `release`, as a query that answers late.
 */
const store = () => {
  const rows = new Map<string, Task>();
  const listeners = new Set<(t: Task) => void>();
  let gate: { reached: boolean; release: () => void; wait: Promise<void> } | undefined;

  return {
    rows,
    write(t: Task, quiet = false) {
      rows.set(`${t.project}/${t.id}`, t);
      if (!quiet) for (const listen of listeners) listen(t);
    },
    async read(project: string) {
      const now = [...rows.values()].filter((t) => t.project === project);
      const held = gate;
      gate = undefined;
      if (held) {
        held.reached = true;
        await held.wait;
      }
      return now;
    },
    notices: (listen: (t: Task) => void) => listeners.add(listen),
    slow() {
      let release = () => undefined as void;
      const wait = new Promise<void>((done) => (release = done));
      gate = { reached: false, release, wait };
      return gate;
    },
  };
};

async function boot() {
  const db = store();
  db.write(task("p1", "a"));
  db.write(task("p2", "b"));
  const seen: unknown[] = [];

  const loadTasks = operation({
    label: "tasks.load",
    input: z.object({ project: z.string() }),
    run: (_, { input }) => db.read(input.project),
  });
  const guard = operation({
    label: "guard",
    input: hook.start,
    run: (_, { input }) => void seen.push(input.input),
  });
  const failing = operation({
    label: "tasks.add.failing",
    input: Task,
    run: (_, { input }) => {
      db.write(input);
      throw new Error("after the commit");
    },
  });
  const paint = operation({
    label: "labels.set",
    input: z.object({ name: z.string(), color: z.string() }),
    depends: { list: labels.controller },
    run: ({ list }, { input }) => list.set(input),
  });
  const setOnCell = operation({
    label: "tasks.set",
    input: Task,
    depends: { items: tasks.controller },
    run: ({ items }, { input }) => items.set(input),
  });

  const server = await createScope({
    capsules: [
      board({ serve: true, load: { tasks: loadTasks }, onStart: [guard] }),
      memory.server({ services: [board] }),
    ],
  }).ready;
  closers.push(() => server.close());

  // The projector: one invalidate per notice of the store (ADR 0138).
  db.notices((t) => {
    void server.run(board.invalidate, { input: { tasks: { project: t.project, id: t.id } } });
  });

  const client = async () => {
    const scope = await createScope({
      capsules: [memory.client({ peer: server }), board({ read: memory.client })],
    }).ready;
    closers.push(() => scope.close());
    return scope;
  };
  const kept = () => [server.controller(tasks).get(), server.resolve(board.tasks).get()];
  return { server, client, db, seen, kept, failing, setOnCell, paint };
}

/** A reader kept in use until `stop`. */
const watch = <T>(scope: Scope.Handle, read: Data.Read<T>) => {
  const reader = scope.resolve(read);
  return { get: () => reader.get(), stop: reader.watch(() => undefined) };
};

const titles = (list: readonly Task[]) => list.map((t) => t.title);

test("1: a write that lands during the first load of a part", async () => {
  const app = await boot();
  const tab = await app.client();
  const late = app.db.slow();

  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => late.reached);
  app.db.write(task("p1", "a", "new"));
  await until(() => titles(p1.get())[0] === "new");
  late.release();
  await new Promise((done) => setTimeout(done, 30));

  expect(p1.get()).toEqual([task("p1", "a", "new")]);
  expect(app.kept()).toEqual([[], []]);
});

test("2: an op that fails after the store commit", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);

  const failed = await Promise.resolve()
    .then(() => app.server.run(app.failing, { input: task("p1", "c") }))
    .then(
      () => false,
      () => true,
    );
  await until(() => p1.get().length === 2);

  expect(failed).toBe(true);
  expect(app.kept()).toEqual([[], []]);
});

test("3: a second process writes the store and calls nothing", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);

  app.db.write(task("p1", "a", "elsewhere"));
  await until(() => titles(p1.get())[0] === "elsewhere");

  expect(app.kept()).toEqual([[], []]);
});

test("4: the only reader leaves, a write occurs, the reader returns", async () => {
  const app = await boot();
  const tab = await app.client();
  const first = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => first.get().length > 0);

  first.stop();
  app.db.write(task("p1", "a", "while away"));
  const back = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => titles(back.get())[0] === "while away");

  expect(app.kept()).toEqual([[], []]);
});

test("5: the link drops while the server misses a notice, then the reader returns", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);

  app.db.write(task("p1", "a", "missed"), true);
  await app.server.run(board.drop);
  await until(() => titles(p1.get())[0] === "missed");

  expect(app.kept()).toEqual([[], []]);
});

test("6: two answers arrive in the wrong order", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);

  const late = app.db.slow();
  const first = tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  await until(() => late.reached);
  app.db.write(task("p1", "a", "second"), true);
  await tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  late.release();
  await first;

  expect(p1.get()).toEqual([task("p1", "a", "second")]);
  expect(app.kept()).toEqual([[], []]);
});

test("an ask for a part with fewer fields than the load needs is refused before the guard", async () => {
  const app = await boot();
  const tab = await app.client();

  watch(tab, board.tasks.where({ id: "a" }));
  await until(() => tab.resolve(board.faults).get().tasks !== undefined);

  expect(tab.resolve(board.faults).get().tasks).toMatchObject({ fault: "refused" });
  expect(app.seen).toEqual([]);
});

test("a reader of one member gets it from a load that takes the project", async () => {
  const app = await boot();
  app.db.write(task("p1", "c"));
  const tab = await app.client();

  const one = watch(tab, board.tasks.of({ project: "p1", id: "c" }));
  await until(() => one.get() !== undefined);

  expect(one.get()).toEqual(task("p1", "c"));
  expect(tab.resolve(board.tasks).get()).toEqual([task("p1", "c")]);
});

test("a set on a loaded cell marks its member dirty and keeps nothing", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);
  app.db.write(task("p1", "d"), true);

  await app.server.run(app.setOnCell, { input: task("p1", "d") });
  await until(() => p1.get().length === 2);

  expect(app.seen).toContainEqual({ read: "of", part: { project: "p1", id: "d" } });
  expect(app.kept()).toEqual([[], []]);
});

test("an empty part marks every part in use dirty, as after a cut log", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  const p2 = watch(tab, board.tasks.where({ project: "p2" }));
  await until(() => p1.get().length > 0 && p2.get().length > 0);
  app.db.write(task("p1", "a", "cut"), true);
  app.db.write(task("p2", "b", "cut"), true);

  await app.server.run(board.invalidate, { input: { tasks: {} } });
  await until(() => titles(p1.get())[0] === "cut" && titles(p2.get())[0] === "cut");

  expect(app.kept()).toEqual([[], []]);
});

test("an ask from the wire with fewer fields is refused with its part, before the guard", async () => {
  const app = await boot();

  const reply = await app.server.run(board.answer, {
    input: { address: "tasks.ask", value: { read: "where", part: { id: "a" } }, meta: {} },
  });

  expect(reply).toEqual({ ok: false, kind: "refused", payload: { part: { id: "a" } } });
  expect(app.seen).toEqual([]);
});

test("a keyed cell with no load on the same board serves its cell", async () => {
  const app = await boot();
  await app.server.run(app.paint, { input: { name: "red", color: "#f00" } });
  const tab = await app.client();

  const red = watch(tab, board.labels.of("red"));
  await until(() => red.get() !== undefined);

  expect(red.get()).toEqual({ name: "red", color: "#f00" });
  expect(app.server.controller(labels).get()).toEqual([{ name: "red", color: "#f00" }]);
});

test("an invalidate resolves only after a later ask that shares its members", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);

  const one = app.db.slow();
  const first = tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  await until(() => one.reached);
  app.db.write(task("p1", "a", "later"), true);
  const two = app.db.slow();
  void tab.run(board.invalidate, { input: { tasks: { project: "p1", id: "a" } } });
  await until(() => two.reached);
  let settled = false;
  void first.then(() => (settled = true));
  one.release();
  await new Promise((done) => setTimeout(done, 30));
  const early = settled;
  two.release();
  await first;

  expect(early).toBe(false);
  expect(p1.get()).toEqual([task("p1", "a", "later")]);
});

test("a member from the load that does not parse is an invalid fault on the client", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);

  app.db.rows.set("p1/z", { project: "p1", id: "z" } as Task);
  await tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });

  expect(tab.resolve(board.faults).get().tasks).toMatchObject({
    fault: "invalid",
    payload: { side: "client" },
  });
  expect(p1.get()).toEqual([task("p1", "a")]);
});

test("a load runs in a session of its own, closed when it returns", async () => {
  const events: string[] = [];
  // As Hedl's transaction: a session resource, begun on first use and ended at session close.
  const turn = resource({
    label: "turn",
    target: "session",
    factory: (_deps, ctx) => {
      events.push("begin");
      ctx.defer(() => void events.push("end"));
      return {};
    },
  });
  const loadTasks = operation({
    label: "tasks.load.turn",
    input: z.object({ project: z.string() }),
    depends: { turn },
    run: (_, { input }) => [task(input.project, "a")],
  });
  const server = await createScope({
    capsules: [
      board({ serve: true, load: { tasks: loadTasks } }),
      memory.server({ services: [board] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), board({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => p1.get().length > 0);
  await until(() => events.length === 2);

  expect(events).toEqual(["begin", "end"]);
});

test("a reader that leaves while its part loads ends quietly: no bug log, no fault", async () => {
  const db = store();
  const loadTasks = operation({
    label: "tasks.load",
    input: z.object({ project: z.string() }),
    run: (_, { input }) => db.read(input.project),
  });
  const server = await createScope({
    capsules: [
      board({ serve: true, load: { tasks: loadTasks } }),
      memory.server({ services: [board] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const logs: Observe.Log[] = [];
  const tab = await createScope({
    observe: { log: (entry) => void logs.push(entry) },
    capsules: [memory.client({ peer: server }), board({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());
  const late = db.slow();

  const p1 = watch(tab, board.tasks.where({ project: "p1" }));
  await until(() => late.reached);
  p1.stop();
  await new Promise((done) => setTimeout(done, 30));
  late.release();
  await new Promise((done) => setTimeout(done, 30));

  expect(logs.map((l) => l.message)).toEqual([]);
  expect(tab.resolve(board.faults).get()).toEqual({});
});
