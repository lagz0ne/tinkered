import { preset } from "@tinkered/core/testing";
import { expect, expectTypeOf, test } from "vite-plus/test";

import { createScope, data, isError, operation, type Scope } from "@/index";

type Task = { project: string; id: string; title: string };

const asTask = (raw: unknown): Task => {
  const task = raw as Task;
  return { project: task.project, id: task.id, title: task.title };
};

const tasks = data({
  label: "task.items",
  mode: "keyed",
  parse: asTask,
  key: (t) => ({ project: t.project, id: t.id }),
});

const task = (project: string, id: string, title = id): Task => ({ project, id, title });

/** A controller with two projects of two tasks each. */
const seeded = (): Scope.KeyedController<Task, { project: string; id: string }> => {
  const items = createScope().controller(tasks);
  items.set(task("p1", "a"));
  items.set(task("p1", "b"));
  items.set(task("p2", "c"));
  items.set(task("p2", "d"));

  return items;
};

test("a keyed cell starts empty and reads all members in the order they came", () => {
  const items = createScope().controller(tasks);
  const empty = items.get();

  items.set(task("p2", "c"));
  items.set(task("p1", "a"));
  items.set(task("p2", "c", "renamed"));

  expect(empty).toEqual([]);
  expect(items.get()).toEqual([task("p2", "c", "renamed"), task("p1", "a")]);
});

test("of reads one member and where reads the members of a part", () => {
  const items = seeded();

  const one = items.of({ project: "p1", id: "b" }).get();
  const part = items.where({ project: "p2" }).get();
  const none = items.of({ project: "p9", id: "b" }).get();

  expect(one).toEqual(task("p1", "b"));
  expect(part).toEqual([task("p2", "c"), task("p2", "d")]);
  expect(none).toBe(undefined);
});

test("update and delete change one member by its key", () => {
  const items = seeded();

  items.update({ project: "p1", id: "a" }, (t) => ({ ...t, title: "done" }));
  items.delete({ project: "p2", id: "c" });
  items.delete({ project: "p2", id: "gone" });

  expect(items.get()).toEqual([task("p1", "a", "done"), task("p1", "b"), task("p2", "d")]);
});

test("a set and a preset run the member's parse", () => {
  const extra = { ...task("p1", "a"), extra: true } as Task;
  const items = createScope().controller(tasks);
  const seeded = createScope({ presets: [preset(tasks, [extra])] }).controller(tasks);

  items.set(extra);

  expect(items.get()).toEqual([task("p1", "a")]);
  expect(seeded.get()).toEqual([task("p1", "a")]);
});

test("a write wakes the watchers of its member and of its parts, and no other", () => {
  const items = seeded();
  const woke: string[] = [];
  const watch = (name: string, reader: { watch(fn: () => void): () => void }) =>
    reader.watch(() => woke.push(name));
  watch("all", items);
  watch("p1", items.where({ project: "p1" }));
  watch("p2", items.where({ project: "p2" }));
  watch("p1/a", items.of({ project: "p1", id: "a" }));
  watch("p1/b", items.of({ project: "p1", id: "b" }));
  watch("a", items.where({ id: "a" }));
  watch("p1&a", items.where({ id: "a", project: "p1" }));

  items.update({ project: "p1", id: "a" }, (t) => ({ ...t, title: "done" }));

  expect(woke.sort()).toEqual(["a", "all", "p1", "p1&a", "p1/a"]);
});

test("a reader's watcher gets the new and the old member", () => {
  const items = seeded();
  const seen: [Task | undefined, Task | undefined][] = [];
  items.of({ project: "p1", id: "a" }).watch((next, prev) => seen.push([next, prev]));

  items.update({ project: "p1", id: "a" }, (t) => ({ ...t, title: "done" }));
  items.delete({ project: "p1", id: "a" });

  expect(seen).toEqual([
    [task("p1", "a", "done"), task("p1", "a")],
    [undefined, task("p1", "a", "done")],
  ]);
});

