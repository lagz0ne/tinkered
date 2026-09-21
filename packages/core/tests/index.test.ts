import { expect, expectTypeOf, test } from "vite-plus/test";
import {
  createScope,
  data,
  extension,
  isError,
  makeTestClock,
  type Observe,
  type Operation,
  operation,
  preset,
  resource,
  type Resource,
  type Scope,
  tag,
} from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};
const asText = (v: unknown): string => {
  if (typeof v !== "string") throw new Error("not a string");
  return v;
};

test("reads a cell's initial value through the scope seam", () => {
  const count = data({ initial: 1 });
  expect(createScope().controller(count).get()).toBe(1);
});

test("parse transforms + validates the initial, and the read type is inferred", () => {
  const trimmed = (v: unknown): string => {
    if (typeof v !== "string") throw new Error("not a string");
    return v.trim();
  };
  const name = data({ initial: "  ada  ", parse: trimmed });
  const value: string = createScope().controller(name).get();
  expect(value).toBe("ada");
});

test("set and update are reflected on the next read", () => {
  const count = data({ initial: 0 });
  const c = createScope().controller(count);
  c.set(5);
  expect(c.get()).toBe(5);
  c.update((n) => n + 1);
  expect(c.get()).toBe(6);
});

test("watch fires once per real change, never on an eq-equal write; unsubscribe stops it", () => {
  const count = data({ initial: 0 });
  const c = createScope().controller(count);
  const seen: number[] = [];
  const stop = c.watch((n) => seen.push(n));
  c.set(1);
  c.set(1);
  expect(seen).toEqual([1]);
  stop();
  c.set(2);
  expect(seen).toEqual([1]);
});

test("a watcher reads the previous value beside the next", () => {
  const count = data({ initial: 0 });
  const c = createScope().controller(count);
  const seen: Array<readonly [number, number]> = [];
  const stop = c.watch((next, prev) => {
    seen.push([prev, next] as const);
  });
  c.set(1);
  c.set(2);
  stop();
  expect(seen).toEqual([
    [0, 1],
    [1, 2],
  ]);
});

test("an invalid write throws DataValidationFailed with a typed payload", () => {
  const nonNegative = (v: unknown): number => {
    if (typeof v !== "number" || v < 0) throw new Error("must be >= 0");
    return v;
  };
  const count = data({ label: "count", initial: 0, parse: nonNegative });
  const c = createScope().controller(count);
  try {
    c.set(-1);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "DataValidationFailed")) throw error;
    expect(error.payload.label).toBe("count");
  }
});

test("an operation parses rawInput into typed input and returns synchronously", () => {
  const double = operation({
    label: "double",
    input: asNumber,
    run: (_deps, { input }) => input * 2,
  });
  const result: number = createScope().controller(double).run({ rawInput: 3 });
  expect(result).toBe(6);
});

test("read-mode dep delivers the current value; write-mode dep causes an effect", () => {
  const count = data({ initial: 10, parse: asNumber });
  const peek = operation({ label: "peek", depends: { n: count }, run: ({ n }) => n });
  const bump = operation({
    label: "bump",
    input: asNumber,
    depends: { c: count.controller },
    run: ({ c }, { input }) => c.update((n) => n + input),
  });
  const scope = createScope();
  expect(scope.run(peek)).toBe(10);
  scope.run(bump, { rawInput: 5 });
  expect(scope.run(peek)).toBe(15);
});

test("an operation runs on every run (never memoized)", () => {
  let runs = 0;
  const ping = operation({ label: "ping", run: () => ++runs });
  const c = createScope().controller(ping);
  c.run();
  c.run();
  expect(runs).toBe(2);
});

test("an operation composes a child operation through its controller", () => {
  const inner = operation({
    label: "inner",
    input: asNumber,
    run: (_deps, { input }) => input + 1,
  });
  const outer = operation({
    label: "outer",
    depends: { inner: inner.controller },
    run: ({ inner }) => inner.run({ rawInput: 9 }),
  });
  expect(createScope().controller(outer).run()).toBe(10);
});

test("a bare operation dependency is delivered as a subflow the caller invokes", () => {
  const inner = operation({
    label: "inner",
    input: asNumber,
    run: (_deps, { input }) => input + 1,
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => inner.run({ rawInput: 9 }),
  });
  expect(createScope().controller(outer).run()).toBe(10);
});

test("a resource depends on another resource and receives its instance (pool → tx)", () => {
  let pools = 0;
  const pool = resource({ label: "pool", factory: () => ({ id: ++pools }) });
  const tx = resource({
    label: "tx",
    depends: { pool },
    factory: ({ pool }) => ({ from: pool.id }),
  });
  const scope = createScope();
  const a = scope.resolve(tx);
  const b = scope.resolve(tx);
  expect(a).toBe(b);
  expect(a.from).toBe(1);
  expect(pools).toBe(1);
});

test("a resource dep is built before the body runs, whether or not the body reads it", () => {
  let builds = 0;
  const unused = resource({ label: "unused", factory: () => ({ n: ++builds }) });
  const used = resource({ label: "used", factory: () => ({ v: "ok" }) });
  const top = resource({
    label: "top",
    depends: { unused, used },
    factory: ({ used }) => used.v,
  });
  const op = operation({ label: "op", depends: { unused }, run: () => "ran" });
  const scope = createScope();
  expect(scope.resolve(top)).toBe("ok");
  expect(builds).toBe(1);
  expect(scope.run(op)).toBe("ran");
  expect(builds).toBe(1);
});

test("an async resource dep is delivered as its value: the body reads it without awaiting", async () => {
  const conn = resource({ label: "conn", factory: async () => ({ open: true }) });
  const view = resource({
    label: "view",
    depends: { conn },
    factory: async ({ conn }) => ({ sees: conn.open }),
  });
  const op = operation({
    label: "op",
    depends: { conn, view },
    run: async ({ conn, view }) => [conn.open, view.sees],
  });
  const scope = createScope();
  expect(await scope.run(op)).toEqual([true, true]);
  expect(await scope.run(op)).toEqual([true, true]);
  await scope.close();
});

test("a run over a still-building async dep waits for the build, then runs with the value", async () => {
  const gate = deferred();
  let builds = 0;
  const conn = resource({
    label: "conn",
    factory: async () => {
      builds += 1;
      await gate.promise;
      return { id: builds };
    },
  });
  const op = operation({ label: "op", depends: { conn }, run: async ({ conn }) => conn.id });
  const scope = createScope();
  const first = scope.run(op);
  const second = scope.run(op);
  gate.resolve();
  expect(await Promise.all([first, second])).toEqual([1, 1]);
  expect(builds).toBe(1);
  await scope.close();
});

test("a failed async build fails the call before the body runs and stays failed until release", async () => {
  const boom = new Error("boom");
  let builds = 0;
  const conn = resource({
    label: "conn",
    factory: async () => {
      builds += 1;
      if (builds === 1) throw boom;
      return { id: builds };
    },
  });
  let bodies = 0;
  const op = operation({
    label: "op",
    depends: { conn },
    run: async ({ conn }) => {
      bodies += 1;
      return conn.id;
    },
  });
  const scope = createScope();
  const first = await scope.run(op).then(
    () => "resolved",
    (error: unknown) => error,
  );
  const second = await scope.run(op).then(
    () => "resolved",
    (error: unknown) => error,
  );
  expect(first).toBe(boom);
  expect(second).toBe(boom);
  expect(bodies).toBe(0);
  expect(builds).toBe(1);
  scope.release(conn);
  expect(await scope.run(op)).toBe(2);
  expect(bodies).toBe(1);
  await scope.close();
});

test("resolve of an async resource keeps returning the same settled promise", async () => {
  const conn = resource({ label: "conn", factory: async () => ({ open: true }) });
  const scope = createScope();
  const a = scope.resolve(conn);
  const value = await a;
  const b = scope.resolve(conn);
  expect(b).toBe(a);
  expect(await b).toBe(value);
  expect(scope.controller(conn).get()).toBe(a);
  await scope.close();
});

test("async is typed through the graph: an op over an async resource is an async op", async () => {
  const conn = resource({ label: "conn", factory: async () => ({ open: true }) });
  const view = resource({ label: "view", depends: { conn }, factory: async ({ conn }) => conn });
  const op = operation({ label: "op", depends: { view }, run: async ({ view }) => view.open });
  expectTypeOf(op).toEqualTypeOf<Operation.Handle<Promise<boolean>, void>>();
  expectTypeOf(view).toEqualTypeOf<Resource.Handle<Promise<{ open: boolean }>>>();
  const scope = createScope();
  expect(await scope.run(op)).toBe(true);
  await scope.close();
});
// (no shared/ambient state)

test("a resource dep the factory reads twice builds once and caches (lazy access parity)", () => {
  let builds = 0;
  const dep = resource({ label: "dep", factory: () => ({ id: ++builds }) });
  const top = resource({
    label: "top",
    depends: { dep },
    factory: (deps) => deps.dep.id + deps.dep.id,
  });
  const scope = createScope();
  expect(scope.resolve(top)).toBe(2);
  expect(scope.resolve(top)).toBe(2);
  expect(builds).toBe(1);
});

test("a write through an object inheriting from deps lands on the child, not on deps", () => {
  const leaf = resource({ label: "leaf", factory: () => 1 });
  const top = resource({
    label: "top",
    depends: { leaf },
    factory: (deps) => {
      const child: Record<string, unknown> = Object.create(deps);
      child.leaf = 5;
      return { child: child.leaf, own: Object.hasOwn(child, "leaf"), deps: deps.leaf };
    },
  });
  expect(createScope().controller(top).resolve()).toEqual({ child: 5, own: true, deps: 1 });
});
const region = tag<string>({ label: "region", default: "base" });
const maybe = tag<string | undefined>({ label: "maybe", default: undefined });
const secret = tag<string>({ label: "secret" });

test("a required tag reads its binding, or its default when unbound", () => {
  const read = operation({ label: "read", depends: { region }, run: ({ region }) => region });
  expect(createScope().controller(read).run()).toBe("base");
  expect(
    createScope({ tags: [region("eu")] })
      .controller(read)
      .run(),
  ).toBe("eu");
});

test("a required tag with no binding and no default throws MissingTag", () => {
  const read = operation({ label: "read", depends: { secret }, run: ({ secret }) => secret });
  try {
    createScope().controller(read).run();
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload.label).toBe("secret");
  }
});

test("optional reads a bound tag as present", () => {
  const readSecret = operation({ label: "s", depends: { s: secret.optional }, run: ({ s }) => s });
  expect(
    createScope({ tags: [secret("x")] })
      .controller(readSecret)
      .run(),
  ).toEqual({ present: true, value: "x" });
});

test("optional reads missing as absent, not as an undefined default", () => {
  const readMaybe = operation({ label: "m", depends: { m: maybe.optional }, run: ({ m }) => m });
  const readSecret = operation({ label: "s", depends: { s: secret.optional }, run: ({ s }) => s });
  expect(createScope().controller(readMaybe).run()).toEqual({
    present: true,
    value: undefined,
  });
  expect(createScope().controller(readSecret).run()).toEqual({ present: false });
});

test("all returns every binding nearest-first, with no default fallback", () => {
  const readAll = operation({ label: "all", depends: { xs: region.all }, run: ({ xs }) => xs });
  expect(
    createScope({ tags: [region("a"), region("b")] })
      .controller(readAll)
      .run(),
  ).toEqual(["b", "a"]);
  expect(createScope().controller(readAll).run()).toEqual([]);
});

test("a tag binding is validated by parse", () => {
  const port = tag<number>({
    label: "port",
    parse: (v) => {
      if (typeof v !== "number" || v <= 0) throw new Error("bad port");
      return v;
    },
  });
  const scope = createScope({ tags: [port(8080)] });
  expect(scope.resolve(port)).toBe(8080);
  try {
    port(-1);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "DataValidationFailed")) throw error;
    expect(error.payload.label).toBe("port");
  }
});

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
};

test("an async operation runs to its awaited value", async () => {
  const gate = deferred();
  const slow = operation({
    label: "slow",
    input: asNumber,
    run: async (_deps, { input }) => {
      await gate.promise;
      return input * 2;
    },
  });
  const p = createScope().controller(slow).run({ rawInput: 21 });
  gate.resolve();
  expect(await p).toBe(42);
});

