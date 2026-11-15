import { expect, expectTypeOf, test } from "vite-plus/test";

import {
  capsule,
  createScope,
  data,
  isError,
  namespace,
  operation,
  resource,
  tag,
  type Data,
  type Operation,
} from "@/main";

type Pr = { viewer: string; id: string; amount: number };

const prs = data({
  label: "keyed.prs",
  mode: "keyed",
  key: (pr: Pr) => ({ viewer: pr.viewer, id: pr.id }),
});

const rate = data({ label: "keyed.rate", initial: 1 });

const viewer = tag<string>({ label: "keyed.viewer" });
const mode = tag<"sum" | "count">({ label: "keyed.mode", default: "sum" });

/** A keyed resource that counts its computes, so a test can see one compute per entry. */
const counted = () => {
  const runs = { count: 0 };
  const total = resource({
    label: "keyed.total",
    config: { viewer: viewer.required, mode },
    depends: (c) => ({ rows: prs.where({ viewer: c.viewer }), rate }),
    factory: ({ rows, rate }, { config: c }) => {
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

test("a keyed resource with no required key reads bare, as its defaults", async () => {
  const scope = seeded();
  const count = resource({
    label: "keyed.count",
    config: {},
    depends: { all: prs },
    factory: ({ all }) => all.length,
  });
  const reader = scope.resolve(count);
  const stop = reader.watch(() => undefined);

  expect(scope.resolve(count())).toBe(reader);
  expect(reader.get()).toBe(3);
  expectTypeOf(count).toExtend<Data.Built<number>>();
  stop();
});

test("a keyed resource with a required key does not read bare", () => {
  const { total } = counted();

  expectTypeOf(total).not.toExtend<Data.Built<number>>();
});

test("a missing required key raises MissingConfig", async () => {
  const scope = seeded();
  const { total } = counted();

  const read = () => scope.resolve(total({ viewer: undefined }));

  expect(read).toThrow(expect.objectContaining({ kind: "MissingConfig" }));
});

test("a slot keys the entry by its unit and is delivered as a depends slot", async () => {
  const scope = seeded();
  const source = tag<Data.Cell<number>>({ label: "keyed.source" });
  const doubled = resource({
    label: "keyed.doubled",
    config: { source: source.required },
    depends: (c) => ({ value: c.source }),
    factory: ({ value }) => value * 2,
  });
  const other = data({ label: "keyed.other", initial: 4 });
  const fromRate = scope.resolve(doubled({ source: rate }));
  const stop = fromRate.watch(() => undefined);

  scope.controller(rate).set(3);

  expect(scope.resolve(doubled({ source: rate }))).toBe(fromRate);
  expect(scope.resolve(doubled({ source: other }))).not.toBe(fromRate);
  expect(fromRate.get()).toBe(6);
  expect(scope.resolve(doubled({ source: other })).get()).toBe(8);
  stop();
});

test("an operation in a slot is a caller, and each operation is its own entry", async () => {
  const scope = seeded();
  const runs = { count: 0 };
  const score = tag<Operation.Handle<number, number>>({ label: "keyed.score" });
  const byTen = operation({
    label: "keyed.byTen",
    input: (raw: unknown) => raw as number,
    run: (_deps, ctx) => {
      runs.count++;
      return ctx.input * 10;
    },
  });
  const byTwo = operation({
    label: "keyed.byTwo",
    input: (raw: unknown) => raw as number,
    run: (_deps, ctx) => ctx.input * 2,
  });
  const scored = resource({
    label: "keyed.scored",
    config: { score: score.required },
    depends: (c) => ({ rate, score: c.score }),
    factory: ({ rate, score }) => score.run({ input: rate }),
  });

  const tens = scope.resolve(scored({ score: byTen }));
  expect(runs.count).toBe(0);

  expect(tens.get()).toBe(10);
  expect(scope.resolve(scored({ score: byTen }))).toBe(tens);
  expect(scope.resolve(scored({ score: byTwo }))).not.toBe(tens);
  expect(scope.resolve(scored({ score: byTwo })).get()).toBe(2);
  expect(runs.count).toBe(1);
});

test("an operation in a slot that writes a cell makes the entry a fault", async () => {
  const scope = seeded();
  const save = tag<Operation.Handle<number, void>>({ label: "keyed.save" });
  const bump = operation({
    label: "keyed.bump",
    depends: { rate: rate.controller },
    run: ({ rate }) => {
      rate.set(rate.get() + 1);
      return 0;
    },
  });
  const saved = resource({
    label: "keyed.saved",
    config: { save: save.required },
    depends: (c) => ({ rate, save: c.save }),
    factory: ({ rate, save }) => rate + save.run(),
  });

  const read = () => scope.resolve(saved({ save: bump })).get();

  expect(read).toThrow(expect.objectContaining({ kind: "WriteInRead" }));
  expect(scope.controller(rate).get()).toBe(1);
});

test("a config value that is no unit raises InvalidKey", async () => {
  const scope = seeded();
  const source = tag<unknown>({ label: "keyed.bad-slot" });
  const bad = resource({
    label: "keyed.bad",
    config: { source: source.required },
    factory: () => 0,
  });

  const read = () => scope.resolve(bad({ source: { any: "object" } }));

  expect(read).toThrow(expect.objectContaining({ kind: "InvalidKey" }));
});

test("a keyed read in a slot keys by its cell and its part", async () => {
  const scope = seeded();
  const rows = tag<Data.Read<readonly Pr[]>>({ label: "keyed.rows" });
  const size = resource({
    label: "keyed.size",
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
  const strict = resource({
    label: "keyed.strict",
    config: {},
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
    label: "keyed.slow",
    factory: () => new Promise<number>((done) => (open = done)),
  });
  const broken = resource({
    label: "keyed.broken",
    factory: (): Promise<number> =>
      Promise.reject(Object.assign(new Error("down"), { kind: "Down" })),
  });
  const plus = resource({
    label: "keyed.plus",
    config: {},
    depends: { slow },
    factory: ({ slow }) => slow + 1,
  });
  const failing = resource({
    label: "keyed.failing",
    config: {},
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

test("a keyed resource reads another keyed resource", async () => {
  const scope = seeded();
  const { total } = counted();
  const label = resource({
    label: "keyed.label",
    config: { viewer: viewer.required },
    depends: (c) => ({ sum: total({ viewer: c.viewer }) }),
    factory: ({ sum }, { config: c }) => `${c.viewer}: ${sum.get()}`,
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
  const base = resource({
    label: "keyed.base",
    config: {},
    depends: { rate },
    factory: ({ rate }) => rate * 10,
  });
  const over = resource({
    label: "keyed.over",
    config: {},
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
  const flaky = resource({
    label: "keyed.flaky",
    config: {},
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
    label: "keyed.broken-alone",
    factory: (): Promise<number> =>
      Promise.reject(Object.assign(new Error("down"), { kind: "Down" })),
  });
  const failing = resource({
    label: "keyed.failing-alone",
    config: {},
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
  const counter = resource({ label: "keyed.counter", factory: () => ++built });
  const shown = resource({
    label: "keyed.shown",
    config: {},
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
  const flag = tag<unknown>({ label: "keyed.flag" });
  const odd = resource({ label: "keyed.odd", config: { flag: flag.required }, factory: () => 0 });

  const reads = [true, { x: 1 }, null].map((value) => () => scope.resolve(odd({ flag: value })));

  for (const read of reads) {
    expect(read).toThrow(
      expect.objectContaining({ kind: expect.stringMatching(/InvalidKey|MissingConfig/) }),
    );
  }
});

const caught = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

test("a number in the config is a key, and a default fills an optional key", () => {
  const scope = seeded();
  const step = tag<number>({ label: "keyed.step" });
  const scaled = resource({
    label: "keyed.scaled",
    config: { step: step.required, mode: mode.optional },
    depends: { rate },
    factory: ({ rate }, { config: c }) => `${c.mode}:${rate * c.step}`,
  });

  const two = scope.resolve(scaled({ step: 2 }));
  const three = scope.resolve(scaled({ step: 3 }));

  expect(two).not.toBe(three);
  expect([two.get(), three.get()]).toEqual(["sum:2", "sum:3"]);
});

test("a key error names the keyed resource and the key", () => {
  const scope = seeded();
  const { total } = counted();
  const flag = tag<unknown>({ label: "keyed.flag2" });
  const odd = resource({ label: "keyed.odd2", config: { flag: flag.required }, factory: () => 0 });

  const missing = caught(() => scope.resolve(total({ viewer: undefined })));
  const invalid = caught(() => scope.resolve(odd({ flag: viewer.required })));

  expect(isError(missing, "MissingConfig") && missing.payload).toEqual({
    label: "keyed.total",
    key: "viewer",
  });
  expect(isError(invalid, "InvalidKey") && invalid.payload).toEqual({
    label: "keyed.odd2",
    field: "flag",
  });
});

test("a tag, an operation and a controller in depends are delivered fixed", () => {
  const scope = createScope({ tags: [viewer("z")] });
  const double = operation({
    label: "keyed.double",
    input: (n: unknown) => n as number,
    run: (_, { input }) => input * 2,
  });
  const fixed = resource({
    label: "keyed.fixed",
    config: {},
    depends: { who: viewer, double, rate: rate.controller },
    factory: ({ who, double, rate }) => `${who}:${double.run({ input: rate.get() })}`,
  });

  const reader = scope.resolve(fixed);

  expect(reader.get()).toBe("z:2");
});

test("a capsule's cell export is a watched source", async () => {
  const shared = capsule({ label: "keyed.cap", exports: { rate } });
  const scope = await createScope({ capsules: [shared] }).ready;
  const viaView = resource({
    label: "keyed.view",
    config: {},
    depends: { r: shared.rate },
    factory: ({ r }) => r.get() + 1,
  });
  const reader = scope.resolve(viaView);
  const heard: unknown[] = [];
  const stop = reader.watch((next) => heard.push(next));

  scope.controller(rate).set(5);

  expect(heard).toEqual([6]);
  stop();
});

test("a pending entry throws the same wait each read", () => {
  const scope = createScope();
  const slow = resource({
    label: "keyed.slow2",
    factory: () => new Promise<number>(() => undefined),
  });
  const plus = resource({
    config: {},
    label: "keyed.plus2",
    depends: { slow },
    factory: ({ slow }) => slow,
  });
  const reader = scope.resolve(plus);

  const first = caught(() => reader.get());
  const second = caught(() => reader.get());

  expect(first).toBeInstanceOf(Promise);
  expect(second).toBe(first);
});

test("a stop called twice leaves the other watcher", () => {
  const scope = seeded();
  const { total } = counted();
  const reader = scope.resolve(total({ viewer: "a" }));
  const heard: unknown[] = [];
  const stopOne = reader.watch(() => undefined);
  const stopTwo = reader.watch((next) => heard.push(next));

  stopOne();
  stopOne();
  scope.controller(rate).set(2);

  expect(heard).toEqual([10]);
  expect(scope.resolve(total({ viewer: "a" }))).toBe(reader);
  stopTwo();
});

test("an old entry that leaves again does not drop the new one", () => {
  const scope = seeded();
  const { total } = counted();
  const old = scope.resolve(total({ viewer: "a" }));
  old.watch(() => undefined)();
  const fresh = scope.resolve(total({ viewer: "a" }));
  const stop = fresh.watch(() => undefined);

  old.watch(() => undefined)();

  expect(fresh).not.toBe(old);
  expect(scope.resolve(total({ viewer: "a" }))).toBe(fresh);
  stop();
});

test("a compute is a resource span with the keyed resource's label; a read with no change makes none", async () => {
  const spans: { name: string; kind: string; status: string | undefined }[] = [];
  const scope = createScope({
    observe: { export: (s) => void spans.push({ name: s.name, kind: s.kind, status: s.status }) },
  });
  const { total } = counted();
  const reader = scope.resolve(total({ viewer: "a" }));

  reader.get();
  reader.get();
  expect(spans).toEqual([{ name: "keyed.total", kind: "resource", status: "ok" }]);

  scope.controller(rate).set(2);
  reader.get();
  expect(spans).toHaveLength(2);
  await scope.close();
});

test("a failed compute closes its span as failed, with the cause", async () => {
  const spans: { status: string | undefined; error: unknown }[] = [];
  const scope = createScope({
    observe: { export: (s) => void spans.push({ status: s.status, error: s.error }) },
  });
  const cause = new Error("no");
  const broken = resource({
    label: "keyed.broken",
    config: {},
    factory: () => {
      throw cause;
    },
  });

  expect(() => scope.resolve(broken).get()).toThrow(cause);
  expect(spans).toEqual([{ status: "failed", error: cause }]);
  await scope.close();
});

test("a compute on a session whose namespace has observe off makes no span", async () => {
  const spans: string[] = [];
  const scope = createScope({ observe: { export: (s) => void spans.push(s.name) } });
  const { total } = counted();
  const quiet = scope.createSession({ ns: namespace({ observe: false }) });

  expect(quiet.resolve(total({ viewer: "a" })).get()).toBe(0);
  expect(spans).toEqual([]);
  await scope.close();
});
