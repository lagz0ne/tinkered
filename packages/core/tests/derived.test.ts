import { expect, expectTypeOf, test } from "vite-plus/test";

import { createScope, data, derived, operation, resource, tag, type Data } from "@/main";

type Pr = { viewer: string; id: string; amount: number };

const prs = data({
  label: "derived.prs",
  mode: "keyed",
  key: (pr: Pr) => ({ viewer: pr.viewer, id: pr.id }),
});

const rate = data({ label: "derived.rate", initial: 1 });

const viewer = tag<string>({ label: "derived.viewer" });
const mode = tag<"sum" | "count">({ label: "derived.mode", default: "sum" });

/** A derived that counts its computes, so a test can see one compute per entry. */
const counted = () => {
  const runs = { count: 0 };
  const total = derived({
    label: "derived.total",
    config: { viewer: viewer.required, mode },
    depends: (c) => ({ rows: prs.where({ viewer: c.viewer }), rate }),
    factory: ({ rows, rate }, c) => {
      runs.count++;
      const list = rows.get();
      return c.mode === "count" ? list.length : list.reduce((n, pr) => n + pr.amount * rate, 0);
    },
  });
  return { runs, total };
};

const seeded = () => {
  const scope = createScope();
  const items = scope.controller(prs);
  items.set({ viewer: "a", id: "1", amount: 2 });
  items.set({ viewer: "a", id: "2", amount: 3 });
  items.set({ viewer: "b", id: "3", amount: 7 });

  return scope;
};

test("two readers of one key share one entry and one compute", async () => {
  const scope = seeded();
  const { runs, total } = counted();

  const first = scope.resolve(total({ viewer: "a" }));
  const stop = first.watch(() => undefined);
  const second = scope.resolve(total({ viewer: "a", mode: "sum" }));

  expect(second).toBe(first);
  expect([first.get(), second.get()]).toEqual([5, 5]);
  expect(runs.count).toBe(1);
  stop();
});

test("a new key reads another entry, and the last reader leaving drops the old one", async () => {
  const scope = seeded();
  const { runs, total } = counted();
  const a = scope.resolve(total({ viewer: "a" }));
  const stopA = a.watch(() => undefined);
  a.get();

  const b = scope.resolve(total({ viewer: "b" }));
  const stopB = b.watch(() => undefined);
  stopA();
  const again = scope.resolve(total({ viewer: "a" }));

  expect(b.get()).toBe(7);
  expect(again).not.toBe(a);
  expect(scope.resolve(total({ viewer: "b" }))).toBe(b);
  expect(runs.count).toBe(2);
  stopB();
});

test("a source write computes again and wakes the watcher; a write elsewhere does not", async () => {
  const scope = seeded();
  const { runs, total } = counted();
  const a = scope.resolve(total({ viewer: "a" }));
  const seen: [unknown, unknown][] = [];
  const stop = a.watch((next, prev) => seen.push([next, prev]));
  a.get();

  scope.controller(prs).set({ viewer: "b", id: "4", amount: 1 });
  scope.controller(rate).set(10);
  stop();
  scope.controller(rate).set(100);

  expect(seen).toEqual([[50, 5]]);
  expect(runs.count).toBe(2);
});

test("config fields in another order name the same entry", async () => {
  const scope = seeded();
  const { total } = counted();
  const one = scope.resolve(total({ viewer: "a", mode: "count" }));
  const stop = one.watch(() => undefined);

  const other = scope.resolve(total({ mode: "count", viewer: "a" }));

  expect(other).toBe(one);
  expect(other.get()).toBe(2);
  stop();
});

test("a derived with no required key reads bare, as its defaults", async () => {
  const scope = seeded();
  const count = derived({
    label: "derived.count",
    depends: { all: prs },
    factory: ({ all }) => all.length,
  });
  const reader = scope.resolve(count);
  const stop = reader.watch(() => undefined);

  expect(scope.resolve(count())).toBe(reader);
  expect(reader.get()).toBe(3);
  expectTypeOf(count).toExtend<Data.Derived<number>>();
  stop();
});

test("a derived with a required key does not read bare", () => {
  const { total } = counted();

  expectTypeOf(total).not.toExtend<Data.Derived<number>>();
});

