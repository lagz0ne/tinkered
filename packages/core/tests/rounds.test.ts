import { expect, test } from "vite-plus/test";

import { createScope, data, derived, isError, namespace, operation, resource } from "@/main";

/** The error `fn` raised, so a test reads it the way a caller does. */
const caught = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

test("a watcher that writes: a later watcher hears the writes in the order they were made", () => {
  const cell = data({ label: "rounds.order", initial: 0 });
  const count = createScope().controller(cell);
  const heard: [number, number][] = [];
  count.watch((next) => {
    if (next === 1) count.set(2);
  });
  count.watch((next, prev) => heard.push([prev, next]));

  count.set(1);

  expect(heard).toEqual([
    [0, 1],
    [1, 2],
  ]);
  expect(count.get()).toBe(2);
});

test("a write in a round keeps its value at once", () => {
  const cell = data({ label: "rounds.value", initial: 0 });
  const count = createScope().controller(cell);
  let read = -1;
  count.watch((next) => {
    if (next !== 1) return;
    count.set(2);
    read = count.get();
  });

  count.set(1);

  expect(read).toBe(2);
});

test("a watcher that corrects a value stops by itself", () => {
  const cell = data({ label: "rounds.clamp", initial: 0 });
  const count = createScope().controller(cell);
  let calls = 0;
  count.watch((next) => {
    calls++;
    if (next > 10) count.set(10);
  });

  count.set(99);

  expect(calls).toBe(2);
  expect(count.get()).toBe(10);
});

test("a watcher that writes its own cell without end raises UpdateDepth with the cells", () => {
  const cell = data({ label: "rounds.self", initial: 0 });
  const count = createScope().controller(cell);
  let calls = 0;
  count.watch((next) => {
    calls++;
    count.set(next + 1);
  });

  const error = caught(() => count.set(1));

  if (!isError(error, "UpdateDepth")) throw error;
  expect(error.payload.depth).toBe(101);
  expect(error.payload.cells.at(-1)).toBe("rounds.self");
  expect(calls).toBe(101);
});

test("two cells that write each other raise UpdateDepth, and the error names both", () => {
  const left = data({ label: "rounds.left", initial: 0 });
  const right = data({ label: "rounds.right", initial: 0 });
  const scope = createScope();
  const a = scope.controller(left);
  const b = scope.controller(right);
  a.watch((next) => b.set(next + 1));
  b.watch((next) => a.set(next + 1));

  const error = caught(() => a.set(1));

  if (!isError(error, "UpdateDepth")) throw error;
  expect(new Set(error.payload.cells)).toEqual(new Set(["rounds.left", "rounds.right"]));
});

test("the write after an UpdateDepth runs a new chain", () => {
  const cell = data({ label: "rounds.again", initial: 0 });
  const count = createScope().controller(cell);
  let loop = true;
  const heard: number[] = [];
  count.watch((next) => {
    heard.push(next);
    if (loop) count.set(next + 1);
  });
  caught(() => count.set(1));
  loop = false;
  heard.length = 0;

  count.set(1000);

  expect(heard).toEqual([1000]);
});

test("one watcher that writes many cells is one write deep, not a chain", () => {
  const first = data({ label: "rounds.fan", initial: 0 });
  const cells = Array.from({ length: 500 }, (_, at) =>
    data({ label: `rounds.fan.${at}`, initial: 0 }),
  );
  const scope = createScope();
  let told = 0;
  for (const each of cells) scope.controller(each).watch(() => told++);
  scope.controller(first).watch((next) => {
    for (const each of cells) scope.controller(each).set(next);
  });

  scope.controller(first).set(1);

  expect(told).toBe(500);
});

test("a chain 100 writes deep ends without an error", () => {
  const cell = data({ label: "rounds.limit", initial: 0 });
  const count = createScope().controller(cell);
  count.watch((next) => {
    if (next < 101) count.set(next + 1);
  });

  count.set(1);

  expect(count.get()).toBe(101);
});

test("a namespaced write in a round waits for the round too", () => {
  const ns = namespace();
  const cell = data({ label: "rounds.ns", initial: 0 });
  const scope = createScope();
  const count = scope.controller(cell, { ns });
  const heard: [number, number][] = [];
  count.watch((next) => {
    if (next === 1) count.set(2);
  });
  count.watch((next, prev) => heard.push([prev, next]));

  count.set(1);

  expect(heard).toEqual([
    [0, 1],
    [1, 2],
  ]);
});

