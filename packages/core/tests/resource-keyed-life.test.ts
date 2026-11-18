import { expect, test } from "vite-plus/test";

import { createScope, data, isError, operation, resource, tag } from "@/main";

type Task = { project: string; id: string; done: boolean };

const tasks = data({
  label: "life.tasks",
  mode: "keyed",
  key: (t: Task) => ({ project: t.project, id: t.id }),
});

const project = tag<string>({ label: "life.project" });
const log: string[] = [];

/** One unit: keyed by config, follows its source, has a lifecycle, is a span. */
const open = resource({
  label: "life.open",
  config: { project: project.required },
  depends: (c) => ({ rows: tasks.where({ project: c.project }) }),
  factory: ({ rows }, { config, defer }) => {
    log.push(`build ${config.project}`);
    defer(() => void log.push(`end ${config.project}`));
    return rows.get().filter((t) => !t.done).length;
  },
});

/** An operation depends on it, as on any resource. */
const count = operation({
  label: "life.count",
  depends: { open: open({ project: "p" }) },
  run: ({ open }) => open.get(),
});

test("a resource with config is keyed, follows its source, ends, and is a span an op can read", async () => {
  const spans: string[] = [];
  const scope = createScope({ observe: { export: (s) => void spans.push(`${s.kind} ${s.name}`) } });
  const list = scope.controller(tasks);
  list.set({ project: "p", id: "1", done: false });

  const reader = scope.resolve(open({ project: "p" }));
  const heard: number[] = [];
  const stop = reader.watch((n) => void heard.push(n));
  expect(reader.get()).toBe(1);
  expect(scope.resolve(open({ project: "q" })).get()).toBe(0);

  list.set({ project: "p", id: "2", done: false });
  expect(heard).toEqual([2]);
  expect(await scope.run(count)).toBe(2);

  stop();
  expect(log).toEqual(["build p", "build q", "end p", "build p", "end p"]);
  expect(spans).toEqual([
    "resource life.open",
    "resource life.open",
    "resource life.open",
    "operation life.count",
  ]);
  await scope.close();
});

const cam = data({ label: "life.cam", initial: 0 });
const detail = data({ label: "life.detail", initial: "far" });

const setDetail = operation({
  label: "life.setDetail",
  depends: { cam, detail: detail.controller },
  run: ({ cam, detail }) => detail.set(cam > 5 ? "near" : "far"),
});

/** A reaction: Hedl's `boardFollow` shape, with the source in depends. */
const follow = resource({
  label: "life.follow",
  config: {},
  depends: { cam, setDetail },
  factory: ({ setDetail }) => setDetail.run(),
});

test("a reaction that writes a cell", async () => {
  const spans: string[] = [];
  const scope = createScope({
    observe: { export: (s) => void spans.push(`${s.name} ${s.status}`) },
  });
  const reader = scope.resolve(follow);
  reader.watch(() => undefined);

  scope.controller(cam).set(9);

  expect(reader.get()).toBeUndefined();
  expect(scope.resolve(detail)).toBe("near");
  expect(spans).toEqual([
    "life.setDetail ok",
    "life.follow ok",
    "life.setDetail ok",
    "life.follow ok",
  ]);
  await scope.close();
});

const n = data({ label: "life.n", initial: 0 });

const bump = operation({
  label: "life.bump",
  depends: { n: n.controller },
  run: ({ n }) => n.update((v) => v + 1),
});

/** A reaction that writes its own source: a loop. */
const loop = resource({
  label: "life.loop",
  config: {},
  depends: { n, bump },
  factory: ({ bump }) => bump.run(),
});

test("a reaction that writes its own source stops at the round limit", async () => {
  const scope = createScope();
  scope.resolve(loop).watch(() => undefined);

  expect(() => scope.controller(n).set(1)).toThrow("UpdateDepth");
  expect(scope.resolve(n)).toBe(102);
  await scope.close();
});

test("a scope close runs the ends of a build that still has a reader, last first", async () => {
  const ends: string[] = [];
  const held = resource({
    label: "life.held",
    config: {},
    factory: (_, { defer }) => {
      defer(() => void ends.push("first"));
      defer(() => void ends.push("second"));
      return 1;
    },
  });
  const scope = createScope();
  scope.resolve(held).watch(() => undefined);

  await scope.close();

  expect(ends).toEqual(["second", "first"]);
});

test("a keyed resource with no end keeps its build when its last reader leaves", () => {
  let builds = 0;
  const plain = resource({
    label: "life.plain",
    config: {},
    factory: () => ++builds,
  });
  const reader = createScope().resolve(plain);

  reader.watch(() => undefined)();

  expect(reader.get()).toBe(1);
});

test("a held reader's read after the scope closed raises Disposed and builds nothing (bug 2)", async () => {
  const builds: number[] = [];
  const level = data({ label: "life.level", initial: 0 });
  const shown = resource({
    label: "life.shown",
    config: {},
    depends: { level },
    factory: ({ level }) => {
      builds.push(level);
      return level;
    },
  });
  const scope = createScope();
  scope.controller(level).set(1);
  const reader = scope.resolve(shown);
  reader.get();
  await scope.close();

  try {
    reader.get();
    expect.unreachable("a closed scope must refuse a read");
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }

  expect(builds).toEqual([1]);
});