test("a delete of a key that is not there wakes no one", () => {
  const items = seeded();
  let woke = 0;
  items.watch(() => woke++);

  items.delete({ project: "p1", id: "gone" });

  expect(woke).toBe(0);
});

test("a stop called twice leaves the other watchers of the part", () => {
  const items = seeded();
  const part = items.where({ project: "p1" });
  const woke: string[] = [];
  const stop = part.watch(() => woke.push("first"));
  part.watch(() => woke.push("second"));
  part.watch(() => woke.push("third"));

  stop();
  stop();
  items.set(task("p1", "z"));

  expect(woke).toEqual(["second", "third"]);
});

test("the last watcher of one part leaving keeps the watchers of another", () => {
  const items = seeded();
  let woke = 0;
  const stop = items.where({ project: "p1" }).watch(() => undefined);
  items.where({ project: "p2" }).watch(() => woke++);

  stop();
  items.set(task("p2", "z"));

  expect(woke).toBe(1);
});

test("a watcher that writes during a write leaves each reader on the last value", () => {
  const items = seeded();
  items.watch((next) => {
    if (next.length === 5 && !next.some((t) => t.title === "chained")) {
      items.set(task("p2", "c", "chained"));
    }
  });
  const seen: string[] = [];
  items.where({ project: "p1" }).watch((next) => seen.push(next.map((t) => t.title).join()));
  items.where({ project: "p2" }).watch((next) => seen.push(next.map((t) => t.title).join()));
  items.of({ project: "p1", id: "a" }).watch(() => seen.push("a"));

  items.set(task("p1", "z"));

  expect(seen.toSorted((x, y) => x.localeCompare(y))).toEqual(["a,b,z", "chained,d"]);
});

test("a reader that stopped watching is not woken", () => {
  const items = seeded();
  let woke = 0;
  const stop = items.where({ project: "p1" }).watch(() => woke++);

  stop();
  stop();
  items.set(task("p1", "z"));

  expect(woke).toBe(0);
});

test("a write of a member equal by eq wakes no one", () => {
  const items = createScope().controller(
    data({
      label: "titles",
      mode: "keyed",
      key: (t: Task) => t.id,
      eq: (a, b) => a.title === b.title,
    }),
  );
  items.set(task("p1", "a"));
  let woke = 0;
  items.watch(() => woke++);

  items.set(task("p2", "a"));

  expect(woke).toBe(0);
});

test("two keys with the same fields in another order name one member", () => {
  const items = createScope().controller(
    data({
      label: "order",
      mode: "keyed",
      key: (t: Task) =>
        t.id === "a" ? { id: t.id, project: t.project } : { project: t.project, id: t.id },
    }),
  );

  items.set(task("p1", "a"));
  items.update({ project: "p1", id: "a" }, (t) => ({ ...t, title: "one" }));

  expect(items.get()).toEqual([task("p1", "a", "one")]);
});

test("an update of a key that is not there raises MissingMember", () => {
  const items = seeded();

  let thrown: unknown;
  try {
    items.update({ project: "p9", id: "a" }, (t) => t);
  } catch (error) {
    thrown = error;
  }

  if (!isError(thrown, "MissingMember")) throw thrown;
  expect(thrown.payload).toEqual({ label: "task.items", key: '[["id","a"],["project","p9"]]' });
});

test("an update whose result has another key raises KeyChanged and writes nothing", () => {
  const items = seeded();
  const before = items.get();

  let thrown: unknown;
  try {
    items.update({ project: "p1", id: "a" }, (t) => ({ ...t, project: "p2" }));
  } catch (error) {
    thrown = error;
  }

  if (!isError(thrown, "KeyChanged")) throw thrown;
  expect(thrown.payload.next).toBe('[["id","a"],["project","p2"]]');
  expect(items.get()).toBe(before);
});

test("a key with a number that is not finite raises InvalidKey", () => {
  const items = createScope().controller(
    data({ mode: "keyed", key: (row: { n: number }) => ({ n: row.n }) }),
  );

  let thrown: unknown;
  try {
    items.set({ n: Number.NaN });
  } catch (error) {
    thrown = error;
  }

  if (!isError(thrown, "InvalidKey")) throw thrown;
  expect(thrown.payload).toEqual({ label: "anon", field: "n" });
});