test("a release in a round waits for the round too", () => {
  const cell = data({ label: "rounds.release", initial: 0 });
  const scope = createScope();
  const count = scope.controller(cell);
  const heard: [number, number][] = [];
  count.watch((next) => {
    if (next === 1) scope.release(cell);
  });
  count.watch((next, prev) => heard.push([prev, next]));

  count.set(1);

  expect(heard).toEqual([
    [0, 1],
    [1, 0],
  ]);
});

test("a keyed part's watcher that writes: the other part hears each write in order", () => {
  type Task = { project: string; id: string; title: string };
  const tasks = data({
    label: "rounds.tasks",
    mode: "keyed",
    key: (task: Task) => ({ project: task.project, id: task.id }),
  });
  const items = createScope().controller(tasks);
  const heard: string[] = [];
  items.where({ project: "a" }).watch((next) => {
    if (next.length === 1) items.set({ project: "a", id: "2", title: "second" });
  });
  items.where({ project: "a" }).watch((next) => heard.push(next.map((t) => t.title).join()));

  items.set({ project: "a", id: "1", title: "first" });

  expect(heard).toEqual(["first", "first,second"]);
});

test("a derived's watcher that writes a source: a later watcher hears the values in order", () => {
  const cell = data({ label: "rounds.source", initial: 0 });
  const double = derived({
    label: "rounds.double",
    depends: { cell },
    factory: ({ cell }) => cell * 2,
  });
  const scope = createScope();
  const reader = scope.resolve(double);
  const heard: [unknown, unknown][] = [];
  reader.watch((next) => {
    if (next === 2) scope.controller(cell).set(2);
  });
  reader.watch((next, prev) => heard.push([prev, next]));

  scope.controller(cell).set(1);

  expect(heard).toEqual([
    [0, 2],
    [2, 4],
  ]);
});

test("a derived whose factory writes a cell is a fault named WriteInDerived, after one compute", () => {
  const rows = data({ label: "rounds.rows", initial: 0 });
  let computes = 0;
  const bump = operation({
    label: "rounds.bump",
    depends: { rows: rows.controller },
    run: ({ rows }) => rows.set(rows.get() + 1),
  });
  const loop = derived({
    label: "rounds.loop",
    depends: { rows, bump },
    factory: ({ rows, bump }) => {
      computes++;
      bump.run();
      return rows;
    },
  });
  const scope = createScope();

  const error = caught(() => scope.resolve(loop).get());

  if (!isError(error, "WriteInDerived")) throw error;
  expect(error.payload).toEqual({ derived: "rounds.loop", cell: "rounds.rows" });
  expect(computes).toBe(1);
  expect(scope.controller(rows).get()).toBe(0);
});

test("a derived whose factory writes a cell it does not read is a fault too", () => {
  const rows = data({ label: "rounds.read", initial: 0 });
  const log = data({ label: "rounds.log", initial: 0 });
  const note = operation({
    label: "rounds.note",
    depends: { log: log.controller },
    run: ({ log }) => log.set(log.get() + 1),
  });
  const noisy = derived({
    label: "rounds.noisy",
    depends: { rows, note },
    factory: ({ rows, note }) => {
      note.run();
      return rows;
    },
  });

  const error = caught(() => createScope().resolve(noisy).get());

  if (!isError(error, "WriteInDerived")) throw error;
  expect(error.payload.cell).toBe("rounds.log");
});

test("a write after a derived's compute is a plain write again", () => {
  const rows = data({ label: "rounds.after", initial: 1 });
  const twice = derived({
    label: "rounds.twice",
    depends: { rows },
    factory: ({ rows }) => rows * 2,
  });
  const scope = createScope();

  expect(scope.resolve(twice).get()).toBe(2);
  scope.controller(rows).set(5);

  expect(scope.resolve(twice).get()).toBe(10);
});

test("a derived that reads another derived computes inside the outer one, and neither writes", () => {
  const rows = data({ label: "rounds.inner", initial: 1 });
  const inner = derived({
    label: "rounds.inner.twice",
    depends: { rows },
    factory: ({ rows }) => rows * 2,
  });
  const outer = derived({
    label: "rounds.outer",
    depends: { inner },
    factory: ({ inner }) => inner.get() + 1,
  });
  const scope = createScope();

  expect(scope.resolve(outer).get()).toBe(3);
  scope.controller(rows).set(2);

  expect(scope.resolve(outer).get()).toBe(5);
});