test("a rejecting async operation rejects with its cause, and settled still drains", async () => {
  const cause = new Error("boom");
  const gate = deferred();
  const boom = operation({
    label: "boom",
    run: async () => {
      await gate.promise;
      throw cause;
    },
  });
  const scope = createScope();
  const p = scope.run(boom);
  let drained = false;
  const s = scope.settled().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  gate.resolve();
  let caught: unknown;
  try {
    await p;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(cause);
  await s;
  expect(drained).toBe(true);
});

test("dependency snapshots are captured at resolve time, before suspension", async () => {
  const n = data({ initial: 1, parse: asNumber });
  const gate = deferred();
  const slow = operation({
    label: "snap",
    depends: { n },
    run: async ({ n }) => {
      await gate.promise;
      return n;
    },
  });
  const scope = createScope();
  const p = scope.run(slow);
  scope.controller(n).set(99);
  gate.resolve();
  expect(await p).toBe(1);
});

test("concurrent calls do not share results", async () => {
  const entered = new Map<number, ReturnType<typeof deferred>>([
    [1, deferred()],
    [2, deferred()],
  ]);
  const release = new Map<number, ReturnType<typeof deferred>>([
    [1, deferred()],
    [2, deferred()],
  ]);
  const echo = operation({
    label: "echo",
    input: asNumber,
    run: async (_deps, { input }) => {
      entered.get(input)!.resolve();
      await release.get(input)!.promise;
      return input * 10;
    },
  });
  const scope = createScope();
  const p1 = scope.run(echo, { rawInput: 1 });
  const p2 = scope.run(echo, { rawInput: 2 });
  await entered.get(1)!.promise;
  await entered.get(2)!.promise;
  release.get(2)!.resolve();
  release.get(1)!.resolve();
  expect(await p1).toBe(10);
  expect(await p2).toBe(20);
});

test("concurrent calls finish in release order, not entry order", async () => {
  const order: number[] = [];
  const release = new Map<number, ReturnType<typeof deferred>>([
    [1, deferred()],
    [2, deferred()],
  ]);
  const echo = operation({
    label: "echo",
    input: asNumber,
    run: async (_deps, { input }) => {
      await release.get(input)!.promise;
      order.push(input);
      return input * 10;
    },
  });
  const scope = createScope();
  const p1 = scope.run(echo, { rawInput: 1 });
  const p2 = scope.run(echo, { rawInput: 2 });
  release.get(2)!.resolve();
  await p2;
  release.get(1)!.resolve();
  await p1;
  expect(order).toEqual([2, 1]);
});

test("overlapping scopes each read their own write", async () => {
  const n = data({ initial: 0, parse: asNumber });
  const gate = deferred();
  const readN = operation({
    label: "readN",
    depends: { n },
    run: async ({ n }) => {
      await gate.promise;
      return n;
    },
  });
  const a = createScope();
  const b = createScope();
  a.controller(n).set(1);
  b.controller(n).set(2);
  const pa = a.run(readN);
  const pb = b.run(readN);
  gate.resolve();
  expect(await pb).toBe(2);
  expect(await pa).toBe(1);
});

test("a read in flight still sees the snapshot from before a later write", async () => {
  const n = data({ initial: 0, parse: asNumber });
  const gate = deferred();
  const readN = operation({
    label: "readN",
    depends: { n },
    run: async ({ n }) => {
      await gate.promise;
      return n;
    },
  });
  const scope = createScope();
  const p = scope.run(readN);
  scope.controller(n).set(99);
  gate.resolve();
  expect(await p).toBe(0);
});

test("settled reports work as pending until it finishes", async () => {
  const gate = deferred();
  const slow = operation({
    label: "slow",
    run: async () => {
      await gate.promise;
      return 1;
    },
  });
  const scope = createScope();
  const p = scope.run(slow);
  let joined = false;
  const s = scope.settled().then(() => {
    joined = true;
  });
  await Promise.resolve();
  expect(joined).toBe(false);
  gate.resolve();
  await p;
  await s;
  expect(joined).toBe(true);
});

test("a session inherits its parent's data and tags", () => {
  const theme = data({ initial: "light", parse: asText });
  const region = tag<string>({ label: "region", default: "base" });
  const readRegion = operation({ label: "rr", depends: { region }, run: ({ region }) => region });
  const root = createScope({ tags: [region("root")] });
  const child = root.createSession();
  expect(child.controller(theme).get()).toBe("light");
  expect(child.run(readRegion)).toBe("root");
  root.controller(theme).set("dark");
  expect(child.controller(theme).get()).toBe("dark");
});

test("a session write shadows locally (copy-on-write); the parent is unchanged", () => {
  const theme = data({ initial: "light", parse: asText });
  const root = createScope();
  const child = root.createSession();
  root.controller(theme).set("dark");
  child.controller(theme).set("solar");
  expect(child.controller(theme).get()).toBe("solar");
  expect(root.controller(theme).get()).toBe("dark");
});

test("inherited watchers react to parent writes until the child shadows", () => {
  const n = data({ initial: 0, parse: asNumber });
  const root = createScope();
  const child = root.createSession();
  const seen: number[] = [];
  const stop = child.controller(n).watch((v) => seen.push(v));
  root.controller(n).set(1);
  expect(seen).toEqual([1]);
  child.controller(n).set(2);
  expect(seen).toEqual([1, 2]);
  root.controller(n).set(3);
  expect(seen).toEqual([1, 2]);
  stop();
});

test("a watcher subscribed after a write still fires when the value returns to the initial", () => {
  const count = data({ initial: 0 });
  const c = createScope().controller(count);
  c.set(1);
  const seen: number[] = [];
  const stop = c.watch((n) => seen.push(n));
  c.set(1);
  expect(seen).toEqual([]);
  c.set(0);
  expect(seen).toEqual([0]);
  stop();
});

test("a watcher joining after the value returned still fires on the next change", () => {
  const n = data({ initial: 0, parse: asNumber });
  const scope = createScope();
  const ctl = scope.controller(n);
  const first: number[] = [];
  const stopFirst = ctl.watch((v) => first.push(v));
  ctl.set(1);
  stopFirst();
  ctl.set(0);
  const second: number[] = [];
  const stopSecond = ctl.watch((v) => second.push(v));
  ctl.set(1);
  expect(first).toEqual([1]);
  expect(second).toEqual([1]);
  stopSecond();
});

test("the same listener subscribed twice fires twice, and one unsubscribe leaves the other", () => {
  const n = data({ initial: 0, parse: asNumber });
  const ctl = createScope().controller(n);
  let calls = 0;
  const listener = (): void => {
    calls++;
  };
  const stopFirst = ctl.watch(listener);
  const stopSecond = ctl.watch(listener);
  ctl.set(1);
  expect(calls).toBe(2);
  stopFirst();
  ctl.set(2);
  expect(calls).toBe(3);
  stopSecond();
});

test("a watcher registered before a child shadows still sees the parent's later write", () => {
  const n = data({ initial: 0, parse: asNumber });
  const root = createScope();
  const seen: number[] = [];
  const stop = root.controller(n).watch((v) => seen.push(v));
  const child = root.createSession();
  child.controller(n).set(1);
  expect(seen).toEqual([]);
  root.controller(n).set(2);
  expect(seen).toEqual([2]);
  stop();
});

test("nested tags: nearest layer wins, and .all collects nearest-first across layers", () => {
  const region = tag<string>({ label: "region", default: "base" });
  const nearest = operation({ label: "n", depends: { region }, run: ({ region }) => region });
  const every = operation({ label: "e", depends: { xs: region.all }, run: ({ xs }) => xs });
  const root = createScope({ tags: [region("root")] });
  const child = root.createSession({ tags: [region("sess")] });
  expect(child.run(nearest)).toBe("sess");
  expect(child.run(every)).toEqual(["sess", "root"]);
  expect(root.run(nearest)).toBe("root");
});

test("a nearer shadow invalidates a descendant's cached effective cell", () => {
  const v = data({ initial: "a", parse: asText });
  const root = createScope();
  const mid = root.createSession();
  const leaf = mid.createSession();
  expect(leaf.controller(v).get()).toBe("a");
  root.controller(v).set("b");
  expect(leaf.controller(v).get()).toBe("b");
  mid.controller(v).set("c");
  expect(leaf.controller(v).get()).toBe("c");
  expect(root.controller(v).get()).toBe("b");
});

test("a closed scope's held controller still reads the initial value", async () => {
  const count = data({ initial: 3 });
  const scope = createScope();
  const held = scope.controller(count);
  held.set(4);
  scope.onClose(() => undefined);
  await scope.close();
  expect(held.get()).toBe(3);
});

test("close runs children first, then userland onClose hooks in LIFO order", async () => {
  const order: string[] = [];
  const root = createScope();
  const child = root.createSession();
  root.onClose(() => void order.push("root-A"));
  root.onClose(() => void order.push("root-B"));
  child.onClose(() => void order.push("child"));
  await root.close();
  expect(order).toEqual(["child", "root-B", "root-A"]);
});

test("close joins in-flight operation work before completing", async () => {
  const gate = deferred();
  let finished = false;
  const slow = operation({
    label: "slow",
    run: async () => {
      await gate.promise;
      finished = true;
    },
  });
  const scope = createScope();
  void scope.run(slow);
  let closed = false;
  const closing = scope.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  gate.resolve();
  await closing;
  expect(finished).toBe(true);
});

test("a closed scope is sealed: late access and late writes fail with Disposed", async () => {
  const n = data({ initial: 0 });
  const scope = createScope();
  const c = scope.controller(n);
  await scope.close();
  try {
    scope.controller(n);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
  try {
    c.set(1);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
});

test("a throwing onClose hook does not stop the others, and its cause surfaces", async () => {
  const ran: string[] = [];
  const cause = new Error("x");
  const scope = createScope();
  scope.onClose(() => void ran.push("a"));
  scope.onClose(() => {
    throw cause;
  });
  scope.onClose(() => void ran.push("c"));
  const result = await scope.close();
  expect(ran).toEqual(["c", "a"]);
  expect(result.teardownErrors).toContain(cause);
});

test("close is idempotent: hooks run once", async () => {
  let count = 0;
  const scope = createScope();
  scope.onClose(() => void count++);
  await scope.close();
  await scope.close();
  expect(count).toBe(1);
});

test("a hook that re-enters close does not run teardown twice", async () => {
  let count = 0;
  const scope = createScope();
  scope.onClose(() => {
    count++;
    void scope.close();
  });
  await scope.close();
  expect(count).toBe(1);
});

test("close joins operation work started before the operation's first await", async () => {
  const order: string[] = [];
  const gate = deferred();
  const scope = createScope();
  const selfClose = operation({
    label: "selfClose",
    run: async () => {
      void scope.close();
      await gate.promise;
      order.push("work-done");
    },
  });
  void scope.run(selfClose);
  const closing = scope.close().then(() => order.push("closed"));
  gate.resolve();
  await closing;
  expect(order).toEqual(["work-done", "closed"]);
});

test("a scope resource builds once: two resolves share one instance", () => {
  let built = 0;
  const conn = resource({
    label: "conn",
    factory: () => ({ id: ++built }),
  });
  const scope = createScope();
  const ctl = scope.controller(conn);
  const a = ctl.resolve();
  const b = ctl.resolve();
  expect(a).toBe(b);
  expect(built).toBe(1);
});

test("a resource factory sees its owner-bound deps", () => {
  const port = data({ initial: 5432, parse: asNumber });
  const conn = resource({
    label: "conn",
    depends: { port },
    factory: ({ port }) => `db:${port}`,
  });
  const scope = createScope();
  scope.controller(port).set(6000);
  expect(scope.resolve(conn)).toBe("db:6000");
});

test("resource cleanup runs on close", async () => {
  const closed: string[] = [];
  const conn = resource({
    label: "conn",
    factory: (_deps, { defer }) => {
      defer(() => void closed.push("conn"));
      return "open";
    },
  });
  const scope = createScope();
  scope.resolve(conn);
  await scope.close();
  expect(closed).toEqual(["conn"]);
});

test("get() before resolve fails with NotResolved", () => {
  const conn = resource({ label: "conn", factory: () => "open" });
  const scope = createScope();
  try {
    scope.controller(conn).get();
    throw new Error("expected NotResolved");
  } catch (error) {
    if (!isError(error, "NotResolved")) throw error;
    expect(error.payload.label).toBe("conn");
  }
});

test("get() through a closed session fails with Disposed, not a stale value", async () => {
  const conn = resource({ label: "conn", factory: () => "open" });
  const root = createScope();
  const child = root.createSession();
  const ctl = child.controller(conn);
  ctl.resolve();
  await child.close();
  try {
    ctl.get();
    throw new Error("expected Disposed");
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
});

test("resolve() through a controller whose owner has closed fails with Disposed", async () => {
  let built = 0;
  const conn = resource({ label: "conn", factory: () => ++built });
  const root = createScope();
  const leaf = root.createSession();
  const ctl = leaf.controller(conn);
  const closing = root.close();
  try {
    ctl.resolve();
    throw new Error("expected Disposed");
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
  await closing;
  expect(built).toBe(0);
});

test("a resource factory that resolves itself fails with CircularResource", () => {
  const scope = createScope();
  const cyclic: Resource.Handle<string> = resource({
    label: "cyclic",
    factory: () => scope.resolve(cyclic),
  });
  try {
    scope.resolve(cyclic);
    throw new Error("expected CircularResource");
  } catch (error) {
    if (!isError(error, "CircularResource")) throw error;
    expect(error.payload.label).toBe("cyclic");
  }
});

test("concurrent resolves of an async resource share one in-flight build", async () => {
  let built = 0;
  const gate = deferred();
  const conn = resource({
    label: "conn",
    factory: async () => {
      built++;
      await gate.promise;
      return { id: built };
    },
  });
  const ctl = createScope().controller(conn);
  const p1 = ctl.resolve();
  const p2 = ctl.resolve();
  gate.resolve();
  const [a, b] = await Promise.all([p1, p2]);
  expect(a).toBe(b);
  expect(built).toBe(1);
});

test("a resolved async resource caches: a later resolve returns the same instance", async () => {
  const conn = resource({
    label: "conn",
    factory: async () => ({ id: 1 }),
  });
  const ctl = createScope().controller(conn);
  const first = await ctl.resolve();
  const second = await ctl.resolve();
  expect(second).toBe(first);
});

test("close awaits an in-flight async build before tearing down", async () => {
  const order: string[] = [];
  const gate = deferred();
  const conn = resource({
    label: "conn",
    factory: async () => {
      await gate.promise;
      order.push("built");
      return "open";
    },
  });
  const scope = createScope();
  void scope.resolve(conn);
  const closing = scope.close().then(() => order.push("closed"));
  gate.resolve();
  await closing;
  expect(order).toEqual(["built", "closed"]);
});

test("an async build that completes during close does not publish and close stays clean", async () => {
  const gate = deferred();
  const conn = resource({
    label: "conn",
    factory: async () => {
      await gate.promise;
      return "open";
    },
  });
  const scope = createScope();
  const build = scope.resolve(conn);
  const closing = scope.close();
  gate.resolve();
  await closing;
  expect(await build).toBe("open");
});

test("cleanup registered by an in-flight factory during close still runs", async () => {
  const closed: string[] = [];
  const gate = deferred();
  const conn = resource({
    label: "conn",
    factory: async (_deps, { defer }) => {
      await gate.promise;
      defer(() => void closed.push("conn"));
      return "open";
    },
  });
  const scope = createScope();
  void scope.resolve(conn);
  const closing = scope.close();
  gate.resolve();
  await closing;
  expect(closed).toEqual(["conn"]);
});

test("an async resource whose factory returns an augmented thenable resolves to the awaited value", async () => {
  const conn = resource({
    label: "conn",
    factory: () => Object.assign(Promise.resolve(42), { cancel: () => undefined }),
  });
  const value: number = await createScope().controller(conn).resolve();
  expect(value).toBe(42);
});

test("a scope-target resource is one instance shared across sessions", () => {
  let built = 0;
  const conn = resource({ label: "conn", factory: () => ({ id: ++built }) });
  const root = createScope();
  const s1 = root.createSession();
  const s2 = root.createSession();
  const a = s1.resolve(conn);
  const b = s2.resolve(conn);
  expect(a).toBe(b);
  expect(built).toBe(1);
});

test("a session-target resource builds once per session, distinct across sessions", () => {
  let built = 0;
  const conn = resource({
    label: "conn",
    target: "session",
    factory: () => ({ id: ++built }),
  });
  const root = createScope();
  const s1 = root.createSession();
  const s2 = root.createSession();
  const a1 = s1.resolve(conn);
  const a2 = s1.resolve(conn);
  const b = s2.resolve(conn);
  expect(a1).toBe(a2);
  expect(a1).not.toBe(b);
  expect(built).toBe(2);
});

test("a scope resource requiring a session-only tag fails with MissingTag", () => {
  const region = tag<string>({ label: "region" });
  const conn = resource({
    label: "conn",
    depends: { region: region.required },
    factory: ({ region }) => `db:${region}`,
  });
  const session = createScope().createSession({ tags: [region("eu")] });
  try {
    session.resolve(conn);
    throw new Error("expected MissingTag");
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload.label).toBe("region");
  }
});

test("a session resource reads its owner-bound session data and tags", () => {
  const region = tag({ label: "region", default: "us" });
  const port = data({ initial: 5432, parse: asNumber });
  const conn = resource({
    label: "conn",
    target: "session",
    depends: { region: region.required, port },
    factory: ({ region, port }) => `${region}:${port}`,
  });
  const session = createScope().createSession({ tags: [region("eu")] });
  session.controller(port).set(6000);
  expect(session.resolve(conn)).toBe("eu:6000");
});

test("session(fn) success commits via onOutcome; a thrown error rolls back and propagates", async () => {
  const audit: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((o) => void audit.push(o.status === "success" ? "commit" : "rollback"));
      return { ok: true };
    },
  });
  const root = createScope();
  await root.session((s) => {
    s.resolve(tx);
  });
  const cause = new Error("boom");
  const thrown = await root
    .session((s) => {
      s.resolve(tx);
      throw cause;
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  expect(audit).toEqual(["commit", "rollback"]);
  expect(thrown).toBe(cause);
});

test("a throwing onOutcome is aggregated, keeps the outcome, and does not stop other hooks", async () => {
  const seen: string[] = [];
  const hookError = new Error("hook");
  const bad = resource({
    label: "bad",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        throw hookError;
      });
      return 1;
    },
  });
  const good = resource({
    label: "good",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((o) => void seen.push(o.status));
      return 2;
    },
  });
  const root = createScope();
  const thrown = await root
    .session((s) => {
      s.resolve(bad);
      s.resolve(good);
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  expect(seen).toEqual(["success"]);
  if (!isError(thrown, "TeardownFailed")) throw thrown;
  expect(thrown.payload.causes).toContain(hookError);
});

test("session(fn) closes the child automatically after fn returns", async () => {
  const cell = data({ initial: 1 });
  const inner = await createScope().session((s) => s);
  try {
    inner.controller(cell).get();
    throw new Error("expected Disposed");
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
});

test("owned async work that fails settles the session outcome as failed and surfaces its cause", async () => {
  const seen: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((o) => void seen.push(o.status));
      return { ok: true };
    },
  });
  const cause = new Error("owned-boom");
  const failer = operation({
    label: "failer",
    run: async () => {
      throw cause;
    },
  });
  const thrown = await createScope()
    .session((s) => {
      s.resolve(tx);
      void s.run(failer);
      return 42;
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  expect(seen).toEqual(["failed"]);
  expect(thrown).toBe(cause);
});

test("closing the parent while a session runs joins the body and rolls back on its failure", async () => {
  const seen: string[] = [];
  const gate = deferred();
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((o) => void seen.push(o.status));
      return { ok: true };
    },
  });
  const cause = new Error("late-boom");
  const root = createScope();
  const running = root.session(async (s) => {
    s.resolve(tx);
    await gate.promise;
    throw cause;
  });
  const closing = root.close();
  gate.resolve();
  const thrown = await running.then(
    () => undefined,
    (e: unknown) => e,
  );
  await closing;
  expect(seen).toEqual(["failed"]);
  expect(thrown).toBe(cause);
});

test("an ancestor failure force-closes its subtree: a nested child's resource rolls back", async () => {
  const seen: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((o) => void seen.push(o.status));
      return { ok: true };
    },
  });
  const cause = new Error("outer-boom");
  const thrown = await createScope()
    .session((s) => {
      const child = s.createSession();
      child.resolve(tx);
      throw cause;
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  // ADR 0028 (forced shutdown rolls back): the failing session forces its subtree down, so the nested
  // child is force-closed and its resource settles `cancelled` (rolls back). The cause bubbles UP.
  expect(seen).toEqual(["cancelled"]);
  expect(thrown).toBe(cause);
});

test("a factory context is dead after a synchronous throw: a late onOutcome fails", () => {
  let saved: Resource.Ctx | undefined;
  const cause = new Error("sync-boom");
  const boom = resource({
    label: "boom",
    factory: (_deps, ctx) => {
      saved = ctx;
      throw cause;
    },
  });
  const scope = createScope();
  try {
    scope.resolve(boom);
    throw new Error("expected the factory throw");
  } catch (error) {
    if (error !== cause) throw error;
  }
  try {
    saved?.defer(() => undefined);
    throw new Error("expected Disposed");
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
});

test("settled() inside session(fn) drains owned work without waiting on the body itself", async () => {
  const gate = deferred();
  const slow = operation({
    label: "slow",
    run: async () => {
      await gate.promise;
      return 1;
    },
  });
  const done = await createScope().session(async (s) => {
    void s.run(slow);
    gate.resolve();
    await s.settled();
    return "ok";
  });
  expect(done).toBe("ok");
});

test("a leaf failure bubbles out through nested sessions to the caller and rolls back the leaf", async () => {
  const seen: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((o) => void seen.push(o.status));
      return { ok: true };
    },
  });
  const cause = new Error("leaf-boom");
  const failer = operation({
    label: "failer",
    run: async () => {
      throw cause;
    },
  });
  const thrown = await createScope()
    .session((outer) => {
      const middle = outer.createSession();
      const leaf = middle.createSession();
      leaf.resolve(tx);
      void leaf.run(failer);
      return 42;
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  expect(seen).toEqual(["failed"]);
  expect(thrown).toBe(cause);
});

test("a teardown hook that returns its own close() does not hang", async () => {
  let cleaned = 0;
  const scope = createScope();
  scope.onClose(async () => {
    await scope.close();
  });
  scope.onClose(() => void cleaned++);
  await scope.close();
  expect(cleaned).toBe(1);
});

test("closing a parent whose owned work awaits a child's onClose does not deadlock", async () => {
  const order: string[] = [];
  const gate = deferred();
  const root = createScope();
  const child = root.createSession();
  child.onClose(() => {
    order.push("child-closed");
    gate.resolve();
  });
  const waiter = operation({
    label: "waiter",
    run: async () => {
      await gate.promise;
      order.push("waiter-done");
    },
  });
  void root.run(waiter);
  await root.close();
  expect(order).toEqual(["child-closed", "waiter-done"]);
});

test("a concurrent close during an async hook awaits the real teardown and its error", async () => {
  const entered = deferred();
  const release = deferred();
  const hookError = new Error("late-hook");
  const scope = createScope();
  scope.onClose(async () => {
    entered.resolve();
    await release.promise;
    throw hookError;
  });
  const first = scope.close();
  await entered.promise;
  const second = scope.close();
  release.resolve();
  const result = await second;
  await first;
  expect(result.teardownErrors).toContain(hookError);
});

test("closing again after a close with teardown errors re-reports them", async () => {
  const hookError = new Error("hook");
  const scope = createScope();
  scope.onClose(() => {
    throw hookError;
  });
  const first = await scope.close();
  const second = await scope.close();
  expect(first.teardownErrors).toContain(hookError);
  expect(second.teardownErrors).toContain(hookError);
});