test("a missing required key raises MissingConfig", async () => {
  const scope = seeded();
  const { total } = counted();

  const read = () => scope.resolve(total({ viewer: undefined }));

  expect(read).toThrow(expect.objectContaining({ kind: "MissingConfig" }));
});

test("a slot keys the entry by its unit and is delivered as a depends slot", async () => {
  const scope = seeded();
  const source = tag<Data.Cell<number>>({ label: "derived.source" });
  const doubled = derived({
    label: "derived.doubled",
    config: { source: source.required },
    depends: (c) => ({ value: c.source }),
    factory: ({ value }) => value * 2,
  });
  const other = data({ label: "derived.other", initial: 4 });
  const fromRate = scope.resolve(doubled({ source: rate }));
  const stop = fromRate.watch(() => undefined);

  scope.controller(rate).set(3);

  expect(scope.resolve(doubled({ source: rate }))).toBe(fromRate);
  expect(scope.resolve(doubled({ source: other }))).not.toBe(fromRate);
  expect(fromRate.get()).toBe(6);
  expect(scope.resolve(doubled({ source: other })).get()).toBe(8);
  stop();
});

test("an operation in a slot raises InvalidKey", async () => {
  const scope = seeded();
  const source = tag<unknown>({ label: "derived.op-slot" });
  const bad = derived({
    label: "derived.bad",
    config: { source: source.required },
    factory: () => 0,
  });
  const op = operation({ label: "derived.op", run: () => 1 });

  const read = () => scope.resolve(bad({ source: op }));

  expect(read).toThrow(expect.objectContaining({ kind: "InvalidKey" }));
});

test("a keyed read in a slot keys by its cell and its part", async () => {
  const scope = seeded();
  const rows = tag<Data.Read<readonly Pr[]>>({ label: "derived.rows" });
  const size = derived({
    label: "derived.size",
    config: { rows: rows.required },
    depends: (c) => ({ list: c.rows }),
    factory: ({ list }) => list.get().length,
  });
  const a = scope.resolve(size({ rows: prs.where({ viewer: "a" }) }));
  const stop = a.watch(() => undefined);

  expect(scope.resolve(size({ rows: prs.where({ viewer: "a" }) }))).toBe(a);
  expect(scope.resolve(size({ rows: prs.where({ viewer: "b" }) })).get()).toBe(1);
  stop();
});

test("a failed compute is the entry's fault until a source changes", async () => {
  const scope = seeded();
  const strict = derived({
    label: "derived.strict",
    depends: { rate },
    factory: ({ rate }) => {
      if (rate < 0) throw Object.assign(new Error("negative"), { kind: "Negative" });
      return rate;
    },
  });
  const reader = scope.resolve(strict);
  const seen: unknown[] = [];
  const stop = reader.watch((next) => seen.push(next));

  scope.controller(rate).set(-1);
  const fault = () => reader.get();
  expect(fault).toThrow("negative");
  scope.controller(rate).set(2);

  expect(reader.get()).toBe(2);
  expect(seen).toHaveLength(2);
  stop();
});

test("a pending resource parks the entry; a built one is read; a failed one is a fault", async () => {
  const scope = createScope();
  let open!: (value: number) => void;
  const slow = resource({
    label: "derived.slow",
    factory: () => new Promise<number>((done) => (open = done)),
  });
  const broken = resource({
    label: "derived.broken",
    factory: (): Promise<number> =>
      Promise.reject(Object.assign(new Error("down"), { kind: "Down" })),
  });
  const plus = derived({
    label: "derived.plus",
    depends: { slow },
    factory: ({ slow }) => slow + 1,
  });
  const failing = derived({
    label: "derived.failing",
    depends: { broken },
    factory: ({ broken }) => broken,
  });
  const reader = scope.resolve(plus);
  const seen: unknown[] = [];
  const stop = reader.watch((next) => seen.push(next));

  const parked = (() => {
    try {
      return reader.get();
    } catch (wait) {
      return wait;
    }
  })();
  open(1);
  await parked;
  const down = scope.resolve(failing);
  await (() => {
    try {
      return down.get();
    } catch (wait) {
      return wait;
    }
  })();

  expect(parked).toBeInstanceOf(Promise);
  expect(reader.get()).toBe(2);
  expect(seen).toEqual([2]);
  expect(() => down.get()).toThrow("down");
  stop();
});