test("a number and a string with the same text are two keys", () => {
  const ids = data({ mode: "keyed", key: (row: { id: number | string }) => ({ id: row.id }) });
  const items = createScope({ presets: [preset(ids, [{ id: 1 }])] }).controller(ids);

  items.set({ id: "1" });

  expect(items.get()).toEqual([{ id: 1 }, { id: "1" }]);
});

test("a string key reads one member and is named as its JSON text", () => {
  const items = createScope().controller(
    data({ label: "names", mode: "keyed", key: (row: { name: string }) => row.name }),
  );
  items.set({ name: "x" });

  let thrown: unknown;
  try {
    items.update("y", (row) => row);
  } catch (error) {
    thrown = error;
  }

  if (!isError(thrown, "MissingMember")) throw thrown;
  expect(thrown.payload.key).toBe('"y"');
  expect(items.of("x").get()).toEqual({ name: "x" });
});

test("an op reads one member through the controller", () => {
  const items = createScope();
  items.controller(tasks).set(task("p1", "a"));
  const read = operation({
    label: "task.read",
    depends: { items: tasks.controller },
    run: ({ items: ctl }, ctx: { input: { project: string; id: string } }) =>
      ctl.of(ctx.input).get(),
  });

  const found = items.run(read, { input: { project: "p1", id: "a" } });

  expect(found).toEqual(task("p1", "a"));
});

test("a session's write stays in the session, as with a single cell", async () => {
  const root = createScope();
  root.controller(tasks).set(task("p1", "a"));
  const session = root.createSession();
  let woke = 0;
  root
    .controller(tasks)
    .where({ project: "p1" })
    .watch(() => woke++);

  session.controller(tasks).set(task("p1", "b"));

  expect(session.controller(tasks).where({ project: "p1" }).get()).toHaveLength(2);
  expect(root.controller(tasks).get()).toEqual([task("p1", "a")]);
  expect(woke).toBe(0);
  await session.close();
});

test("a preset seeds the members", () => {
  const scope = createScope({ presets: [preset(tasks, [task("p1", "a")])] });

  const found = scope.controller(tasks).of({ project: "p1", id: "a" }).get();

  expect(found).toEqual(task("p1", "a"));
});

test("the types refuse no key, an initial, and a part field not in the key", () => {
  const ok = () => data({ initial: 0 });
  // @ts-expect-error a keyed cell needs a key
  const noKey = () => data({ mode: "keyed", parse: asTask });
  const withInitial = () =>
    // @ts-expect-error a keyed cell starts empty
    data({ mode: "keyed", key: (t: Task) => t.id, initial: [] });
  const where = (items: Scope.KeyedController<Task, { project: string; id: string }>) =>
    // @ts-expect-error title is not a field of the key
    items.where({ title: "x" });

  expectTypeOf(ok).returns.toEqualTypeOf<ReturnType<typeof data<number>>>();
  expectTypeOf(noKey).toBeFunction();
  expectTypeOf(withInitial).toBeFunction();
  expectTypeOf(where).toBeFunction();
});

test("a read on the cell names the part, and a part in use keeps one reader", () => {
  const items = seeded();
  const read = tasks.where({ project: "p1" });
  const before = items.where({ project: "p1" });
  const stop = before.watch(() => undefined);

  const during = items.where({ project: "p1" });
  stop();
  const after = items.where({ project: "p1" });

  expect([read.cell, read.read, read.part]).toEqual([tasks, "where", { project: "p1" }]);
  expect(during).toBe(before);
  expect(after).not.toBe(before);
});

test("an of and a where of one full key are two readers", () => {
  const items = seeded();
  const key = { project: "p1", id: "a" };
  items.of(key).watch(() => undefined);

  const part = items.where(key);
  part.watch(() => undefined);

  expect(part.get()).toEqual([task("p1", "a")]);
  expect(items.of(key).get()).toEqual(task("p1", "a"));
});