test("when owned work and the body both fail, the body cause is primary for hook and caller", async () => {
  const seen: unknown[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((o) => void seen.push(o.status === "failed" ? o.error : "success"));
      return { ok: true };
    },
  });
  const ownedCause = new Error("owned");
  const bodyCause = new Error("body");
  const failer = operation({
    label: "failer",
    run: async () => {
      throw ownedCause;
    },
  });
  const gate = deferred();
  const root = createScope();
  const running = root.session(async (s) => {
    s.resolve(tx);
    void s.run(failer);
    await gate.promise;
    throw bodyCause;
  });
  const closing = root.close();
  gate.resolve();
  const thrown = await running.then(
    () => undefined,
    (e: unknown) => e,
  );
  await closing;
  expect(thrown).toBe(bodyCause);
  expect(seen).toEqual([bodyCause]);
});

test("releasing a resource runs its cleanup and a re-resolve rebuilds a new instance", () => {
  let built = 0;
  const cleaned: number[] = [];
  const conn = resource({
    label: "conn",
    factory: (_deps, { defer }) => {
      const id = ++built;
      defer(() => void cleaned.push(id));
      return { id };
    },
  });
  const scope = createScope();
  const a = scope.resolve(conn);
  scope.release(conn);
  expect(cleaned).toEqual([1]);
  const b = scope.resolve(conn);
  expect(b).not.toBe(a);
  expect(built).toBe(2);
});

test("a build in flight when its resource is released never publishes", async () => {
  let built = 0;
  const gate = deferred();
  const conn = resource({
    label: "conn",
    factory: async () => {
      built++;
      await gate.promise;
      return { id: built };
    },
  });
  const scope = createScope();
  const first = scope.resolve(conn);
  scope.release(conn);
  gate.resolve();
  await first;
  try {
    void scope.controller(conn).get();
    throw new Error("expected NotResolved");
  } catch (error) {
    if (!isError(error, "NotResolved")) throw error;
  }
});

test("releasing a data cell resets it to its initial value and notifies watchers", () => {
  const count = data({ initial: 1, parse: asNumber });
  const scope = createScope();
  const ctl = scope.controller(count);
  const seen: number[] = [];
  ctl.watch((n) => void seen.push(n));
  ctl.set(5);
  scope.release(count);
  expect(ctl.get()).toBe(1);
  expect(seen).toEqual([5, 1]);
});

test("an old build settling after release does not drop the replacement build", async () => {
  let built = 0;
  const gates = [deferred(), deferred()];
  const conn = resource({
    label: "conn",
    factory: async () => {
      const id = built++;
      await gates[id].promise;
      return { id };
    },
  });
  const scope = createScope();
  const first = scope.resolve(conn);
  scope.release(conn);
  const second = scope.resolve(conn);
  gates[0].resolve();
  await first;
  gates[1].resolve();
  const b = await second;
  expect(b).toEqual({ id: 1 });
  expect(await scope.resolve(conn)).toBe(b);
});

test("an old build rejecting after release does not fail a session that got the replacement", async () => {
  let attempt = 0;
  const gate = deferred();
  const conn = resource({
    label: "conn",
    target: "session",
    factory: async () => {
      attempt++;
      const n = attempt;
      if (n === 1) {
        await gate.promise;
        throw new Error("old-build-boom");
      }
      return { n };
    },
  });
  const result = await createScope().session((s) => {
    void s.resolve(conn).then(undefined, () => undefined);
    s.release(conn);
    const replacement = s.resolve(conn);
    gate.resolve();
    return replacement;
  });
  expect(result).toEqual({ n: 2 });
});

test("a rejected build is sticky: a re-resolve without release returns the same rejection, one build", async () => {
  let builds = 0;
  const gate = deferred();
  const conn = resource({
    label: "conn",
    factory: async () => {
      builds++;
      await gate.promise;
      return 1;
    },
  });
  const scope = createScope();
  const first = scope.resolve(conn);
  const settled = first.then(
    () => undefined,
    () => undefined,
  );
  gate.reject(new Error("boom"));
  await settled;
  const again = scope.resolve(conn);
  expect(again).toBe(first);
  expect(builds).toBe(1);
  await scope.close();
});

test("releasing a rejected resource lets a re-resolve rebuild a fresh instance", async () => {
  let builds = 0;
  const gate = deferred();
  const conn = resource({
    label: "conn",
    factory: async () => {
      const n = ++builds;
      if (n === 1) await gate.promise;
      return { n };
    },
  });
  const scope = createScope();
  const first = scope.resolve(conn);
  const settled = first.then(
    () => undefined,
    () => undefined,
  );
  gate.reject(new Error("boom"));
  await settled;
  scope.release(conn);
  const rebuilt = await scope.resolve(conn);
  expect(rebuilt).toEqual({ n: 2 });
  expect(builds).toBe(2);
  await scope.close();
});

test("releasing a dependency cascades to a dependent whose build had rejected, so it rebuilds", async () => {
  let aBuilds = 0;
  let bBuilds = 0;
  const gate = deferred();
  const a = resource({ label: "a", factory: () => ({ id: ++aBuilds }) });
  const b = resource({
    label: "b",
    depends: { a },
    factory: async ({ a }: { a: { id: number } }) => {
      const n = ++bBuilds;
      if (n === 1) await gate.promise;
      return { from: a.id, n };
    },
  });
  const scope = createScope();
  const first = scope.resolve(b);
  const settled = first.then(
    () => undefined,
    () => undefined,
  );
  gate.reject(new Error("boom"));
  await settled;
  scope.release(a);
  const rebuilt = await scope.resolve(b);
  expect(rebuilt).toEqual({ from: 2, n: 2 });
  expect(bBuilds).toBe(2);
  await scope.close();
});

test("two sessions share one scope-target resource's sticky rejection (one build)", async () => {
  let builds = 0;
  const gate = deferred();
  const conn = resource({
    label: "conn",
    target: "scope",
    factory: async () => {
      builds++;
      await gate.promise;
      return 1;
    },
  });
  const root = createScope();
  const s1 = root.createSession();
  const s2 = root.createSession();
  const a = s1.resolve(conn);
  const b = s2.resolve(conn);
  expect(b).toBe(a);
  const settled = a.then(
    () => undefined,
    () => undefined,
  );
  gate.reject(new Error("boom"));
  await settled;
  const c = s2.resolve(conn);
  expect(c).toBe(a);
  expect(builds).toBe(1);
  await root.close();
});

test("release drops only the resource's cleanup, not a shared onClose callback", async () => {
  let calls = 0;
  const shared = () => void calls++;
  const conn = resource({
    label: "conn",
    factory: (_deps, { defer }) => {
      defer(shared);
      return 1;
    },
  });
  const scope = createScope();
  scope.onClose(shared);
  scope.resolve(conn);
  scope.release(conn);
  expect(calls).toBe(1);
  await scope.close();
  expect(calls).toBe(2);
});

test("a release triggered during a factory prevents that build from publishing", () => {
  const flag = data({ initial: 0, parse: asNumber });
  let built = 0;
  const conn = resource({
    label: "conn",
    depends: { flag: flag.controller },
    factory: ({ flag }) => {
      built++;
      flag.set(1);
      return { n: built };
    },
  });
  const scope = createScope();
  scope.controller(flag).watch((n) => {
    if (n === 1) scope.release(conn);
  });
  scope.resolve(conn);
  try {
    scope.controller(conn).get();
    throw new Error("expected NotResolved");
  } catch (error) {
    if (!isError(error, "NotResolved")) throw error;
  }
  expect(built).toBe(1);
});

test("releasing a resource whose owner is already closing fails with Disposed", async () => {
  const conn = resource({ label: "conn", factory: () => ({ id: 1 }) });
  const root = createScope();
  const child = root.createSession();
  child.resolve(conn);
  const closing = root.close();
  try {
    child.release(conn);
    throw new Error("expected Disposed");
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
  await closing;
});

test("a nested release inside a release cleanup does not hang close", async () => {
  const scope = createScope();
  let closed = false;
  scope.onClose(() => void (closed = true));
  const b = resource({
    label: "b",
    factory: (_deps, { defer }) => {
      defer(() => undefined);
      return 1;
    },
  });
  const a = resource({
    label: "a",
    factory: (_deps, { defer }) => {
      defer(async () => {
        scope.release(b);
        await scope.close();
      });
      return 1;
    },
  });
  scope.resolve(b);
  scope.resolve(a);
  scope.release(a);
  await scope.close();
  expect(closed).toBe(true);
});

test("a release cleanup that returns its own close does not hang", async () => {
  const scope = createScope();
  let closedFlag = false;
  scope.onClose(() => void (closedFlag = true));
  const conn = resource({
    label: "conn",
    factory: (_deps, { defer }) => {
      defer(async () => {
        await scope.close();
      });
      return 1;
    },
  });
  scope.resolve(conn);
  scope.release(conn);
  await scope.close();
  expect(closedFlag).toBe(true);
});

test("a session-owned build that rejects during auto-close fails the session", async () => {
  const gate = deferred();
  const cause = new Error("build-boom");
  const conn = resource({
    label: "conn",
    target: "session",
    factory: async () => {
      await gate.promise;
      throw cause;
    },
  });
  const thrown = await createScope()
    .session((s) => {
      void s.resolve(conn).then(undefined, () => undefined);
      gate.resolve();
      return "ok";
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  expect(thrown).toBe(cause);
});

test("a release cleanup that rejects surfaces as secondary", async () => {
  const cleanupError = new Error("cleanup-fail");
  const conn = resource({
    label: "conn",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(async () => {
        throw cleanupError;
      });
      return 1;
    },
  });
  const thrown = await createScope()
    .session((s) => {
      s.resolve(conn);
      s.release(conn);
      return "ok";
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  if (!isError(thrown, "TeardownFailed")) throw thrown;
  expect(thrown.payload.causes).toContain(cleanupError);
});

test("releasing a resource cascades to its dependent exactly once; upstream untouched", () => {
  let cBuilds = 0;
  let bBuilds = 0;
  let aBuilds = 0;
  const c = resource({ label: "c", factory: () => ({ c: ++cBuilds }) });
  const b = resource({
    label: "b",
    depends: { c },
    factory: ({ c }) => ({ b: ++bBuilds, from: c.c }),
  });
  const a = resource({
    label: "a",
    depends: { b },
    factory: ({ b }) => ({ a: ++aBuilds, from: b.b }),
  });
  const scope = createScope();
  scope.resolve(a);
  expect([cBuilds, bBuilds, aBuilds]).toEqual([1, 1, 1]);
  scope.release(b);
  scope.resolve(a);
  expect(cBuilds).toBe(1);
  expect(bBuilds).toBe(2);
  expect(aBuilds).toBe(2);
});

test("a diamond release cascades to the shared dependent exactly once", () => {
  const cleaned: string[] = [];
  const d = resource({ label: "d", factory: () => ({ d: 1 }) });
  const l = resource({ label: "l", depends: { d }, factory: ({ d }) => ({ l: d.d }) });
  const r = resource({ label: "r", depends: { d }, factory: ({ d }) => ({ r: d.d }) });
  const top = resource({
    label: "top",
    depends: { l, r },
    factory: ({ l, r }, { defer }) => {
      defer(() => void cleaned.push("top"));
      return { ok: true, l, r };
    },
  });
  const scope = createScope();
  scope.resolve(top);
  scope.release(d);
  expect(cleaned).toEqual(["top"]);
});

test("a cascade re-runs no operation", () => {
  let runs = 0;
  const flag = data({ initial: 0, parse: asNumber });
  const cmd = operation({
    label: "cmd",
    depends: { flag },
    run: ({ flag }) => {
      runs++;
      return flag;
    },
  });
  const r = resource({ label: "r", depends: { flag }, factory: ({ flag }) => flag });
  const scope = createScope();
  scope.run(cmd);
  scope.resolve(r);
  scope.release(flag);
  expect(runs).toBe(1);
});

test("a throwing cleanup mid-cascade still drops every dependent's cache", () => {
  const base = data({ initial: 0, parse: asNumber });
  let topBuilds = 0;
  const mid = resource({
    label: "mid",
    depends: { base },
    factory: (_deps, { defer }) => {
      defer(() => {
        throw new Error("mid-cleanup");
      });
      return { v: 1 };
    },
  });
  const top = resource({
    label: "top",
    depends: { mid },
    factory: ({ mid }) => ({ built: ++topBuilds, from: mid.v }),
  });
  const scope = createScope();
  scope.resolve(top);
  scope.release(base);
  scope.resolve(top);
  expect(topBuilds).toBe(2);
});

test("releasing the head of a deep chain does not overflow the stack", () => {
  const base = data({ initial: 0, parse: asNumber });
  const chain: Resource.Handle<{ n: number }>[] = [
    resource({ label: "r0", depends: { base }, factory: ({ base }) => ({ n: base }) }),
  ];
  for (let i = 1; i < 5000; i++) {
    const dep = chain[i - 1];
    chain.push(
      resource({ label: `r${i}`, depends: { dep }, factory: ({ dep }) => ({ n: dep.n + 1 }) }),
    );
  }
  const scope = createScope();
  for (const node of chain) scope.resolve(node);
  scope.release(chain[0]);
  expect(scope.controller(chain[0]).resolve().n).toBe(0);
  // 5000-node build + release: generous timeout so coverage-instrumented runs (mutation) don't flake.
}, 30000);

test("a throwing watcher during release still runs the cleanups", () => {
  const base = data({ initial: 0, parse: asNumber });
  const watcherError = new Error("watcher");
  const cleaned: string[] = [];
  const r = resource({
    label: "r",
    depends: { base },
    factory: (_deps, { defer }) => {
      defer(() => void cleaned.push("r"));
      return { v: 1 };
    },
  });
  const scope = createScope();
  scope.controller(base).set(5);
  scope.resolve(r);
  scope.controller(base).watch(() => {
    throw watcherError;
  });
  try {
    scope.release(base);
    throw new Error("expected the watcher to throw");
  } catch (error) {
    if (error !== watcherError) throw error;
  }
  expect(cleaned).toEqual(["r"]);
});

test("an old build's late rejection does not detach the replacement's edges", async () => {
  const base = data({ initial: 0, parse: asNumber });
  let builds = 0;
  const gate = deferred();
  const r = resource({
    label: "r",
    depends: { base },
    factory: async () => {
      const n = ++builds;
      if (n === 1) {
        await gate.promise;
        throw new Error("old-fail");
      }
      return { n };
    },
  });
  const scope = createScope();
  const build1 = scope.resolve(r);
  const settled1 = build1.then(
    () => undefined,
    () => undefined,
  );
  scope.release(r);
  await scope.resolve(r);
  gate.resolve();
  await settled1;
  scope.release(base);
  const c = await scope.resolve(r);
  expect(c.n).toBe(3);
});

test("releasing a scope resource cascades to its dependent instances in each session", () => {
  let poolBuilds = 0;
  let txBuilds = 0;
  const pool = resource({ label: "pool", factory: () => ({ id: ++poolBuilds }) });
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { pool },
    factory: ({ pool }) => ({ from: pool.id, n: ++txBuilds }),
  });
  const root = createScope();
  const s1 = root.createSession();
  const s2 = root.createSession();
  s1.resolve(tx);
  s2.resolve(tx);
  expect([poolBuilds, txBuilds]).toEqual([1, 2]);
  root.release(pool);
  s1.resolve(tx);
  s2.resolve(tx);
  expect(poolBuilds).toBe(2);
  expect(txBuilds).toBe(4);
});

test("a sibling session that did not depend on the released scope resource is unaffected", () => {
  const pool = resource({ label: "pool", factory: () => ({ id: 1 }) });
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { pool },
    factory: ({ pool }) => ({ from: pool.id }),
  });
  const other = resource({ label: "other", target: "session", factory: () => ({ k: 1 }) });
  const root = createScope();
  const s1 = root.createSession();
  const s2 = root.createSession();
  s1.resolve(tx);
  const otherInstance = s2.resolve(other);
  root.release(pool);
  expect(s2.resolve(other)).toBe(otherInstance);
});

test("a closed session's dependency edges are pruned so a later release skips it", async () => {
  let txBuilds = 0;
  const pool = resource({ label: "pool", factory: () => ({ id: 1 }) });
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { pool },
    factory: ({ pool }) => ({ from: pool.id, n: ++txBuilds }),
  });
  const root = createScope();
  const s1 = root.createSession();
  s1.resolve(tx);
  await s1.close();
  root.release(pool);
  expect(txBuilds).toBe(1);
});

test("releasing a scope resource skips a closing session and still releases the others", async () => {
  let poolCleaned = false;
  let txBuilds = 0;
  const pool = resource({
    label: "pool",
    factory: (_deps, { defer }) => {
      defer(() => void (poolCleaned = true));
      return { id: 1 };
    },
  });
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { pool },
    factory: ({ pool }) => ({ from: pool.id, n: ++txBuilds }),
  });
  const root = createScope();
  const s1 = root.createSession();
  const s2 = root.createSession();
  s1.resolve(tx);
  s2.resolve(tx);
  const closing = s1.close();
  root.release(pool);
  await closing;
  expect(poolCleaned).toBe(true);
  s2.resolve(tx);
  expect(txBuilds).toBe(3);
});

test("a session cleanup that closes the root does not deadlock", async () => {
  let rootClosed = false;
  const pool = resource({ label: "pool", factory: () => ({ id: 1 }) });
  const root = createScope();
  const s1 = root.createSession();
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { pool },
    factory: (_deps, { defer }) => {
      defer(async () => {
        await root.close();
      });
      return { ok: true };
    },
  });
  root.onClose(() => void (rootClosed = true));
  s1.resolve(tx);
  root.release(pool);
  await root.close();
  expect(rootClosed).toBe(true);
});

test("releasing a parent session's resource does not touch a child session's own instance", () => {
  let connBuilds = 0;
  let txBuilds = 0;
  const conn = resource({ label: "conn", target: "session", factory: () => ({ c: ++connBuilds }) });
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { conn },
    factory: ({ conn }) => ({ from: conn.c, n: ++txBuilds }),
  });
  const root = createScope();
  const parent = root.createSession();
  const child = parent.createSession();
  parent.resolve(tx);
  child.resolve(tx);
  expect([connBuilds, txBuilds]).toEqual([2, 2]);
  parent.release(conn);
  const childTx = child.resolve(tx);
  expect(childTx.n).toBe(2);
  expect(txBuilds).toBe(2);
});