test("a derived reads another derived", async () => {
  const scope = seeded();
  const { total } = counted();
  const label = derived({
    label: "derived.label",
    config: { viewer: viewer.required },
    depends: (c) => ({ sum: total({ viewer: c.viewer }) }),
    factory: ({ sum }, c) => `${c.viewer}: ${sum.get()}`,
  });
  const reader = scope.resolve(label({ viewer: "a" }));
  const stop = reader.watch(() => undefined);

  scope.controller(rate).set(2);

  expect(reader.get()).toBe("a: 10");
  stop();
});

test("readers that resolve before any watch share one entry and one compute", () => {
  const scope = seeded();
  const { runs, total } = counted();

  const first = scope.resolve(total({ viewer: "a" }));
  const second = scope.resolve(total({ viewer: "a" }));
  const values = [first.get(), second.get()];

  expect(second).toBe(first);
  expect(values).toEqual([5, 5]);
  expect(runs.count).toBe(1);
});

test("a watcher hears a change that another reader computed first", () => {
  const scope = seeded();
  const base = derived({
    label: "derived.base",
    depends: { rate },
    factory: ({ rate }) => rate * 10,
  });
  const over = derived({
    label: "derived.over",
    depends: { rate, base },
    factory: ({ rate, base }) => rate + base.get(),
  });
  const top = scope.resolve(over);
  const stopTop = top.watch(() => undefined);
  const heard: unknown[] = [];
  const stopBase = scope.resolve(base).watch((next) => heard.push(next));

  scope.controller(rate).set(2);

  expect(heard).toEqual([20]);
  expect(top.get()).toBe(22);
  stopTop();
  stopBase();
});

test("a watcher hears a fault go away, even back to an equal value", () => {
  const scope = seeded();
  const flaky = derived({
    label: "derived.flaky",
    depends: { rate },
    factory: ({ rate }) => {
      if (rate < 0) throw Object.assign(new Error("negative"), { kind: "Negative" });
      return 7;
    },
  });
  const reader = scope.resolve(flaky);
  reader.get();
  let wakes = 0;
  const stop = reader.watch(() => wakes++);

  scope.controller(rate).set(-1);
  scope.controller(rate).set(1);

  expect(wakes).toBe(2);
  expect(reader.get()).toBe(7);
  stop();
});

test("a failed resource build is a fault on the next read, with no watcher", async () => {
  const scope = createScope();
  const broken = resource({
    label: "derived.broken-alone",
    factory: (): Promise<number> =>
      Promise.reject(Object.assign(new Error("down"), { kind: "Down" })),
  });
  const failing = derived({
    label: "derived.failing-alone",
    depends: { broken },
    factory: ({ broken }) => broken,
  });
  const thrown = (() => {
    try {
      return scope.resolve(failing).get();
    } catch (wait) {
      return wait;
    }
  })();

  await thrown;

  expect(() => scope.resolve(failing).get()).toThrow("down");
});

test("a resource is read again after it builds again", async () => {
  const scope = createScope();
  let built = 0;
  const counter = resource({ label: "derived.counter", factory: () => ++built });
  const shown = derived({
    label: "derived.shown",
    depends: { counter },
    factory: ({ counter }) => counter,
  });
  const reader = scope.resolve(shown);
  const stop = reader.watch(() => undefined);
  const before = reader.get();

  await scope.release(counter);

  expect([before, reader.get()]).toEqual([1, 2]);
  stop();
});

test("a config value that is not a string, a number or a slot raises InvalidKey", () => {
  const scope = seeded();
  const flag = tag<unknown>({ label: "derived.flag" });
  const odd = derived({ label: "derived.odd", config: { flag: flag.required }, factory: () => 0 });

  const reads = [true, { x: 1 }, null].map((value) => () => scope.resolve(odd({ flag: value })));

  for (const read of reads) {
    expect(read).toThrow(
      expect.objectContaining({ kind: expect.stringMatching(/InvalidKey|MissingConfig/) }),
    );
  }
});