test("a derived that waits for a build tells its watchers in a round when the build settles", async () => {
  const cell = data({ label: "rounds.park.cell", initial: 0 });
  const slow = resource({
    label: "rounds.slow",
    factory: async () => {
      await Promise.resolve();
      return 7;
    },
  });
  const parked = derived({
    label: "rounds.parked",
    depends: { slow, cell },
    factory: ({ slow, cell }) => slow + cell,
  });
  const scope = createScope();
  const reader = scope.resolve(parked);
  const heard: [unknown, unknown][] = [];
  reader.watch((next) => {
    if (next === 7) scope.controller(cell).set(1);
  });
  reader.watch((next, prev) => heard.push([prev, next]));

  await scope.resolve(slow);
  await Promise.resolve();
  await Promise.resolve();

  expect(heard).toEqual([
    [undefined, 7],
    [7, 8],
  ]);
  await scope.close();
});

test("a watcher that writes and then throws: the write's watchers are told, the writer gets the error", () => {
  const first = data({ label: "rounds.throw.first", initial: 0 });
  const second = data({ label: "rounds.throw.second", initial: 0 });
  const scope = createScope();
  const heard: number[] = [];
  scope.controller(second).watch((next) => heard.push(next));
  scope.controller(first).watch((next) => {
    scope.controller(second).set(next);
    throw new Error("watcher failed");
  });

  const error = caught(() => scope.controller(first).set(1));

  expect(error).toEqual(new Error("watcher failed"));
  expect(heard).toEqual([1]);
});

test("the first of two watcher errors goes to the writer", () => {
  const first = data({ label: "rounds.errors.first", initial: 0 });
  const second = data({ label: "rounds.errors.second", initial: 0 });
  const scope = createScope();
  scope.controller(second).watch(() => {
    throw new Error("second failed");
  });
  scope.controller(first).watch((next) => {
    scope.controller(second).set(next);
    throw new Error("first failed");
  });

  const error = caught(() => scope.controller(first).set(1));

  expect(error).toEqual(new Error("first failed"));
});

test("a namespaced watcher that writes and then throws: the write's watchers are told, the writer gets the error", () => {
  const ns = namespace();
  const first = data({ label: "rounds.ns.throw.first", initial: 0 });
  const second = data({ label: "rounds.ns.throw.second", initial: 0 });
  const scope = createScope();
  const heard: number[] = [];
  scope.controller(second, { ns }).watch((next) => heard.push(next));
  scope.controller(first, { ns }).watch((next) => {
    scope.controller(second, { ns }).set(next);
    throw new Error("ns watcher failed");
  });

  const error = caught(() => scope.controller(first, { ns }).set(1));

  expect(error).toEqual(new Error("ns watcher failed"));
  expect(heard).toEqual([1]);
});

test("after a watcher throws, the next write tells its watchers at once", () => {
  const ns = namespace();
  const plain = data({ label: "rounds.after.plain", initial: 0 });
  const named = data({ label: "rounds.after.named", initial: 0 });
  const scope = createScope();
  const heard: string[] = [];
  let fail = true;
  for (const [label, control] of [
    ["plain", scope.controller(plain)],
    ["named", scope.controller(named, { ns })],
  ] as const) {
    control.watch((next) => {
      heard.push(`${label} ${next}`);
      if (fail) throw new Error(label);
    });
  }

  const errors = [
    caught(() => scope.controller(plain).set(1)),
    caught(() => scope.controller(named, { ns }).set(1)),
  ];
  fail = false;
  scope.controller(plain).set(2);
  scope.controller(named, { ns }).set(2);

  expect(errors).toEqual([new Error("plain"), new Error("named")]);
  expect(heard).toEqual(["plain 1", "named 1", "plain 2", "named 2"]);
});

test("a watcher that throws inside a waiting round: the rounds after it still run", () => {
  const first = data({ label: "rounds.wait.first", initial: 0 });
  const second = data({ label: "rounds.wait.second", initial: 0 });
  const third = data({ label: "rounds.wait.third", initial: 0 });
  const scope = createScope();
  const heard: string[] = [];
  scope.controller(second).watch((next) => {
    heard.push(`second ${next}`);
    throw new Error("second failed");
  });
  scope.controller(third).watch((next) => heard.push(`third ${next}`));
  scope.controller(first).watch((next) => {
    scope.controller(second).set(next);
    scope.controller(third).set(next);
  });

  const error = caught(() => scope.controller(first).set(1));

  expect(error).toEqual(new Error("second failed"));
  expect(heard).toEqual(["second 1", "third 1"]);
});