test("closing an unrelated scope from a cleanup awaits its real teardown and surfaces its error", async () => {
  let bCleaned = false;
  const cleanupError = new Error("b-cleanup");
  const a = createScope();
  const b = createScope();
  const r = resource({
    label: "r",
    factory: (_deps, { defer }) => {
      defer(async () => {
        bCleaned = true;
        throw cleanupError;
      });
      return 1;
    },
  });
  b.resolve(r);
  let bResult: Scope.Result | undefined;
  a.onClose(async () => {
    bResult = await b.close();
  });
  await a.close();
  expect(bCleaned).toBe(true);
  expect(bResult?.teardownErrors).toContain(cleanupError);
});

test("resolving an operation with a subflow yields a parent-linked span tree", () => {
  const spans: Observe.Span[] = [];
  let now = 0;
  const inner = operation({
    label: "inner",
    input: asNumber,
    run: (_deps, { input }) => input + 1,
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => inner.run({ rawInput: 9 }),
  });
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  expect(scope.run(outer)).toBe(10);
  const outerSpan = spans.find((s) => s.name === "outer");
  const innerSpan = spans.find((s) => s.name === "inner");
  expect(innerSpan?.parentId).toBe(outerSpan?.id);
  expect(outerSpan?.parentId).toBe(undefined);
  expect(outerSpan?.kind).toBe("operation");
});

test("two interleaved async operations link each leaf span to its own parent", async () => {
  const spans: Observe.Span[] = [];
  let now = 0;
  const g1 = deferred();
  const g2 = deferred();
  const leaf = operation({ label: "leaf", input: asNumber, run: (_deps, { input }) => input });
  const a = operation({
    label: "a",
    depends: { leaf },
    run: async ({ leaf }) => {
      await g1.promise;
      return leaf.run({ rawInput: 1 });
    },
  });
  const b = operation({
    label: "b",
    depends: { leaf },
    run: async ({ leaf }) => {
      await g2.promise;
      return leaf.run({ rawInput: 2 });
    },
  });
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  const pa = scope.run(a);
  const pb = scope.run(b);
  g2.resolve();
  g1.resolve();
  await Promise.all([pa, pb]);
  const aSpan = spans.find((s) => s.name === "a");
  const bSpan = spans.find((s) => s.name === "b");
  const leaves = spans.filter((s) => s.name === "leaf");
  expect(new Set(leaves.map((s) => s.parentId))).toEqual(new Set([aSpan?.id, bSpan?.id]));
});

test("observation off gives ctx.obs.span undefined and no retained spans", () => {
  let sawSpan: unknown = "unset";
  const op = operation({
    label: "op",
    run: (_deps, { obs }) => {
      sawSpan = obs.span;
      return 1;
    },
  });
  const scope = createScope();
  scope.run(op);
  expect(sawSpan).toBe(undefined);
  expect(scope.spans()).toEqual([]);
});

test("a throwing exporter does not fail the operation", () => {
  const op = operation({ label: "op", run: () => 42 });
  const scope = createScope({
    observe: {
      export: () => {
        throw new Error("sink");
      },
    },
  });
  expect(scope.run(op)).toBe(42);
});

test("history is bounded and toggles independently of export and logging", () => {
  const logs: string[] = [];
  const op = operation({
    label: "op",
    run: (_deps, { log }) => {
      log("hi");
      return 1;
    },
  });
  const scope = createScope({ observe: { history: 2, log: (e) => void logs.push(e.message) } });
  scope.run(op);
  scope.run(op);
  scope.run(op);
  expect(scope.spans().length).toBe(2);
  expect(logs).toEqual(["hi", "hi", "hi"]);
});

test("observation on keeps the operation's returned value identity (behavior-neutral)", async () => {
  const promise = Promise.resolve(7);
  const op = operation({ label: "op", run: () => promise });
  const scope = createScope({ observe: { export: () => undefined } });
  const result = scope.run(op);
  expect(result).toBe(promise);
  expect(await result).toBe(7);
});

test("an async exporter that rejects is isolated (no unhandled rejection, op unaffected)", async () => {
  const op = operation({ label: "op", run: () => 1 });
  const scope = createScope({
    observe: {
      export: async () => {
        throw new Error("async-sink");
      },
    },
  });
  expect(scope.run(op)).toBe(1);
  await Promise.resolve();
});

test("a throwing logger does not fail the operation", () => {
  const op = operation({
    label: "op",
    run: (_deps, { log }) => {
      log("x");
      return 5;
    },
  });
  const scope = createScope({
    observe: {
      log: () => {
        throw new Error("log-sink");
      },
    },
  });
  expect(scope.run(op)).toBe(5);
});

test("a span for an operation whose setup throws is still closed and exported as failed", () => {
  const spans: Observe.Span[] = [];
  const parseError = new Error("parse");
  const op = operation({
    label: "op",
    input: (_raw): number => {
      throw parseError;
    },
    run: () => 1,
  });
  const scope = createScope({ observe: { export: (s) => void spans.push(s) } });
  try {
    scope.run(op, { rawInput: 1 });
    throw new Error("expected the parser to throw");
  } catch (error) {
    if (!isError(error, "DataValidationFailed")) throw error;
    expect(error.payload.label).toBe("op");
    expect(error.payload.cause).toBe(parseError);
  }
  expect(spans.length).toBe(1);
  expect(spans[0].status).toBe("failed");
});

test("a manual child span does not consume a non-promise thenable's then", () => {
  let thenCalls = 0;
  const lazy = {
    then: (res: (v: number) => void) => {
      thenCalls++;
      res(1);
    },
  };
  const op = operation({
    label: "op",
    run: (_deps, { obs }) => {
      obs.child("lazy", () => lazy);
      return 42;
    },
  });
  const scope = createScope({ observe: { export: () => undefined } });
  scope.run(op);
  expect(thenCalls).toBe(0);
});

test("a sink returning a thenable whose then getter throws is isolated", () => {
  const op = operation({ label: "op", run: () => 3 });
  const scope = createScope({
    observe: {
      export: () => ({
        get then() {
          throw new Error("evil-then");
        },
      }),
    },
  });
  expect(scope.run(op)).toBe(3);
});

test("a shared resource used by two operations links a used edge to each caller span", () => {
  const spans: Observe.Span[] = [];
  const conn = resource({ label: "conn", factory: () => ({ id: 1 }) });
  const a = operation({ label: "a", depends: { conn }, run: ({ conn }) => conn.id });
  const b = operation({ label: "b", depends: { conn }, run: ({ conn }) => conn.id });
  const scope = createScope({ observe: { export: (s) => void spans.push(s) } });
  scope.run(a);
  scope.run(b);
  const aSpan = spans.find((s) => s.name === "a");
  const bSpan = spans.find((s) => s.name === "b");
  const usedIn = (span: Observe.Span | undefined) =>
    span?.events.filter((e) => e.name === "used" && e.attributes.resource === "conn") ?? [];
  expect(usedIn(aSpan).length).toBe(1);
  expect(usedIn(bSpan).length).toBe(1);
  const connSpans = spans.filter((s) => s.name === "conn" && s.kind === "resource");
  expect(connSpans.length).toBe(1);
  expect(connSpans[0].parentId).toBe(aSpan?.id);
});

test("resource value identity is unchanged with observation on (no wrapping)", () => {
  const instance = { id: 1 };
  const conn = resource({ label: "conn", factory: () => instance });
  const scope = createScope({ observe: { export: () => undefined } });
  expect(scope.resolve(conn)).toBe(instance);
});

test("an async resource build opens and closes a balanced span", async () => {
  const spans: Observe.Span[] = [];
  let now = 0;
  const gate = deferred();
  const conn = resource({
    label: "conn",
    factory: async () => {
      await gate.promise;
      return { id: 1 };
    },
  });
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  const p = scope.resolve(conn);
  gate.resolve();
  await p;
  const connSpan = spans.find((s) => s.name === "conn" && s.kind === "resource");
  expect(connSpan?.status).toBe("ok");
  expect(connSpan?.end).not.toBe(undefined);
});

test("a data preset is seen by a downstream operation, validated by parse", () => {
  const count = data({ initial: 1, parse: asNumber });
  const read = operation({ label: "read", depends: { n: count }, run: ({ n }) => n });
  const scope = createScope({ presets: [preset(count, 42)] });
  expect(scope.run(read)).toBe(42);
});

test("a data preset value runs through parse and can be rejected", () => {
  const nonNegative = (v: unknown): number => {
    if (typeof v !== "number" || v < 0) throw new Error("must be >= 0");
    return v;
  };
  const count = data({ label: "count", initial: 0, parse: nonNegative });
  try {
    createScope({ presets: [preset(count, -1)] });
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "DataValidationFailed")) throw error;
    expect(error.payload.label).toBe("count");
  }
});

test("an operation preset replaces the run for a downstream subflow", () => {
  const inner = operation({
    label: "inner",
    input: asNumber,
    run: (_deps, { input }) => input + 1,
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => inner.run({ rawInput: 9 }),
  });
  const scope = createScope({ presets: [preset(inner, (_deps, { input }) => input * 100)] });
  expect(scope.run(outer)).toBe(900);
});

test("an operation preset replaces the run for a direct run too", () => {
  const greet = operation({
    label: "greet",
    input: asText,
    run: (_deps, { input }) => `hello ${input}`,
  });
  const scope = createScope({ presets: [preset(greet, (_deps, { input }) => `hi ${input}`)] });
  expect(scope.run(greet, { rawInput: "ada" })).toBe("hi ada");
});

test("a preset is scoped to its scope, not the node globally", () => {
  const count = data({ initial: 1, parse: asNumber });
  const read = operation({ label: "read", depends: { n: count }, run: ({ n }) => n });
  const presetScope = createScope({ presets: [preset(count, 42)] });
  const plainScope = createScope();
  expect(presetScope.run(read)).toBe(42);
  expect(plainScope.run(read)).toBe(1);
});

test("a void-input operation is always delivered as a callable subflow, never a value", () => {
  let runs = 0;
  const ping = operation({ label: "ping", run: () => ++runs });
  const outer = operation({
    label: "outer",
    depends: { ping },
    run: ({ ping }) => [ping.run(), ping.run()],
  });
  expect(createScope().controller(outer).run()).toEqual([1, 2]);
  expect(runs).toBe(2);
});

test("a subflow call with input skips parse; rawInput runs parse", () => {
  let parses = 0;
  const parseCount = (v: unknown): number => {
    parses++;
    if (typeof v !== "number") throw new Error("not a number");
    return v;
  };
  const op = operation({ label: "op", input: parseCount, run: (_deps, { input }) => input });
  const scope = createScope();
  expect(scope.run(op, { input: 7 })).toBe(7);
  expect(parses).toBe(0);
  expect(scope.run(op, { rawInput: 8 })).toBe(8);
  expect(parses).toBe(1);
});

test("a tagged scope.run binds the whole flow: the run, a subflow, and a nested subflow read the call's tags", async () => {
  const zone = tag<string>({ label: "zone", default: "base" });
  const leaf = operation({ label: "leaf", depends: { zone }, run: ({ zone }) => zone });
  const mid = operation({
    label: "mid",
    depends: { leaf, zone },
    run: ({ leaf, zone }) => `${zone}/${leaf.run()}`,
  });
  const outer = operation({
    label: "outer",
    depends: { mid, zone },
    run: ({ mid, zone }) => `${zone}/${mid.run()}`,
  });
  const scope = createScope({ tags: [zone("eu")] });
  expect(scope.run(outer)).toBe("eu/eu/eu");
  expect(await scope.run(outer, { tags: [zone("us")] })).toBe("us/us/us");
  expect(scope.run(outer)).toBe("eu/eu/eu");
});

test("an undefined input is treated as absent, so rawInput is parsed (no NaN leak)", () => {
  const double = operation({
    label: "double",
    input: asNumber,
    run: (_deps, { input }) => input * 2,
  });
  expect(createScope().controller(double).run({ input: undefined, rawInput: 7 })).toBe(14);
});

test("a never-parse operation still takes its input at the seam", () => {
  const count = data({ initial: 0 });
  const write = operation({
    label: "write",
    depends: { c: count.controller },
    run: ({ c }, { input }: { input: number }) => c.set(input),
  });
  const scope = createScope();
  scope.run(write, { input: 7 });
  expect(scope.resolve(count)).toBe(7);
});

test("a resource preset replaces the built instance for downstream consumers", () => {
  const conn = resource({ label: "conn", factory: () => ({ id: "real" }) });
  const read = operation({ label: "read", depends: { conn }, run: ({ conn }) => conn.id });
  expect(createScope().controller(read).run()).toBe("real");
  const presetScope = createScope({ presets: [preset(conn, () => ({ id: "fake" }))] });
  expect(presetScope.run(read)).toBe("fake");
});

test("a resource preset is built once per owner and cached", () => {
  let builds = 0;
  const conn = resource({ label: "conn", factory: () => ({ id: 0 }) });
  const scope = createScope({ presets: [preset(conn, () => ({ id: ++builds }))] });
  const a = scope.resolve(conn);
  const b = scope.resolve(conn);
  expect(a).toBe(b);
  expect(builds).toBe(1);
});

test("a resource preset's cleanup runs when the owner closes; the real factory never runs", async () => {
  const events: string[] = [];
  const conn = resource({
    label: "conn",
    factory: (_deps, { defer }) => {
      defer(() => void events.push("real-teardown"));
      return "real";
    },
  });
  const scope = createScope({
    presets: [
      preset(conn, (_deps, { defer }) => {
        defer(() => void events.push("fake-teardown"));
        return "fake";
      }),
    ],
  });
  scope.resolve(conn);
  await scope.close();
  expect(events).toEqual(["fake-teardown"]);
});

test("an async resource preset resolves to its awaited value", async () => {
  const conn = resource({ label: "conn", factory: async () => ({ id: "real" }) });
  const scope = createScope({ presets: [preset(conn, async () => ({ id: "fake" }))] });
  const value = await scope.resolve(conn);
  expect(value.id).toBe("fake");
});

test("a resource preset receives the resolved deps, delivered untyped (narrow at use)", () => {
  const count = data({ initial: 41, parse: asNumber });
  const conn = resource({ label: "conn", depends: { count }, factory: ({ count }) => count + 1 });
  const scope = createScope({
    presets: [preset(conn, (deps) => asNumber(deps.count) + 100)],
  });
  expect(scope.resolve(conn)).toBe(141);
});

test("a unit carries static tag meta, readable off its handle via tag.read", () => {
  const ui = tag<string>({ label: "ui" });
  const group = tag<string>({ label: "group", default: "misc" });
  const port = data({ initial: 8080, parse: asNumber, meta: [ui("slider")] });
  expect(ui.read(port)).toEqual({ present: true, value: "slider" });
  expect(group.read(port)).toEqual({ present: true, value: "misc" });
});

test("tag.read on a unit without that tag reads as absent", () => {
  const other = tag<string>({ label: "other" });
  const port = data({ initial: 8080, parse: asNumber });
  expect(other.read(port)).toEqual({ present: false });
});

test("meta attaches to operations, resources, and tags alike", () => {
  const ui = tag<string>({ label: "ui" });
  const op = operation({ label: "op", run: () => 1, meta: [ui("button")] });
  const res = resource({ label: "res", factory: () => 1, meta: [ui("panel")] });
  const secret = tag<string>({ label: "secret", meta: [ui("password")] });
  expect(ui.read(op)).toEqual({ present: true, value: "button" });
  expect(ui.read(res)).toEqual({ present: true, value: "panel" });
  expect(ui.read(secret)).toEqual({ present: true, value: "password" });
});

test("meta is static and never affects resolution", () => {
  const ui = tag<string>({ label: "ui" });
  const count = data({ initial: 5, parse: asNumber, meta: [ui("slider")] });
  const read = operation({ label: "read", depends: { count }, run: ({ count }) => count });
  expect(createScope().controller(read).run()).toBe(5);
});

test("a unit with no meta reads as empty", () => {
  expect(operation({ label: "bare", run: () => 0 }).meta).toEqual([]);
});

test("meta is authored as a binding, nothing, or a nested list, and reads flat in order", () => {
  const ui = tag<string>({ label: "ui" });
  const group = tag<string>({ label: "group" });
  const flags = { audit: false };
  const shared = [group("net"), null, flags.audit && ui("never")];
  const port = data({ initial: 1, meta: [undefined, ui("slider"), [shared, [ui("dial")]]] });
  expect(port.meta).toEqual([ui("slider"), group("net"), ui("dial")]);
  expect(ui.read(port)).toEqual({ present: true, value: "dial" });
});

test("a lone binding is one meta entry; an all-nothing list reads as empty", () => {
  const ui = tag<string>({ label: "ui" });
  const single = operation({ label: "single", run: () => 1, meta: ui("button") });
  const nothing = resource({ label: "nothing", factory: () => 1, meta: [null, [undefined, []]] });
  expect(ui.read(single)).toEqual({ present: true, value: "button" });
  expect(nothing.meta).toEqual([]);
});

test("scope and session tags take the same authored shape: a binding, nothing, or a nested list", () => {
  const region = tag<string>({ label: "region" });
  const scope = createScope({ tags: region("eu") });
  const session = scope.createSession({ tags: [null, [region("us"), undefined]] });
  expect(scope.resolve(region.required)).toBe("eu");
  expect(session.resolve(region.all)).toEqual(["us", "eu"]);
});

test("a call's tags take the authored shape: a single binding opens the session, a nested nothing does not", async () => {
  const zone = tag<string>({ label: "zone", default: "base" });
  const read = operation({ label: "read", depends: { zone }, run: ({ zone }) => zone });
  const scope = createScope();
  expect(await scope.run(read, { tags: zone("us") })).toBe("us");
  expect(await scope.run(read, { tags: [null, [zone("eu"), undefined]] })).toBe("eu");
  expect(scope.run(read, { tags: undefined })).toBe("base");
  expect(scope.run(read, { tags: false })).toBe("base");
});

test("presets and extensions take the same authored shape: nested lists and false are read flat", async () => {
  const count = data({ initial: 1 });
  const flags = { debug: false };
  const seen: string[] = [];
  const mark = (label: string): Scope.Extension<void> =>
    extension({
      label,
      start: (_scope, _ctx, next) => {
        seen.push(label);
        return next();
      },
    });
  const scope = createScope({
    presets: [null, [preset(count, 5), flags.debug && preset(count, 9)]],
    extensions: [mark("a"), [undefined, [mark("b")]], flags.debug && mark("never")],
  });
  await scope.ready;
  expect(scope.resolve(count)).toBe(5);
  expect(seen).toEqual(["a", "b"]);
  await scope.close();
});

test("a write through the public seam does not leak into another unit's meta", () => {
  const ui = tag<string>({ label: "ui" });
  const leaked = data({ initial: "clean", meta: [ui("owned")] });
  const other = resource({ label: "b", factory: () => 0 });
  const scope = createScope();
  scope.controller(leaked).set("changed");
  expect(scope.controller(leaked).get()).toBe("changed");
  expect(ui.read(leaked)).toEqual({ present: true, value: "owned" });
  expect(ui.read(other)).toEqual({ present: false });
  void scope.close();
});

test("close runs defers in reverse registration order (LIFO)", async () => {
  const seen: string[] = [];
  const a = resource({
    label: "a",
    factory: (_deps, { defer }) => {
      defer(() => void seen.push("a"));
      return 1;
    },
  });
  const b = resource({
    label: "b",
    factory: (_deps, { defer }) => {
      defer(() => void seen.push("b"));
      return 1;
    },
  });
  const scope = createScope();
  scope.resolve(a);
  scope.resolve(b);
  await scope.close();
  expect(seen).toEqual(["b", "a"]);
});

test("a later onClose runs before an earlier resource defer (layer-wide LIFO)", async () => {
  const seen: string[] = [];
  const r = resource({
    label: "r",
    factory: (_deps, { defer }) => {
      defer(() => void seen.push("r"));
      return 1;
    },
  });
  const scope = createScope();
  scope.resolve(r);
  scope.onClose(() => void seen.push("onClose"));
  await scope.close();
  expect(seen).toEqual(["onClose", "r"]);
});

test("a dependent's defer runs before its dependency's (registration order)", async () => {
  const seen: string[] = [];
  const base = resource({
    label: "base",
    factory: (_deps, { defer }) => {
      defer(() => void seen.push("base"));
      return 1;
    },
  });
  const top = resource({
    label: "top",
    depends: { base },
    factory: ({ base }, { defer }) => {
      defer(() => void seen.push("top"));
      return base;
    },
  });
  const scope = createScope();
  scope.resolve(top);
  await scope.close();
  expect(seen).toEqual(["top", "base"]);
});

test("an operation defer sees success on a clean run", () => {
  const seen: string[] = [];
  const ok = operation({
    label: "ok",
    run: (_deps, { defer }) => {
      defer((end) => void seen.push(end.status));
      return 1;
    },
  });
  createScope().controller(ok).run();
  expect(seen).toEqual(["success"]);
});

test("an operation defer sees failed when the run throws", () => {
  const seen: string[] = [];
  const bad = operation({
    label: "bad",
    run: (_deps, { defer }) => {
      defer((end) => void seen.push(end.status));
      throw new Error("boom");
    },
  });
  expect(() => createScope().controller(bad).run()).toThrow();
  expect(seen).toEqual(["failed"]);
});

test("an operation ctx exposes no borrow or drain internals", () => {
  const probe = operation({
    label: "probe",
    run: (_deps, ctx) => "registeredDefers" in ctx,
  });
  expect(createScope().controller(probe).run()).toBe(false);
});

test("a resource cleanup rolls back on a forced close, commits on a graceful close", async () => {
  const seen: string[] = [];
  const r = resource({
    label: "r",
    factory: (_deps, { defer }) => {
      defer((end) => void seen.push(end.status));
      return 1;
    },
  });
  const forced = createScope();
  forced.resolve(r);
  await forced.close();
  const graceful = createScope();
  graceful.resolve(r);
  await graceful.close({ graceful: true });
  expect(seen).toEqual(["cancelled", "success"]);
});

test("close aborts ctx.signal so a parked op stops cleanly", async () => {
  const gate = deferred();
  let sawAbort = false;
  const parked = operation({
    label: "parked",
    run: async (_deps, { signal }) => {
      await gate.promise;
      sawAbort = signal.aborted;
    },
  });
  const scope = createScope();
  const done = scope.run(parked);
  const closing = scope.close();
  gate.resolve();
  await closing;
  await done;
  expect(sawAbort).toBe(true);
});

test("a streaming operation writes a data cell over time; a watcher sees it grow", async () => {
  const answer = data({ initial: "" });
  const seen: string[] = [];
  const chat = operation({
    label: "chat",
    depends: { out: answer.controller },
    run: async ({ out }) => {
      for (const v of ["He", "Hell", "Hello"]) {
        out.set(v);
        await Promise.resolve();
      }
    },
  });
  const scope = createScope();
  scope.controller(answer).watch((v) => void seen.push(v));
  await scope.run(chat);
  expect(seen).toEqual(["He", "Hell", "Hello"]);
});

test("a real late owned failure during close still surfaces (cancel-clean is only the abort reason)", async () => {
  const closing = deferred();
  const write = deferred();
  const cause = new Error("db write failed");
  const op = operation({
    label: "write",
    run: (_deps, { signal }) => {
      signal.addEventListener("abort", () => closing.resolve(), { once: true });
      return write.promise;
    },
  });
  const done = createScope().session((s) => {
    void s.run(op);
    return 42;
  });
  await closing.promise;
  write.reject(cause);
  await expect(done).rejects.toBe(cause);
});

test("a cancelled session rejects rather than resolving undefined", async () => {
  const parked = operation({
    label: "parked",
    run: (_deps, { signal }) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  });
  const root = createScope();
  const running = root.session((s) => s.run(parked));
  await root.close();
  let rejected = false;
  await running.catch(() => void (rejected = true));
  expect(rejected).toBe(true);
});

test("a throwing defer is aggregated as TeardownFailed and does not stop other defers", async () => {
  const seen: string[] = [];
  const boom = new Error("teardown boom");
  const r = resource({
    label: "r",
    factory: (_deps, { defer }) => {
      defer(() => void seen.push("kept"));
      defer(() => {
        throw boom;
      });
      return 1;
    },
  });
  const scope = createScope();
  scope.resolve(r);
  const result = await scope.close();
  expect(seen).toEqual(["kept"]);
  expect(result.teardownErrors).toContain(boom);
});

test("closing a scope with thousands of defers settles cancelled with no teardown errors", async () => {
  const scope = createScope();
  for (let i = 0; i < 5000; i++) {
    const r = resource({
      label: `r${i}`,
      factory: (_deps, { defer }) => {
        defer(() => undefined);
        return i;
      },
    });
    scope.resolve(r);
  }
  const result = await scope.close();
  expect(result.status).toBe("cancelled");
  expect(result.teardownErrors).toBeUndefined();
});

test("an interrupted session resource sees cancelled, not success", async () => {
  const seen: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer, signal }) => {
      defer((end) => void seen.push(end.status));
      return new Promise<number>((resolve) => {
        signal.addEventListener("abort", () => resolve(42), { once: true });
      });
    },
  });
  const root = createScope();
  const done = root.session((s) => s.resolve(tx));
  await Promise.all([root.close(), done.catch(() => undefined)]);
  expect(seen).toEqual(["cancelled"]);
});

test("closing a deeply nested scope tree does not overflow", async () => {
  const root = createScope();
  let leaf = root;
  for (let i = 0; i < 3000; i++) leaf = leaf.createSession();
  const result = await root.close();
  expect(result.status).toBe("cancelled");
  expect(result.teardownErrors).toBeUndefined();
  // 3000-deep async close cascade: generous timeout so coverage-instrumented runs (mutation) don't
  // flake on the default 5s; the assertion here is "no stack overflow", not wall-clock speed.
}, 30000);

test("an owned rejection with an undefined cause keeps that cause", async () => {
  const op = operation({ label: "fail", run: () => Promise.reject(undefined) });
  const done = createScope().session((s) => {
    void s.run(op);
    return 42;
  });
  let caught = { has: false, value: "unset" as unknown };
  await done.catch((error: unknown) => void (caught = { has: true, value: error }));
  expect(caught.has).toBe(true);
  expect(caught.value).toBe(undefined);
});

test("teardown errors are aggregated in execution order", async () => {
  const first = new Error("first");
  const second = new Error("second");
  const op = operation({
    label: "op",
    run: (_deps, { defer }) => {
      defer(() => {
        throw first;
      });
    },
  });
  const scope = createScope();
  scope.run(op);
  scope.onClose(() => {
    throw second;
  });
  const result = await scope.close();
  expect(result.teardownErrors).toEqual([first, second]);
});

test("close aborts children created by a still-running nested body", async () => {
  const gate = deferred();
  let closeBoundary = (): Promise<unknown> => Promise.resolve();
  const park = operation({
    label: "park",
    run: (_deps, { signal }) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  });
  const done = createScope().session((outer) => {
    closeBoundary = () => outer.close();
    return outer.session(async (inner) => {
      await gate.promise;
      return inner.createSession().controller(park).run();
    });
  });
  const rejected = done.catch(() => undefined);
  const closing = closeBoundary();
  await Promise.resolve();
  gate.resolve();
  const closeResult = (await closing) as Scope.Result;
  await rejected;
  expect(closeResult.status).toBe("cancelled");
  expect(closeResult.teardownErrors).toBeUndefined();
});

test("a settled body result survives a later interrupt", async () => {
  const root = createScope();
  const done = root.session(() => Promise.resolve(42));
  const result = expect(done).resolves.toBe(42);
  await root.close();
  await result;
});

test("a session that completes before any cancel keeps its success (Q5)", async () => {
  const root = createScope();
  const gate = deferred();
  const done = root.session(async () => {
    await gate.promise;
    return 7;
  });
  gate.resolve();
  await expect(done).resolves.toBe(7);
  const result = await root.close({ graceful: true });
  expect(result.status).toBe("success");
});

test("close keeps a child's real failure and cleanup error while waiting for its parent's body", async () => {
  const root = createScope();
  const body = deferred();
  const failure = new Error("child failure");
  const cleanup = new Error("child cleanup");
  const failer = operation({ label: "failer", run: () => Promise.reject(failure) });
  let parent = root;
  let child = root;
  const session = root
    .session(async (scope) => {
      parent = scope;
      child = scope.createSession();
      child.onClose(() => {
        throw cleanup;
      });
      void child.run(failer).catch(() => undefined);
      await body.promise;
      return 42;
    })
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  const parentClosing = parent.close();
  const closing = root.close();
  expect(await child.close()).toEqual({
    status: "failed",
    error: failure,
    teardownErrors: [cleanup],
  });
  body.resolve();
  const result = await closing;
  await parentClosing;
  await session;
  expect(result).toEqual({ status: "failed", error: failure, teardownErrors: [cleanup] });
});

test("close keeps a grandchild's real failure while its ancestor awaits its body", async () => {
  const root = createScope();
  const body = deferred();
  const failure = new Error("grandchild failure");
  const cleanup = new Error("grandchild cleanup");
  const failer = operation({ label: "failer", run: () => Promise.reject(failure) });
  let parent = root;
  let leaf = root;
  const session = root
    .session(async (scope) => {
      parent = scope;
      const middle = scope.createSession();
      leaf = middle.createSession();
      leaf.onClose(() => {
        throw cleanup;
      });
      void leaf.run(failer).catch(() => undefined);
      await body.promise;
      return 42;
    })
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  const parentClosing = parent.close();
  const rootClosing = root.close();
  expect(await leaf.close()).toEqual({
    status: "failed",
    error: failure,
    teardownErrors: [cleanup],
  });
  body.resolve();
  const result = await parentClosing;
  await rootClosing;
  await session;
  expect(result).toEqual({ status: "failed", error: failure, teardownErrors: [cleanup] });
});

test("close keeps a session grandchild's failure while its ancestor awaits its body (Q5)", async () => {
  const root = createScope();
  const body = deferred();
  const leafBody = deferred();
  const failure = new Error("grandchild body failure");
  const cleanup = new Error("grandchild cleanup");
  let parent = root;
  let leaf = root;
  let leafDone: Promise<unknown> = Promise.resolve();
  const session = root
    .session(async (scope) => {
      parent = scope;
      const middle = scope.createSession();
      leafDone = middle
        .session(async (child) => {
          leaf = child;
          child.onClose(() => {
            throw cleanup;
          });
          await leafBody.promise;
          throw failure;
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await body.promise;
      return 42;
    })
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  const parentClosing = parent.close();
  const rootClosing = root.close();
  leafBody.resolve();
  await leafDone;
  expect(await leaf.close()).toEqual({
    status: "failed",
    error: failure,
    teardownErrors: [cleanup],
  });
  body.resolve();
  const result = await parentClosing;
  await rootClosing;
  await session;
  expect(result).toEqual({ status: "failed", error: failure, teardownErrors: [cleanup] });
});

test("close collects a child born and finished during its ancestor's body wait", async () => {
  const root = createScope();
  const create = deferred();
  const failure = new Error("late child failure");
  const cleanup = new Error("late child cleanup");
  const failer = operation({ label: "failer", run: () => Promise.reject(failure) });
  let parent = root;
  const running = root
    .session(async (scope) => {
      parent = scope;
      const middle = scope.createSession();
      await create.promise;
      const late = middle.createSession();
      late.onClose(() => {
        throw cleanup;
      });
      void late.run(failer).catch(() => undefined);
      expect(await late.close()).toEqual({
        status: "failed",
        error: failure,
        teardownErrors: [cleanup],
      });
      return 42;
    })
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  const closing = parent.close();
  create.resolve();
  const result = await closing;
  await running;
  await root.close();
  expect(result).toEqual({ status: "failed", error: failure, teardownErrors: [cleanup] });
});

test("close collects a session child born and finished during its ancestor's body wait", async () => {
  const root = createScope();
  const create = deferred();
  const failure = new Error("late session failure");
  const cleanup = new Error("late session cleanup");
  let parent = root;
  const running = root
    .session(async (scope) => {
      parent = scope;
      const middle = scope.createSession();
      await create.promise;
      await middle
        .session((child) => {
          child.onClose(() => {
            throw cleanup;
          });
          throw failure;
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      return 42;
    })
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  const closing = parent.close();
  create.resolve();
  const result = await closing;
  await running;
  await root.close();
  expect(result).toEqual({ status: "failed", error: failure, teardownErrors: [cleanup] });
});

test("a parent close preserves a real owned failure in an interrupted child", async () => {
  const cause = new Error("child failed");
  const seen: Scope.End[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { signal, defer }) => {
      defer((end) => void seen.push(end));
      return new Promise<number>((resolve) => {
        signal.addEventListener("abort", () => resolve(42), { once: true });
      });
    },
  });
  const bad = operation({ label: "bad", run: () => Promise.reject(cause) });
  const root = createScope();
  const done = root.session((s) => {
    void s.run(bad).catch(() => undefined);
    return s.resolve(tx);
  });
  const rejected = expect(done).rejects.toBe(cause);
  const result = await root.close();
  await rejected;
  expect(seen).toEqual([{ status: "failed", error: cause }]);
  expect(result).toEqual({ status: "failed", error: cause, teardownErrors: undefined });
});

test("a collecting parent gets a child's winning body failure, not its caught owned-work error", async () => {
  const bodyCause = new Error("child body failed");
  const opCause = new Error("child op failed");
  const failer = operation({ label: "failer", run: () => Promise.reject(opCause) });
  const ready = deferred();
  const childGate = deferred();
  const bodyGate = deferred();
  const root = createScope();
  let parent = root;
  let childEnd: Promise<unknown> = Promise.resolve();
  const outer = root
    .session(async (scope) => {
      parent = scope;
      childEnd = scope
        .session(async (child) => {
          await child.run(failer).catch(() => undefined);
          ready.resolve();
          await childGate.promise;
          throw bodyCause;
        })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      await bodyGate.promise;
      return 42;
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  await ready.promise;
  const closing = parent.close();
  childGate.resolve();
  bodyGate.resolve();
  const result = await closing;
  expect(await childEnd).toBe(bodyCause);
  await outer;
  if (result.status !== "failed") expect.unreachable();
  if (result.status === "failed") expect(result.error).toBe(bodyCause);
});

test("a graceful close still force-rolls-back children when the scope already failed", async () => {
  const seen: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((end) => void seen.push(end.status));
      return 1;
    },
  });
  const opCause = new Error("op failed");
  const failer = operation({ label: "failer", run: () => Promise.reject(opCause) });
  const scope = createScope();
  const child = scope.createSession();
  child.resolve(tx);
  await scope.run(failer).catch(() => undefined);
  await scope.settled();
  const result = await scope.close({ graceful: true });
  expect(result.status).toBe("failed");
  expect(seen).toEqual(["cancelled"]);
});

for (const graceful of [false, true]) {
  test(`a child still closing when its parent close is called is collected (graceful=${graceful})`, async () => {
    const root = createScope();
    const child = root.createSession();
    const entered = deferred();
    const release = deferred();
    const cause = new Error("child failed");
    const cleanup = new Error("child cleanup");
    const failer = operation({ label: "failer", run: () => Promise.reject(cause) });
    await child.run(failer).then(
      () => expect.unreachable(),
      (e: unknown) => expect(e).toBe(cause),
    );
    child.onClose(() => {
      throw cleanup;
    });
    child.onClose(() => {
      entered.resolve();
      return release.promise;
    });
    let childFinished = false;
    const watched = child.close({ graceful }).then((r) => {
      childFinished = true;
      return r;
    });
    await entered.promise;
    release.resolve();
    await release.promise;
    expect(childFinished).toBe(false);
    const rootClosing = root.close({ graceful });
    const childResult = await watched;
    const rootResult = await rootClosing;
    expect(childResult.status).toBe("failed");
    expect(rootResult).toEqual({ status: "failed", error: cause, teardownErrors: [cleanup] });
  });
}

test("a descendant failure known before the cascade rolls back the remaining child", async () => {
  const root = createScope();
  const bodyGate = deferred();
  const cause = new Error("child work failed");
  const seen: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((end) => void seen.push(end.status));
      return 1;
    },
  });
  const failer = operation({ label: "failer", run: () => Promise.reject(cause) });
  let parent = root;
  let failedChild = root;
  const session = root
    .session(async (scope) => {
      parent = scope;
      failedChild = scope.createSession();
      scope.createSession().controller(tx).resolve();
      await bodyGate.promise;
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  await failedChild.run(failer).then(
    () => expect.unreachable(),
    (e: unknown) => expect(e).toBe(cause),
  );
  const closing = parent.close({ graceful: true });
  const childResult = await failedChild.close({ graceful: true });
  expect(childResult.status).toBe("failed");
  bodyGate.resolve();
  const result = await closing;
  await session;
  await root.close();
  if (result.status !== "failed") expect.unreachable();
  if (result.status === "failed") expect(result.error).toBe(cause);
  expect(seen).toEqual(["cancelled"]);
});

test("a failure collected from an earlier child rolls back the next child", async () => {
  const root = createScope();
  const gate = deferred();
  const cause = new Error("child work failed");
  const seen: string[] = [];
  const failer = operation({
    label: "failer",
    run: async () => {
      await gate.promise;
      throw cause;
    },
  });
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((end) => void seen.push(end.status));
      return 1;
    },
  });
  const first = root.createSession();
  const failed = first.run(failer).then(
    () => expect.unreachable(),
    (e: unknown) => expect(e).toBe(cause),
  );
  root.createSession().controller(tx).resolve();
  const closing = root.close({ graceful: true });
  gate.resolve();
  await failed;
  const result = await closing;
  expect(result.status).toBe("failed");
  expect(seen).toEqual(["cancelled"]);
});

test("a first graceful child close after an ancestor abort still rolls its resource back", async () => {
  const root = createScope();
  const bodyGate = deferred();
  const abortedGate = deferred();
  const seen: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer, signal }) => {
      defer((end) => void seen.push(end.status));
      signal.addEventListener("abort", () => abortedGate.resolve(), { once: true });
      return signal;
    },
  });
  let parent = root;
  let child = root;
  let childSignal!: AbortSignal;
  const session = root
    .session(async (scope) => {
      parent = scope;
      child = scope.createSession();
      childSignal = child.resolve(tx);
      await bodyGate.promise;
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  const closing = parent.close();
  await abortedGate.promise;
  expect(childSignal.aborted).toBe(true);
  const childResult = await child.close({ graceful: true });
  bodyGate.resolve();
  await closing;
  await session;
  await root.close();
  expect(childResult.status).toBe("cancelled");
  expect(seen).toEqual(["cancelled"]);
});

test("a body that rejects with a surfaced failure reports it over a caught owned-work error", async () => {
  // ADR 0028: a real body failure wins over owned-work. Here the body CAUGHT `own` (so it is not the
  // body's outcome) and then rejected with `ancestor` (surfaced through an awaited grandchild session
  // that really failed with it), so the session settles with the body's cause `ancestor`, not the
  // caught owned-work `own`.
  const own = new Error("owned failure");
  const ancestor = new Error("ancestor failure");
  const bad = operation({ label: "bad", run: () => Promise.reject(own) });
  const root = createScope();
  const done = root.session(async (child) => {
    await expect(child.run(bad)).rejects.toBe(own);
    return child.session(() => Promise.reject(ancestor));
  });
  await expect(done).rejects.toBe(ancestor);
  await root.close();
});

test("an own body failure wins even when an ancestor reports the same cause", async () => {
  const ready = deferred();
  const interrupted = deferred();
  const bodyCause = new Error("body failed");
  const ownedCause = new Error("owned work failed");
  const seen: Scope.End[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer, signal }) => {
      defer((end) => void seen.push(end));
      signal.addEventListener("abort", () => interrupted.resolve(), { once: true });
      return 1;
    },
  });
  const bad = operation({ label: "bad", run: () => Promise.reject(ownedCause) });
  const root = createScope();
  const running = root.session(async (child) => {
    child.resolve(tx);
    await expect(child.run(bad)).rejects.toBe(ownedCause);
    ready.resolve();
    await interrupted.promise;
    throw bodyCause;
  });
  const caught = running.then(
    () => undefined,
    (error: unknown) => error,
  );
  await ready.promise;
  await root.close();
  expect.soft(await caught).toBe(bodyCause);
  expect(seen).toEqual([{ status: "failed", error: bodyCause }]);
});

test("the settlement reducer handles a primitive (non-Error) body cause", async () => {
  const own = "owned failure";
  const ancestor = "ancestor failure";
  const bad = operation({ label: "bad", run: () => Promise.reject(own) });
  const root = createScope();
  const done = root.session(async (child) => {
    await expect(child.run(bad)).rejects.toBe(own);
    return child.session(() => Promise.reject(ancestor));
  });
  await expect(done).rejects.toBe(ancestor);
  await root.close();
});

test("a reused error object is a later session's own body failure", async () => {
  const shared = new Error("shared");
  const root1 = createScope();
  const first = root1.session((child) => child.session(() => Promise.reject(shared)));
  await expect(first).rejects.toBe(shared);
  await root1.close();
  const interrupted = deferred();
  const ownedCause = new Error("owned");
  const seen: Scope.End[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer, signal }) => {
      defer((end) => void seen.push(end));
      signal.addEventListener("abort", () => interrupted.resolve(), { once: true });
      return 1;
    },
  });
  const bad = operation({ label: "bad", run: () => Promise.reject(ownedCause) });
  const root2 = createScope();
  const second = root2.session(async (child) => {
    child.resolve(tx);
    await expect(child.run(bad)).rejects.toBe(ownedCause);
    await interrupted.promise;
    throw shared;
  });
  const caught = second.then(
    () => undefined,
    (error: unknown) => error,
  );
  await root2.close();
  expect.soft(await caught).toBe(shared);
  expect(seen).toEqual([{ status: "failed", error: shared }]);
});

test("closing a manual child does not demote its parent's own body failure", async () => {
  const bodyCause = new Error("body failed");
  const ownedCause = new Error("owned work failed");
  const seen: Scope.End[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((end) => void seen.push(end));
      return 1;
    },
  });
  const bad = operation({ label: "bad", run: () => Promise.reject(ownedCause) });
  const root = createScope();
  const running = root.session(async (parent) => {
    parent.resolve(tx);
    parent.createSession();
    await expect(parent.run(bad)).rejects.toBe(ownedCause);
    throw bodyCause;
  });
  const caught = await running.then(
    () => undefined,
    (error: unknown) => error,
  );
  await root.close();
  expect.soft(caught).toBe(bodyCause);
  expect(seen).toEqual([{ status: "failed", error: bodyCause }]);
});

test("a manual child's earlier close does not swallow the body's own throw of the same cause", async () => {
  const cause = new Error("body failed");
  const seen: Scope.End[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((end) => void seen.push(end));
      return 1;
    },
  });
  const root = createScope();
  const running = root.session(async (parent) => {
    parent.resolve(tx);
    await parent.createSession().close();
    throw cause;
  });
  await expect.soft(running).rejects.toBe(cause);
  expect(seen).toEqual([{ status: "failed", error: cause }]);
  await root.close();
});

test("a diamond release tears down dependents before dependencies (reverse registration)", () => {
  const order: string[] = [];
  const mk = (label: string, depends: Record<string, Scope.Dependency>) =>
    resource({
      label,
      depends,
      factory: (deps, { defer }) => {
        Object.values(deps);
        defer(() => void order.push(label));
        return { [label]: 1 };
      },
    });
  const d = mk("d", {});
  const l = mk("l", { d });
  const r = mk("r", { d });
  const top = mk("top", { l, r });
  const scope = createScope();
  scope.resolve(top);
  scope.release(d);
  expect(order[0]).toBe("top");
  expect(order[order.length - 1]).toBe("d");
  expect(order.indexOf("l")).toBeLessThan(order.indexOf("d"));
  expect(order.indexOf("r")).toBeLessThan(order.indexOf("d"));
});

test("release waits for an in-flight op borrowing the resource before running its cleanup", async () => {
  const opGate = deferred();
  const order: string[] = [];
  const res = resource({
    label: "res",
    factory: (_deps, { defer }) => {
      defer(() => void order.push("res-clean"));
      return 1;
    },
  });
  const op = operation({
    label: "op",
    depends: { res },
    run: async ({ res }) => {
      await opGate.promise;
      order.push("op-done");
      return res;
    },
  });
  const scope = createScope();
  const running = scope.run(op);
  scope.release(res);
  expect(order).toEqual([]);
  opGate.resolve();
  await running;
  await scope.close();
  expect(order).toEqual(["op-done", "res-clean"]);
});

test("a sync op borrowing a released resource does not delay its cleanup", () => {
  const order: string[] = [];
  const res = resource({
    label: "res",
    factory: (_deps, { defer }) => {
      defer(() => void order.push("res-clean"));
      return 1;
    },
  });
  const op = operation({ label: "op", depends: { res }, run: ({ res }) => res });
  const scope = createScope();
  scope.run(op);
  scope.release(res);
  expect(order).toEqual(["res-clean"]);
});

test("releasing a scope resource waits for a cross-owner op that borrowed it", async () => {
  const opGate = deferred();
  const order: string[] = [];
  const conn = resource({
    label: "conn",
    target: "scope",
    factory: (_deps, { defer }) => {
      defer(() => void order.push("conn-clean"));
      return { id: 1 };
    },
  });
  const use = operation({
    label: "use",
    depends: { conn },
    run: async ({ conn }) => {
      await opGate.promise;
      order.push("use-done");
      return conn;
    },
  });
  const root = createScope();
  const child = root.createSession();
  const running = child.run(use);
  root.release(conn);
  expect(order).toEqual([]);
  opGate.resolve();
  await running;
  await root.close();
  expect(order).toEqual(["use-done", "conn-clean"]);
});

test("release keeps a scope dependency alive while a child op borrows its dependent", async () => {
  const gate = deferred();
  const order: string[] = [];
  const conn = resource({
    label: "conn",
    target: "scope",
    factory: (_deps, { defer }) => {
      const value = { open: true };
      defer(() => {
        value.open = false;
        order.push("conn-clean");
      });
      return value;
    },
  });
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { conn },
    factory: ({ conn }, { defer }) => {
      defer(() => void order.push("tx-clean"));
      return conn;
    },
  });
  const use = operation({
    label: "use",
    depends: { tx },
    run: async ({ tx }) => {
      await gate.promise;
      order.push(tx.open ? "use-open" : "use-closed");
    },
  });
  const root = createScope();
  const child = root.createSession();
  const running = child.run(use);
  root.release(conn);
  gate.resolve();
  await running;
  await root.close();
  expect(order).toEqual(["use-open", "tx-clean", "conn-clean"]);
});

test("release keeps a scope dependency alive until a child resource's async cleanup finishes", async () => {
  const gate = deferred();
  const order: string[] = [];
  const conn = resource({
    label: "conn",
    target: "scope",
    factory: (_deps, { defer }) => {
      const value = { open: true };
      defer(() => {
        value.open = false;
        order.push("conn-clean");
      });
      return value;
    },
  });
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { conn },
    factory: ({ conn }, { defer }) => {
      defer(async () => {
        await gate.promise;
        order.push(conn.open ? "tx-clean-open" : "tx-clean-closed");
      });
      return conn;
    },
  });
  const root = createScope();
  const child = root.createSession();
  child.resolve(tx);
  root.release(conn);
  gate.resolve();
  await root.close();
  expect(order).toEqual(["tx-clean-open", "conn-clean"]);
});

test("release keeps a borrowed resource alive until the operation's async cleanup finishes", async () => {
  const gate = deferred();
  const order: string[] = [];
  const conn = resource({
    label: "conn",
    factory: (_deps, { defer }) => {
      const value = { open: true };
      defer(() => {
        value.open = false;
        order.push("conn-clean");
      });
      return value;
    },
  });
  const use = operation({
    label: "use",
    depends: { conn },
    run: async ({ conn }, { defer }) => {
      defer(async () => {
        await gate.promise;
        order.push(conn.open ? "op-clean-open" : "op-clean-closed");
      });
      return 1;
    },
  });
  const scope = createScope();
  await scope.run(use);
  scope.release(conn);
  gate.resolve();
  await scope.close();
  expect(order).toEqual(["op-clean-open", "conn-clean"]);
});

test("release waits for a child borrower even when its resource has no defer", async () => {
  const gate = deferred();
  const order: string[] = [];
  const conn = resource({
    label: "conn",
    target: "scope",
    factory: (_deps, { defer }) => {
      const value = { open: true };
      defer(() => {
        value.open = false;
        order.push("conn-clean");
      });
      return value;
    },
  });
  const view = resource({
    label: "view",
    target: "session",
    depends: { conn },
    factory: ({ conn }) => conn,
  });
  const use = operation({
    label: "use",
    depends: { view },
    run: async ({ view }) => {
      await gate.promise;
      order.push(view.open ? "use-open" : "use-closed");
    },
  });
  const root = createScope();
  const child = root.createSession();
  const running = child.run(use);
  root.release(conn);
  gate.resolve();
  await running;
  await root.close();
  expect(order).toEqual(["use-open", "conn-clean"]);
});

test("release keeps a borrowed resource alive through a synchronously throwing op's async cleanup", async () => {
  const gate = deferred();
  const cause = new Error("op failed");
  const order: string[] = [];
  const conn = resource({
    label: "conn",
    factory: (_deps, { defer }) => {
      const value = { open: true };
      defer(() => {
        value.open = false;
        order.push("conn-clean");
      });
      return value;
    },
  });
  const use = operation({
    label: "use",
    depends: { conn },
    run: ({ conn }, { defer }) => {
      defer(async () => {
        await gate.promise;
        order.push(conn.open ? "op-clean-open" : "op-clean-closed");
      });
      throw cause;
    },
  });
  const scope = createScope();
  expect(() => scope.run(use)).toThrow(cause);
  scope.release(conn);
  gate.resolve();
  await scope.close();
  expect(order).toEqual(["op-clean-open", "conn-clean"]);
});

test("release waits for a borrower before running a defer registered by an in-flight build", async () => {
  const gate = deferred();
  const order: string[] = [];
  const conn = resource({
    label: "conn",
    factory: async (_deps, { defer }) => {
      await gate.promise;
      const value = { open: true };
      defer(() => {
        value.open = false;
        order.push("conn-clean");
      });
      return value;
    },
  });
  const use = operation({
    label: "use",
    depends: { conn },
    run: async ({ conn }) => {
      const value = await conn;
      order.push(value.open ? "use-open" : "use-closed");
    },
  });
  const scope = createScope();
  const running = scope.run(use);
  scope.release(conn);
  gate.resolve();
  await running;
  await scope.close();
  expect(order).toEqual(["use-open", "conn-clean"]);
});

test("a superseded build's late defer leaves the rebuilt resource alive in cache", async () => {
  const gate = deferred();
  let builds = 0;
  const conn = resource({
    label: "conn",
    target: "scope",
    factory: async (_deps, { defer }) => {
      const generation = ++builds;
      if (generation === 1) await gate.promise;
      const value = { open: true };
      defer(() => {
        value.open = false;
      });
      return value;
    },
  });
  const use = operation({
    label: "use",
    depends: { conn },
    run: async ({ conn }) => (await conn).open,
  });
  const root = createScope();
  const child = root.createSession();
  const oldBuild = root.resolve(conn);
  root.release(conn);
  await root.resolve(conn);
  gate.resolve();
  await oldBuild;
  const open = await child.run(use);
  await root.close();
  expect(open).toBe(true);
});

test("a cross-owner release leaves a dependency rebuilt by child cleanup alive in cache", async () => {
  const conn = resource({
    label: "conn",
    target: "scope",
    factory: (_deps, { defer }) => {
      const value = { open: true };
      defer(() => {
        value.open = false;
      });
      return value;
    },
  });
  const root = createScope();
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { conn },
    factory: (deps, { defer }) => {
      defer(() => {
        root.resolve(conn);
      });
      return deps.conn;
    },
  });
  const child = root.createSession();
  child.resolve(tx);
  root.release(conn);
  const open = root.controller(conn).get().open;
  await root.close();
  expect(open).toBe(true);
});

test("cross-owner release tears down a descendant dependent before its ancestor dependency", async () => {
  const gate = deferred();
  const order: string[] = [];
  const count = data({ initial: 0, parse: asNumber });
  const conn = resource({
    label: "conn",
    target: "scope",
    depends: { count },
    factory: (_deps, { defer }) => {
      const value = { open: true };
      defer(() => {
        value.open = false;
        order.push("conn-clean");
      });
      return value;
    },
  });
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { conn, count },
    factory: ({ conn }, { defer }) => {
      defer(async () => {
        await gate.promise;
        order.push(conn.open ? "tx-clean-open" : "tx-clean-closed");
      });
      return conn;
    },
  });
  const root = createScope();
  const child = root.createSession();
  child.resolve(tx);
  root.release(count);
  gate.resolve();
  await root.close();
  expect(order).toEqual(["tx-clean-open", "conn-clean"]);
});

test("release during dependency resolution waits for the operation's cleanup", async () => {
  const gate = deferred();
  const scope = createScope();
  const order: string[] = [];
  const conn = resource({
    label: "conn",
    factory: (_deps, { defer }) => {
      const value = { open: true };
      defer(() => {
        value.open = false;
        order.push("conn-clean");
      });
      return value;
    },
  });
  const trigger = resource({
    label: "trigger",
    factory: () => {
      scope.release(conn);
      return 1;
    },
  });
  const use = operation({
    label: "use",
    depends: { conn, trigger },
    // Read conn first (builds + is borrowed), then trigger, whose lazy build releases conn mid-run.
    // The op's borrow was registered up front, so the release still waits for the op's cleanup.
    run: ({ conn, trigger }, { defer }) => {
      void trigger;
      defer(async () => {
        await gate.promise;
        order.push(conn.open ? "op-clean-open" : "op-clean-closed");
      });
    },
  });
  scope.run(use);
  gate.resolve();
  await scope.close();
  expect(order).toEqual(["op-clean-open", "conn-clean"]);
});

test("a clean scope closes success when graceful", async () => {
  const graceful = await createScope().close({ graceful: true });
  expect(graceful).toEqual({ status: "success", teardownErrors: undefined });
});

test("a clean scope closes cancelled when forced", async () => {
  const forced = await createScope().close();
  expect(forced.status).toBe("cancelled");
  expect(forced.teardownErrors).toBeUndefined();
});

test("a second close returns the owned Result and never throws", async () => {
  const boom = new Error("hook");
  const scope = createScope();
  scope.onClose(() => {
    throw boom;
  });
  const first = await scope.close();
  const second = await scope.close();
  expect(second.status).toBe(first.status);
  expect(second.teardownErrors).toContain(boom);
});

test("an operation reads the scope's clock, and advancing it moves later reads", () => {
  const clk = makeTestClock({ now: 0 });
  const now = operation({ label: "now", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const c = createScope({ clock: clk }).controller(now);
  expect(c.run()).toBe(0);
  clk.advance(50);
  expect(c.run()).toBe(50);
});

test("a resource factory reads the scope's clock", () => {
  const stamped = resource({
    label: "stamped",
    factory: (_deps, { clock }) => clock.currentTimeMillis(),
  });
  const built: number = createScope({ clock: makeTestClock({ now: 500 }) })
    .controller(stamped)
    .resolve();
  expect(built).toBe(500);
});

test("the test clock handles fractional virtual time: truncated millis, precise nanos", () => {
  const millis = operation({ label: "ms", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const nanos = operation({ label: "ns", run: (_deps, { clock }) => clock.currentTimeNanos() });
  const scope = createScope({ clock: makeTestClock({ now: 2.5 }) });
  expect(scope.run(millis)).toBe(2);
  expect(scope.run(nanos)).toBe(2_500_000n);
});

test("the default scope clock reads real wall-clock time", () => {
  const now = operation({ label: "now", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const before = Date.now();
  const read: number = createScope().controller(now).run();
  const after = Date.now();
  expect(read).toBeGreaterThanOrEqual(before);
  expect(read).toBeLessThanOrEqual(after);
});

test("a child session reads its parent scope's clock", async () => {
  const now = operation({ label: "now", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const scope = createScope({ clock: makeTestClock({ now: 1234 }) });
  const seen = await scope.session((s) => s.run(now));
  expect(seen).toBe(1234);
});

test("setTime replaces the test clock's current time", () => {
  const clk = makeTestClock({ now: 100 });
  const now = operation({ label: "now", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const c = createScope({ clock: clk }).controller(now);
  expect(c.run()).toBe(100);
  clk.setTime(9000);
  expect(c.run()).toBe(9000);
});

test("a resource factory that defaults its deps param still reads the injected clock", () => {
  const stamped = resource({
    label: "stamped-default-deps",
    factory: (_deps = {}, { clock }) => clock.currentTimeMillis(),
  });
  const built: number = createScope({ clock: makeTestClock({ now: 777 }) })
    .controller(stamped)
    .resolve();
  expect(built).toBe(777);
});

test("a test-clock sleep resolves only once virtual time is advanced past it", async () => {
  const clk = makeTestClock({ now: 0 });
  let done = false;
  const nap = operation({
    label: "nap",
    run: (_deps, { clock, signal }) =>
      clock.sleep(1000, signal).then(() => {
        done = true;
        return clock.currentTimeMillis();
      }),
  });
  const woke = createScope({ clock: clk }).controller(nap).run();
  clk.advance(500);
  await Promise.resolve();
  expect(done).toBe(false);
  clk.advance(500);
  expect(await woke).toBe(1000);
  expect(done).toBe(true);
});

test("aborting a pending test-clock sleep rejects with the signal's reason", async () => {
  const clk = makeTestClock({ now: 0 });
  const ac = new AbortController();
  const cause = new Error("stop");
  const nap = operation({ label: "nap", run: (_deps, { clock }) => clock.sleep(1000, ac.signal) });
  const p = createScope({ clock: clk }).controller(nap).run();
  ac.abort(cause);
  await expect(p).rejects.toBe(cause);
});

test("a system-clock sleep rejects with the reason when its signal aborts", async () => {
  const ac = new AbortController();
  const cause = new Error("halt");
  const nap = operation({
    label: "sysnap",
    run: (_deps, { clock }) => clock.sleep(60_000, ac.signal),
  });
  const p = createScope().controller(nap).run();
  ac.abort(cause);
  await expect(p).rejects.toBe(cause);
});

test("a test-clock sleep of zero resolves without advancing time", async () => {
  const clk = makeTestClock({ now: 0 });
  const nap = operation({
    label: "nap0",
    run: (_deps, { clock }) => clock.sleep(0).then(() => "woke"),
  });
  expect(await createScope({ clock: clk }).controller(nap).run()).toBe("woke");
});

test("a forced close aborts an in-flight sleep: the run's defer sees cancelled and close settles cancelled", async () => {
  let end: string | undefined;
  const napping = operation({
    label: "napping",
    run: (_deps, { clock, signal, defer }) => {
      defer((e) => {
        end = e.status;
      });
      return clock.sleep(60_000, signal);
    },
  });
  const scope = createScope();
  const done = scope.run(napping);
  const result = await scope.close();
  expect(result.status).toBe("cancelled");
  expect(end).toBe("cancelled");
  await expect(done).rejects.toBeDefined();
});

test("scope.resolve reads a data cell's current value with no subscription", () => {
  const count = data({ initial: 3, parse: asNumber });
  const scope = createScope();
  expect(scope.resolve(count)).toBe(3);
  scope.controller(count).set(4);
  expect(scope.resolve(count)).toBe(4);
});

test("scope.resolve builds a resource once and caches, like controller resolve", () => {
  let builds = 0;
  const conn = resource({ label: "conn", factory: () => ({ id: ++builds }) });
  const scope = createScope();
  const a = scope.resolve(conn);
  const b = scope.resolve(conn);
  expect(a).toBe(b);
  expect(a.id).toBe(1);
  expect(scope.resolve(conn)).toBe(a);
});

test("scope.resolve reads a tag's nearest binding, default, and throws MissingTag when absent", () => {
  const scope = createScope({ tags: [region("eu")] });
  expect(scope.resolve(region)).toBe("eu");
  expect(scope.resolve(maybe)).toBe(undefined);
  try {
    scope.resolve(secret);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload.label).toBe("secret");
  }
});

test("scope.resolve accepts a tag edge and delivers the depends form", () => {
  const scope = createScope({ tags: [region("eu")] });
  const session = scope.createSession({ tags: [region("us")] });
  expect(session.resolve(region.all)).toEqual(["us", "eu"]);
  expect(scope.resolve(maybe.optional)).toEqual({ present: true, value: undefined });
  expect(scope.resolve(secret.optional)).toEqual({ present: false });
  expect(scope.resolve(region.required)).toBe("eu");
  try {
    scope.resolve(secret.required);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload.label).toBe("secret");
  }
});

test("scope.run runs an operation now with CallArgs", () => {
  const double = operation({
    label: "double",
    input: asNumber,
    depends: { n: data({ initial: 0, parse: asNumber }) },
    run: ({ n }, { input }) => n + input,
  });
  const scope = createScope();
  expect(scope.run(double, { rawInput: 3 })).toBe(3);
  const stamp = operation({ label: "stamp", run: () => 7 });
  expect(scope.run(stamp)).toBe(7);
  expect(scope.run(stamp)).toBe(7);
});

test("scope.run shares the controller path: one record lookup, stable controller identity", () => {
  let runs = 0;
  const ping = operation({ label: "ping", run: () => ++runs });
  const scope = createScope();
  const ctl = scope.controller(ping);
  expect(scope.run(ping)).toBe(1);
  expect(ctl.run()).toBe(2);
  expect(scope.controller(ping)).toBe(ctl);
  expect(runs).toBe(2);
});

test("scope.run runs an inline operation with deps, a param, and the full ctx", () => {
  const count = data({ initial: 3, parse: asNumber });
  const store = resource({ label: "store", factory: () => ({ id: "built" }) });
  const zone = tag<string>({ label: "zone", default: "base" });
  const row = { name: "ada" };
  const scope = createScope({ tags: [zone("eu")] });
  const out = scope.run(
    {
      depends: { count, store, zone },
      run: ({ count, store, zone }, ctx) => ({
        count,
        store,
        zone,
        input: ctx.input,
        raw: ctx.rawInput,
      }),
    },
    { input: row },
  );
  expect(out.count).toBe(3);
  expect(out.store).toBe(scope.resolve(store));
  expect(out.zone).toBe("eu");
  expect(out.input).toBe(row);
  expect(out.raw).toBe(row);
});

test("scope.run runs an inline operation with no call: deps resolve and ctx.input is void", () => {
  const count = data({ initial: 21, parse: asNumber });
  const scope = createScope();
  const doubled = scope.run({
    depends: { count },
    run: ({ count }, ctx) => {
      const input: void = ctx.input;
      expect(input).toBe(undefined);
      return count * 2;
    },
  });
  const value: number = doubled;
  expect(value).toBe(42);
});

test("an inline run yields one span named inline with a nested subflow under it", () => {
  const inner = operation({ label: "inner", run: () => "in" });
  const scope = createScope({ observe: { history: 10 } });
  const out = scope.run({
    label: "job",
    depends: { inner },
    run: ({ inner }) => `out-${inner.run()}`,
  });
  expect(out).toBe("out-in");
  const spans = scope.spans();
  expect(spans.length).toBe(2);
  const job = spans.find((s) => s.name === "job");
  const leaf = spans.find((s) => s.name === "inner");
  expect(job?.kind).toBe("operation");
  expect(job?.status).toBe("ok");
  expect(leaf?.parentId).toBe(job?.id);
  const plain = createScope({ observe: { history: 10 } });
  plain.run({ run: () => "x" });
  const only = plain.spans();
  expect(only.length).toBe(1);
  expect(only[0].name).toBe("inline");
  expect(only[0].kind).toBe("operation");
  expect(only[0].status).toBe("ok");
});

test("a forced close aborts an in-flight inline sleep: defer sees cancelled, close settles cancelled", async () => {
  const clk = makeTestClock({ now: 0 });
  let end: string | undefined;
  const scope = createScope({ clock: clk });
  const done = scope.run({
    run: (_deps, { clock, signal, defer }) => {
      defer((e) => {
        end = e.status;
      });
      return clock.sleep(10_000, signal);
    },
  });
  const result = await scope.close();
  expect(result.status).toBe("cancelled");
  expect(end).toBe("cancelled");
  await expect(done).rejects.toBeDefined();
});

test("an inline run receives a preset resource through the deps it names", () => {
  const store = resource({ label: "store", factory: () => ({ id: "real" }) });
  const scope = createScope({ presets: [preset(store, () => ({ id: "fake" }))] });
  expect(scope.run({ depends: { store }, run: ({ store }) => store.id })).toBe("fake");
});

test("the same inline config run twice shares nothing: two spans, two bodies", () => {
  let runs = 0;
  const scope = createScope({ observe: { history: 10 } });
  const cfg = { run: () => ++runs };
  expect(scope.run(cfg)).toBe(1);
  expect(scope.run(cfg)).toBe(2);
  expect(runs).toBe(2);
  expect(scope.spans().length).toBe(2);
});

test("a tagged run builds session resources in the flow and leaves scope resources at the root", async () => {
  const zone = tag<string>({ label: "zone", default: "base" });
  const flow = resource({
    label: "flow",
    target: "session",
    depends: { zone },
    factory: ({ zone }) => zone,
  });
  const root = resource({
    label: "root",
    depends: { zone },
    factory: ({ zone }) => zone,
  });
  const read = operation({
    label: "read",
    depends: { flow, root },
    run: ({ flow, root }) => `${flow}/${root}`,
  });
  const scope = createScope({ tags: [zone("eu")] });
  expect(await scope.run(read, { tags: [zone("us")] })).toBe("us/eu");
});

test("a tagged run's session closes when the run settles: success then failed", async () => {
  const seen: string[] = [];
  const flow = resource({
    label: "flow",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((e) => {
        seen.push(e.status);
      });
      return "f";
    },
  });
  const ok = operation({ label: "ok", depends: { flow }, run: ({ flow }) => flow });
  const boom = operation({
    label: "boom",
    depends: { flow },
    run: ({ flow }) => {
      if (flow === "f") throw new Error("no");
      return flow;
    },
  });
  const zone = tag<string>({ label: "zone", default: "base" });
  const scope = createScope();
  expect(await scope.run(ok, { tags: [zone("us")] })).toBe("f");
  expect(seen).toEqual(["success"]);
  try {
    await scope.run(boom, { tags: [zone("us")] });
    expect.unreachable();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "no") throw error;
  }
  expect(seen).toEqual(["success", "failed"]);
});

test("a tagged inline run behaves the same: the flow sees the tags", async () => {
  const zone = tag<string>({ label: "zone", default: "base" });
  const scope = createScope({ tags: [zone("eu")] });
  const out: string = await scope.run(
    { depends: { zone }, run: ({ zone }) => zone },
    { tags: [zone("us")] },
  );
  expect(out).toBe("us");
});

test("an untagged run builds a session resource at the root, with no session opened", () => {
  let builds = 0;
  const flow = resource({
    label: "flow",
    target: "session",
    factory: () => `f${++builds}`,
  });
  const read = operation({ label: "read", depends: { flow }, run: ({ flow }) => flow });
  const scope = createScope();
  expect(scope.run(read)).toBe("f1");
  expect(scope.run(read)).toBe("f1");
  expect(builds).toBe(1);
});

test("a tagged call is always async: a sync op resolves through a promise", async () => {
  const ping = operation({ label: "ping", run: () => 7 });
  const zone = tag<string>({ label: "zone", default: "base" });
  const out: Promise<number> = createScope().run(ping, { tags: [zone("us")] });
  expect(out instanceof Promise).toBe(true);
  expect(await out).toBe(7);
});

test("a scope with no extensions is ready at once on one shared promise", async () => {
  const scope = createScope();
  expect(scope.ready === scope.ready).toBe(true);
  expect(await scope.ready.then(() => "ready")).toBe("ready");
  await scope.close();
});

test("ready waits for an async start", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  const ext = extension({
    label: "slow",
    start: async (_scope, _ctx, next) => {
      await gate;
      await next();
      started = true;
    },
  });
  const scope = createScope({ extensions: [ext] });
  let settled = false;
  const waiting = scope.ready.then(() => {
    settled = true;
  });
  expect(started).toBe(false);
  release();
  await scope.ready;
  await waiting;
  expect(started).toBe(true);
  expect(settled).toBe(true);
  await scope.close();
});

test("a rejected start rejects ready and fails the scope", async () => {
  const boom = new Error("boom-start");
  const ext = extension({
    label: "bad",
    start: () => Promise.reject(boom),
  });
  const scope = createScope({ extensions: [ext] });
  await expect(scope.ready).rejects.toBe(boom);
  const result = await scope.close();
  expect(result.status).toBe("failed");
});

test("start runs as an onion: first registered is outermost", async () => {
  const order: string[] = [];
  const a = extension({
    label: "a",
    start: async (_scope, _ctx, next) => {
      order.push("a:before");
      await next();
      order.push("a:after");
    },
  });
  const b = extension({
    label: "b",
    start: async (_scope, _ctx, next) => {
      order.push("b:before");
      await next();
      order.push("b:after");
    },
  });
  const scope = createScope({ extensions: [a, b] });
  await scope.ready;
  expect(order).toEqual(["a:before", "b:before", "b:after", "a:after"]);
  await scope.close();
});

test("a start that skips next short-circuits the inner starts", async () => {
  let innerRan = false;
  const outer = extension({
    label: "outer",
    start: () => Promise.resolve(),
  });
  const inner = extension({
    label: "inner",
    start: () => {
      innerRan = true;
      return Promise.resolve();
    },
  });
  const scope = createScope({ extensions: [outer, inner] });
  await scope.ready;
  expect(innerRan).toBe(false);
  await scope.close();
});

test("resolve(ext) reads the start value once ready, NotResolved before", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ext = extension<number>({
    label: "num",
    start: async (_scope, _ctx, next) => {
      await gate;
      await next();
      return 41;
    },
  });
  const scope = createScope({ extensions: [ext] });
  try {
    scope.resolve(ext);
    throw new Error("unreachable");
  } catch (e) {
    if (!isError(e, "NotResolved")) throw e;
    expect(e.payload.label).toBe("num");
  }
  release();
  await scope.ready;
  const value: number = scope.resolve(ext);
  expect(value).toBe(41);
  await scope.close();
});

test("a close hook wraps the structural close", async () => {
  const order: string[] = [];
  let inner: string | undefined;
  const ext = extension({
    label: "wrap",
    close: async (_opts, next) => {
      order.push("before");
      const result = await next();
      inner = result.status;
      order.push("after");
      return result;
    },
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  const result = await scope.close({ graceful: true });
  expect(result.status).toBe("success");
  expect(inner).toBe("success");
  expect(order).toEqual(["before", "after"]);
});

test("ctx.defer registered in start runs at close with the settled end", async () => {
  let seen: string | undefined;
  const ext = extension({
    label: "deferred",
    start: (_scope, ctx, next) => {
      ctx.defer((end) => {
        seen = end.status;
      });
      return next();
    },
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  const result = await scope.close({ graceful: true });
  expect(result.status).toBe("success");
  expect(seen).toBe("success");
});

test("ctx.signal aborts on a forced close", async () => {
  let aborted = false;
  const ext = extension({
    label: "watcher",
    start: (_scope, ctx, next) => {
      ctx.signal.addEventListener("abort", () => {
        aborted = true;
      });
      return next();
    },
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  await scope.close();
  expect(aborted).toBe(true);
});

test("a session after ready has an already-resolved ready", async () => {
  const ext = extension({
    label: "base",
    start: (_scope, _ctx, next) => next(),
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  const child = scope.createSession();
  expect(await child.ready.then(() => "ready")).toBe("ready");
  await scope.close();
});

test("resolve of an extension that is not installed throws NotResolved", async () => {
  const installed = extension({ label: "in", start: (_scope, _ctx, next) => next() });
  const other = extension({ label: "out", start: (_scope, _ctx, next) => next() });
  const scope = createScope({ extensions: [installed] });
  await scope.ready;
  try {
    scope.resolve(other);
    throw new Error("unreachable");
  } catch (e) {
    if (!isError(e, "NotResolved")) throw e;
    expect(e.payload.label).toBe("out");
  }
  await scope.close();
});

test("a resolve hook wraps a cell read: before, next, after", async () => {
  const log: string[] = [];
  const cell = data({ initial: 7 });
  const wrap = extension({
    label: "wrap",
    resolve: (target, next) => {
      log.push("before");
      const value = next();
      log.push("after");
      return value;
    },
  });
  const scope = createScope({ extensions: [wrap] });
  await scope.ready;
  const value: number = scope.resolve(cell);
  expect(value).toBe(7);
  expect(log).toEqual(["before", "after"]);
  await scope.close();
});

test("a resolve hook that skips next short-circuits with a substitute", async () => {
  const cell = data({ initial: 7 });
  const deny = extension({
    label: "deny",
    resolve: (_target, _next) => 42,
  });
  const scope = createScope({ extensions: [deny] });
  await scope.ready;
  const value: number = scope.resolve(cell);
  expect(value).toBe(42);
  expect(scope.controller(cell).get()).toBe(7);
  await scope.close();
});

test("two resolve hooks nest in registration order", async () => {
  const order: string[] = [];
  const cell = data({ initial: 1 });
  const a = extension({
    label: "a",
    resolve: (_target, next) => {
      order.push("a:before");
      const value = next();
      order.push("a:after");
      return value;
    },
  });
  const b = extension({
    label: "b",
    resolve: (_target, next) => {
      order.push("b:before");
      const value = next();
      order.push("b:after");
      return value;
    },
  });
  const scope = createScope({ extensions: [a, b] });
  await scope.ready;
  scope.resolve(cell);
  expect(order).toEqual(["a:before", "b:before", "b:after", "a:after"]);
  await scope.close();
});

test("the resolve chain wraps tag and resource reads too", async () => {
  let calls = 0;
  const zone = tag<string>({ label: "zone", default: "base" });
  const pool = resource({ label: "pool", factory: () => 9 });
  const count = extension({
    label: "count",
    resolve: (_target, next) => {
      calls += 1;
      return next();
    },
  });
  const scope = createScope({ extensions: [count] });
  await scope.ready;
  const value: string = scope.resolve(zone);
  expect(value).toBe("base");
  expect(calls).toBe(1);
  const built: number = scope.resolve(pool);
  expect(built).toBe(9);
  expect(calls).toBe(2);
  await scope.close();
});

test("resolve(ext) bypasses the resolve chain", async () => {
  let calls = 0;
  const base = extension({
    label: "base",
    start: (_scope, _ctx, next) => next(),
  });
  const count = extension({
    label: "count",
    resolve: (_target, next) => {
      calls += 1;
      return next();
    },
  });
  const scope = createScope({ extensions: [base, count] });
  await scope.ready;
  scope.resolve(base);
  expect(calls).toBe(0);
  await scope.close();
});

test("a session reads with the plain dispatch, unwrapped by the chain", async () => {
  let calls = 0;
  const cell = data({ initial: 3 });
  const count = extension({
    label: "count",
    resolve: (_target, next) => {
      calls += 1;
      return next();
    },
  });
  const scope = createScope({ extensions: [count] });
  await scope.ready;
  const session = scope.createSession();
  const value: number = session.resolve(cell);
  expect(value).toBe(3);
  expect(calls).toBe(0);
  await scope.close();
});

test("a run hook wraps a declared operation call: before, next, after", async () => {
  const log: string[] = [];
  const triple = operation({ label: "triple", run: () => 3 });
  const wrap = extension({
    label: "wrap",
    run: (_op, _call, next) => {
      log.push("before");
      const out = next();
      log.push("after");
      return out;
    },
  });
  const scope = createScope({ extensions: [wrap] });
  await scope.ready;
  const value: number = scope.run(triple);
  expect(value).toBe(3);
  expect(log).toEqual(["before", "after"]);
  await scope.close();
});

test("a run hook that skips next refuses the call and the body never runs", async () => {
  let calls = 0;
  const op = operation({
    label: "op",
    run: () => {
      calls += 1;
      return 1;
    },
  });
  const deny = extension({ label: "deny", run: () => "denied" });
  const scope = createScope({ extensions: [deny] });
  await scope.ready;
  expect(scope.run(op)).toBe("denied");
  expect(calls).toBe(0);
  await scope.close();
});

test("two run hooks nest in registration order", async () => {
  const order: string[] = [];
  const op = operation({ label: "op", run: () => 1 });
  const a = extension({
    label: "a",
    run: (_op, _call, next) => {
      order.push("a:before");
      const out = next();
      order.push("a:after");
      return out;
    },
  });
  const b = extension({
    label: "b",
    run: (_op, _call, next) => {
      order.push("b:before");
      const out = next();
      order.push("b:after");
      return out;
    },
  });
  const scope = createScope({ extensions: [a, b] });
  await scope.ready;
  scope.run(op);
  expect(order).toEqual(["a:before", "b:before", "b:after", "a:after"]);
  await scope.close();
});

test("a run hook sees an inline config too", async () => {
  let calls = 0;
  const count = extension({
    label: "count",
    run: (_op, _call, next) => {
      calls += 1;
      return next();
    },
  });
  const scope = createScope({ extensions: [count] });
  await scope.ready;
  const value: number = scope.run({ run: () => 7 });
  expect(value).toBe(7);
  expect(calls).toBe(1);
  await scope.close();
});

test("a run hook passes the call through to the operation unchanged", async () => {
  let seenInput: unknown = "unset";
  let seenCall: unknown = "unset";
  const double = operation({
    label: "double",
    input: asNumber,
    run: (_deps, ctx) => {
      seenInput = ctx.input;
      return ctx.input * 2;
    },
  });
  const pass = extension({
    label: "pass",
    run: (_op, call, next) => {
      seenCall = call;
      return next();
    },
  });
  const scope = createScope({ extensions: [pass] });
  await scope.ready;
  expect(scope.run(double, { rawInput: 21 })).toBe(42);
  expect(seenInput).toBe(21);
  expect(seenCall).toEqual({ rawInput: 21 });
  await scope.close();
});

test("a tagged call still opens its child session under the hook", async () => {
  const zone = tag<string>({ label: "zone", default: "base" });
  const read = operation({ label: "read", depends: { zone }, run: ({ zone }) => zone });
  const pass = extension({
    label: "pass",
    run: (_op, _call, next) => next(),
  });
  const scope = createScope({ extensions: [pass] });
  await scope.ready;
  expect(await scope.run(read, { tags: [zone("us")] })).toBe("us");
  await scope.close();
});

test("a session from an extended scope runs with the plain dispatch", async () => {
  let calls = 0;
  const op = operation({ label: "op", run: () => "ran" });
  const count = extension({
    label: "count",
    run: (_op, _call, next) => {
      calls += 1;
      return next();
    },
  });
  const scope = createScope({ extensions: [count] });
  await scope.ready;
  const session = scope.createSession();
  expect(session.run(op)).toBe("ran");
  expect(calls).toBe(0);
  await scope.close();
});

test("a write hook wraps controller(cell).set: before, next, after", async () => {
  const log: string[] = [];
  const cell = data({ initial: 0, parse: asNumber });
  let seen: unknown = "unset";
  const wrap = extension({
    label: "wrap",
    write: (_cell, value, next) => {
      log.push("before");
      seen = value;
      next();
      log.push("after");
    },
  });
  const scope = createScope({ extensions: [wrap] });
  await scope.ready;
  let fires = 0;
  scope.controller(cell).watch(() => {
    fires += 1;
  });
  scope.controller(cell).set(2);
  expect(scope.controller(cell).get()).toBe(2);
  expect(seen).toBe(2);
  expect(log).toEqual(["before", "after"]);
  expect(fires).toBe(1);
  await scope.close();
});

test("a write hook that skips next refuses the write: value and watchers unchanged", async () => {
  const cell = data({ initial: 1, parse: asNumber });
  const deny = extension({ label: "deny", write: () => undefined });
  const scope = createScope({ extensions: [deny] });
  await scope.ready;
  let fires = 0;
  scope.controller(cell).watch(() => {
    fires += 1;
  });
  scope.controller(cell).set(9);
  expect(scope.controller(cell).get()).toBe(1);
  expect(fires).toBe(0);
  await scope.close();
});

test("two write hooks nest in registration order", async () => {
  const order: string[] = [];
  const cell = data({ initial: 0 });
  const a = extension({
    label: "a",
    write: (_cell, _value, next) => {
      order.push("a:before");
      next();
      order.push("a:after");
    },
  });
  const b = extension({
    label: "b",
    write: (_cell, _value, next) => {
      order.push("b:before");
      next();
      order.push("b:after");
    },
  });
  const scope = createScope({ extensions: [a, b] });
  await scope.ready;
  scope.controller(cell).set(1);
  expect(order).toEqual(["a:before", "b:before", "b:after", "a:after"]);
  expect(scope.controller(cell).get()).toBe(1);
  await scope.close();
});

test("update(fn) runs through the chain with the computed value", async () => {
  const cell = data({ initial: 10, parse: asNumber });
  let seen: unknown = "unset";
  const spy = extension({
    label: "spy",
    write: (_cell, value, next) => {
      seen = value;
      next();
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  scope.controller(cell).update((n) => n + 5);
  expect(seen).toBe(15);
  expect(scope.controller(cell).get()).toBe(15);
  await scope.close();
});

test("the wrapped cell controller is cached per cell", async () => {
  const first = data({ initial: 0 });
  const second = data({ initial: 0 });
  const spy = extension({
    label: "spy",
    write: (_cell, _value, next) => next(),
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  expect(scope.controller(first)).toBe(scope.controller(first));
  expect(scope.controller(second)).not.toBe(scope.controller(first));
  await scope.close();
});

test("a cached write controller still rejects controller(cell) after close", async () => {
  const cell = data({ initial: 0 });
  const spy = extension({
    label: "spy",
    write: (_cell, _value, next) => next(),
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  scope.controller(cell);
  await scope.close();
  try {
    scope.controller(cell);
    throw new Error("unreachable");
  } catch (e) {
    if (!isError(e, "Disposed")) throw e;
  }
});

test("resource and operation controllers from the extended handle stay plain", async () => {
  let writes = 0;
  const count = extension({
    label: "count",
    write: (_cell, _value, next) => {
      writes += 1;
      next();
    },
  });
  const scope = createScope({ extensions: [count] });
  await scope.ready;
  const res = resource({ label: "res", factory: () => 7 });
  expect(scope.controller(res).resolve()).toBe(7);
  const op = operation({ label: "op", run: () => "ran" });
  expect(scope.controller(op).run()).toBe("ran");
  expect(writes).toBe(0);
  await scope.close();
});

test("a session from an extended scope writes with the plain dispatch", async () => {
  let writes = 0;
  const cell = data({ initial: 0, parse: asNumber });
  const count = extension({
    label: "count",
    write: (_cell, _value, next) => {
      writes += 1;
      next();
    },
  });
  const scope = createScope({ extensions: [count] });
  await scope.ready;
  const session = scope.createSession();
  session.controller(cell).set(1);
  expect(session.controller(cell).get()).toBe(1);
  expect(writes).toBe(0);
  await scope.close();
});

test("an op writing through a depends controller edge is not wrapped (v1 limit)", async () => {
  let writes = 0;
  const cell = data({ initial: 0, parse: asNumber });
  const count = extension({
    label: "count",
    write: (_cell, _value, next) => {
      writes += 1;
      next();
    },
  });
  const bump = operation({
    label: "bump",
    depends: { c: cell.controller },
    run: ({ c }) => c.set(5),
  });
  const scope = createScope({ extensions: [count] });
  await scope.ready;
  scope.run(bump);
  expect(writes).toBe(0);
  expect(scope.controller(cell).get()).toBe(5);
  await scope.close();
});

test("two session hooks nest in registration order and both see success", async () => {
  const order: string[] = [];
  const seen: string[] = [];
  const track = (label: string) =>
    extension({
      label,
      session: async (_handle, next) => {
        order.push(`${label}:before`);
        const ended = await next();
        seen.push(ended.status);
        order.push(`${label}:after`);
        return ended;
      },
    });
  const scope = createScope({ extensions: [track("a"), track("b")] });
  await scope.ready;
  await scope.session(() => 1);
  expect(order).toEqual(["a:before", "b:before", "b:after", "a:after"]);
  expect(seen).toEqual(["success", "success"]);
  await scope.close();
});

test("createSession plus an explicit close runs the chain: graceful success, forced cancelled", async () => {
  const seen: string[] = [];
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => {
      const ended = await next();
      seen.push(ended.status);
      return ended;
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  const graceful = scope.createSession();
  await graceful.close({ graceful: true });
  const forced = scope.createSession();
  await forced.close();
  expect(seen).toEqual(["success", "cancelled"]);
  await scope.close();
});

test("session(fn) reports the close Result: success, a failed run, a forced close", async () => {
  const seen: string[] = [];
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => {
      const ended = await next();
      seen.push(ended.status);
      return ended;
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  await scope.session(() => 1);
  const boom = new Error("session-boom");
  const failing = operation({
    label: "failing",
    run: () => Promise.reject(boom),
  });
  await scope.session((s) => s.run(failing)).catch(() => undefined);
  const poke = operation({
    label: "poke",
    run: (_deps, { signal }) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  });
  const parked = scope.session((s) => s.run(poke));
  await scope.close();
  await parked.catch(() => undefined);
  expect(seen).toEqual(["success", "failed", "cancelled"]);
  await scope.close();
});

test("a tagged call runs the session chain once", async () => {
  const zone = tag<string>({ label: "zone", default: "base" });
  const read = operation({ label: "read", depends: { zone }, run: ({ zone }) => zone });
  let calls = 0;
  const seen: string[] = [];
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => {
      calls += 1;
      const ended = await next();
      seen.push(ended.status);
      return ended;
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  expect(await scope.run(read, { tags: [zone("us")] })).toBe("us");
  expect(calls).toBe(1);
  expect(seen).toEqual(["success"]);
  await scope.close();
});

test("a session created under a session is wrapped", async () => {
  const order: string[] = [];
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => {
      order.push("before");
      const ended = await next();
      order.push("after");
      return ended;
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  await scope.session(async (outer) => {
    const inner = outer.createSession();
    await inner.close({ graceful: true });
  });
  expect(order).toEqual(["before", "before", "after", "after"]);
  await scope.close();
});

test("a scope with no session hook still runs sessions", async () => {
  const plain = createScope();
  expect(await plain.session(() => 1)).toBe(1);
  const child = plain.createSession();
  await child.close({ graceful: true });
  const zone = tag<string>({ label: "zone", default: "base" });
  const read = operation({ label: "read", depends: { zone }, run: ({ zone }) => zone });
  expect(await plain.run(read, { tags: [zone("us")] })).toBe("us");
  await plain.close();
});

test("an operation depending on an extension receives the start value after ready", async () => {
  const ext = extension<{ connect(): number }>({
    label: "driver",
    start: async (_scope, _ctx, next) => {
      await next();
      return { connect: () => 7 };
    },
  });
  const use = operation({
    label: "use",
    depends: { origin: ext },
    run: ({ origin }) => origin.connect(),
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  expect(scope.run(use)).toBe(7);
  await scope.close();
});

test("running an operation on a pending extension dependency raises NotResolved", async () => {
  const gate = deferred();
  const ext = extension<{ connect(): number }>({
    label: "driver",
    start: async (_scope, _ctx, next) => {
      await gate.promise;
      await next();
      return { connect: () => 7 };
    },
  });
  const use = operation({
    label: "use",
    depends: { origin: ext },
    run: ({ origin }) => origin.connect(),
  });
  const scope = createScope({ extensions: [ext] });
  try {
    scope.run(use);
    throw new Error("unreachable");
  } catch (e) {
    if (!isError(e, "NotResolved")) throw e;
    expect(e.payload.label).toBe("driver");
  }
  gate.resolve();
  await scope.ready;
  expect(scope.run(use)).toBe(7);
  await scope.close();
});

test("an operation depending on an extension sees the start value at runtime", async () => {
  const ext = extension<{ connect(): void }>({
    label: "typed",
    start: (_scope, _ctx, next) => next().then(() => ({ connect: () => undefined })),
  });
  const use = operation({
    label: "use",
    depends: { origin: ext },
    run: ({ origin }) => {
      expectTypeOf(origin).toEqualTypeOf<{ connect(): void }>();
      return 1;
    },
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  expect(scope.run(use)).toBe(1);
  await scope.close();
});

test("a session hook that skips next still lets the session run and close", async () => {
  const seen: string[] = [];
  const skim = extension({
    label: "skim",
    session: async (_handle, next) => {
      const ended = await next();
      seen.push(ended.status);
      return ended;
    },
  });
  const skip = extension({
    label: "skip",
    session: async () => ({ status: "success" }) as const,
  });
  const scope = createScope({ extensions: [skim, skip] });
  await scope.ready;
  expect(await scope.session(() => 41)).toBe(41);
  expect(seen).toEqual(["success"]);
  await scope.close();
});

test("a throwing session hook rejects the session with its error", async () => {
  const boom = new Error("hook-boom");
  const bad = extension({
    label: "bad",
    session: () => Promise.reject(boom),
  });
  const scope = createScope({ extensions: [bad] });
  await scope.ready;
  await expect(scope.session(() => 1)).rejects.toBe(boom);
  await scope.close();
});

test("a session felled by a forced parent close still settles next() as cancelled", async () => {
  const seen: string[] = [];
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => {
      const ended = await next();
      seen.push(ended.status);
      return ended;
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  scope.createSession();
  await scope.close();
  expect(seen).toEqual(["cancelled"]);
});

test("a session felled by a graceful parent close still settles next() as success", async () => {
  const seen: string[] = [];
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => {
      const ended = await next();
      seen.push(ended.status);
      return ended;
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  scope.createSession();
  await scope.close({ graceful: true });
  expect(seen).toEqual(["success"]);
});
