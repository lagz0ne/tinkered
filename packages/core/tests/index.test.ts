import { expect, test } from "vite-plus/test";
import {
  createScope,
  data,
  isError,
  operation,
  resource,
  type Resource,
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
  expect(createScope().getController(count).read()).toBe(1);
});

test("parse transforms + validates the initial, and the read type is inferred", () => {
  const trimmed = (v: unknown): string => {
    if (typeof v !== "string") throw new Error("not a string");
    return v.trim();
  };
  const name = data({ initial: "  ada  ", parse: trimmed });
  const value: string = createScope().getController(name).get();
  expect(value).toBe("ada");
});

test("set and update are reflected on the next read", () => {
  const count = data({ initial: 0 });
  const c = createScope().getController(count);
  c.set(5);
  expect(c.read()).toBe(5);
  c.update((n) => n + 1);
  expect(c.read()).toBe(6);
});

test("watch fires once per real change, never on an eq-equal write; unsubscribe stops it", () => {
  const count = data({ initial: 0 });
  const c = createScope().getController(count);
  const seen: number[] = [];
  const stop = c.watch((n) => seen.push(n));
  c.set(1);
  c.set(1);
  expect(seen).toEqual([1]);
  stop();
  c.set(2);
  expect(seen).toEqual([1]);
});

test("an invalid write throws DataValidationFailed with a typed payload", () => {
  const nonNegative = (v: unknown): number => {
    if (typeof v !== "number" || v < 0) throw new Error("must be >= 0");
    return v;
  };
  const count = data({ label: "count", initial: 0, parse: nonNegative });
  const c = createScope().getController(count);
  try {
    c.set(-1);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "DataValidationFailed")) throw error;
    expect(error.payload.label).toBe("count");
  }
});

test("a command parses rawInput into typed input and returns synchronously", () => {
  const double = operation({
    label: "double",
    input: asNumber,
    run: (_deps, { input }) => input * 2,
  });
  const result: number = createScope().getController(double).resolve(3);
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
  expect(scope.getController(peek).resolve()).toBe(10);
  scope.getController(bump).resolve(5);
  expect(scope.getController(peek).resolve()).toBe(15);
});

test("a command runs on every resolve (never memoized)", () => {
  let runs = 0;
  const ping = operation({ label: "ping", run: () => ++runs });
  const c = createScope().getController(ping);
  c.resolve();
  c.resolve();
  expect(runs).toBe(2);
});

test("a command composes a child command through its controller", () => {
  const inner = operation({
    label: "inner",
    input: asNumber,
    run: (_deps, { input }) => input + 1,
  });
  const outer = operation({
    label: "outer",
    depends: { inner: inner.controller },
    run: ({ inner }) => inner.resolve(9),
  });
  expect(createScope().getController(outer).resolve()).toBe(10);
});

test("a bare command used as a value dependency is rejected", () => {
  const x = operation({ label: "x", run: () => 1 });
  const bad = operation({ label: "bad", depends: { x }, run: () => 1 });
  try {
    createScope().getController(bad).resolve();
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "InvalidDependency")) throw error;
    expect(error.payload.label).toBe("x");
  }
});

const region = tag<string>({ label: "region", default: "base" });
const maybe = tag<string | undefined>({ label: "maybe", default: undefined });
const secret = tag<string>({ label: "secret" });

test("a required tag reads its binding, or its default when unbound", () => {
  const read = operation({ label: "read", depends: { region }, run: ({ region }) => region });
  expect(createScope().getController(read).resolve()).toBe("base");
  expect(
    createScope({ tags: [region("eu")] })
      .getController(read)
      .resolve(),
  ).toBe("eu");
});

test("a required tag with no binding and no default throws MissingTag", () => {
  const read = operation({ label: "read", depends: { secret }, run: ({ secret }) => secret });
  try {
    createScope().getController(read).resolve();
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload.label).toBe("secret");
  }
});

test("optional distinguishes absent from an undefined default", () => {
  const readMaybe = operation({ label: "m", depends: { m: maybe.optional }, run: ({ m }) => m });
  const readSecret = operation({ label: "s", depends: { s: secret.optional }, run: ({ s }) => s });
  expect(createScope().getController(readMaybe).resolve()).toEqual({
    present: true,
    value: undefined,
  });
  expect(createScope().getController(readSecret).resolve()).toEqual({ present: false });
  expect(
    createScope({ tags: [secret("x")] })
      .getController(readSecret)
      .resolve(),
  ).toEqual({ present: true, value: "x" });
});

test("all returns every binding nearest-first, with no default fallback", () => {
  const readAll = operation({ label: "all", depends: { xs: region.all }, run: ({ xs }) => xs });
  expect(
    createScope({ tags: [region("a"), region("b")] })
      .getController(readAll)
      .resolve(),
  ).toEqual(["b", "a"]);
  expect(createScope().getController(readAll).resolve()).toEqual([]);
});

test("a tag binding is validated by parse", () => {
  const port = tag<number>({
    label: "port",
    parse: (v) => {
      if (typeof v !== "number" || v <= 0) throw new Error("bad port");
      return v;
    },
  });
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

test("an async command resolves to its awaited value", async () => {
  const gate = deferred();
  const slow = operation({
    label: "slow",
    input: asNumber,
    run: async (_deps, { input }) => {
      await gate.promise;
      return input * 2;
    },
  });
  const p = createScope().getController(slow).resolve(21);
  gate.resolve();
  expect(await p).toBe(42);
});

test("a rejecting async command rejects with its cause, and settled still drains", async () => {
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
  const p = scope.getController(boom).resolve();
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
  const p = scope.getController(slow).resolve();
  scope.getController(n).set(99);
  gate.resolve();
  expect(await p).toBe(1);
});

test("concurrent calls are independent, released in reverse entry order", async () => {
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
  const p1 = scope.getController(echo).resolve(1);
  const p2 = scope.getController(echo).resolve(2);
  await entered.get(1)!.promise;
  await entered.get(2)!.promise;
  release.get(2)!.resolve();
  release.get(1)!.resolve();
  expect(await p1).toBe(10);
  expect(await p2).toBe(20);
});

test("overlapping scopes keep separate data snapshots (no shared/ambient state)", async () => {
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
  a.getController(n).set(1);
  b.getController(n).set(2);
  const pa = a.getController(readN).resolve();
  const pb = b.getController(readN).resolve();
  gate.resolve();
  expect(await pb).toBe(2);
  expect(await pa).toBe(1);
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
  const p = scope.getController(slow).resolve();
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
  expect(child.getController(theme).read()).toBe("light");
  expect(child.getController(readRegion).resolve()).toBe("root");
  root.getController(theme).set("dark");
  expect(child.getController(theme).read()).toBe("dark");
});

test("a session write shadows locally (copy-on-write); the parent is unchanged", () => {
  const theme = data({ initial: "light", parse: asText });
  const root = createScope();
  const child = root.createSession();
  root.getController(theme).set("dark");
  child.getController(theme).set("solar");
  expect(child.getController(theme).read()).toBe("solar");
  expect(root.getController(theme).read()).toBe("dark");
});

test("inherited watchers react to parent writes until the child shadows", () => {
  const n = data({ initial: 0, parse: asNumber });
  const root = createScope();
  const child = root.createSession();
  const seen: number[] = [];
  const stop = child.getController(n).watch((v) => seen.push(v));
  root.getController(n).set(1);
  expect(seen).toEqual([1]);
  child.getController(n).set(2);
  expect(seen).toEqual([1, 2]);
  root.getController(n).set(3);
  expect(seen).toEqual([1, 2]);
  stop();
});

test("nested tags: nearest layer wins, and .all collects nearest-first across layers", () => {
  const region = tag<string>({ label: "region", default: "base" });
  const nearest = operation({ label: "n", depends: { region }, run: ({ region }) => region });
  const every = operation({ label: "e", depends: { xs: region.all }, run: ({ xs }) => xs });
  const root = createScope({ tags: [region("root")] });
  const child = root.createSession({ tags: [region("sess")] });
  expect(child.getController(nearest).resolve()).toBe("sess");
  expect(child.getController(every).resolve()).toEqual(["sess", "root"]);
  expect(root.getController(nearest).resolve()).toBe("root");
});

test("a nearer shadow invalidates a descendant's cached effective cell", () => {
  const v = data({ initial: "a", parse: asText });
  const root = createScope();
  const mid = root.createSession();
  const leaf = mid.createSession();
  expect(leaf.getController(v).read()).toBe("a");
  root.getController(v).set("b");
  expect(leaf.getController(v).read()).toBe("b");
  mid.getController(v).set("c");
  expect(leaf.getController(v).read()).toBe("c");
  expect(root.getController(v).read()).toBe("b");
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

test("close joins in-flight command work before completing", async () => {
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
  void scope.getController(slow).resolve();
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
  const c = scope.getController(n);
  await scope.close();
  try {
    scope.getController(n);
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
  const error = await scope.close().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(ran).toEqual(["c", "a"]);
  if (!isError(error, "TeardownFailed")) throw error;
  expect(error.payload.causes).toContain(cause);
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

test("close joins command work started before the command's first await", async () => {
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
  void scope.getController(selfClose).resolve();
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
  const ctl = scope.getController(conn);
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
  scope.getController(port).set(6000);
  expect(scope.getController(conn).resolve()).toBe("db:6000");
});

test("resource cleanup runs on close", async () => {
  const closed: string[] = [];
  const conn = resource({
    label: "conn",
    factory: (_deps, { cleanup }) => {
      cleanup(() => void closed.push("conn"));
      return "open";
    },
  });
  const scope = createScope();
  scope.getController(conn).resolve();
  await scope.close();
  expect(closed).toEqual(["conn"]);
});

test("get() before resolve fails with NotResolved", () => {
  const conn = resource({ label: "conn", factory: () => "open" });
  const scope = createScope();
  try {
    scope.getController(conn).get();
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
  const ctl = child.getController(conn);
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
  const ctl = leaf.getController(conn);
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
    factory: () => scope.getController(cyclic).resolve(),
  });
  try {
    scope.getController(cyclic).resolve();
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
  const ctl = createScope().getController(conn);
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
  const ctl = createScope().getController(conn);
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
  void scope.getController(conn).resolve();
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
  const build = scope.getController(conn).resolve();
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
    factory: async (_deps, { cleanup }) => {
      await gate.promise;
      cleanup(() => void closed.push("conn"));
      return "open";
    },
  });
  const scope = createScope();
  void scope.getController(conn).resolve();
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
  const value: number = await createScope().getController(conn).resolve();
  expect(value).toBe(42);
});

test("a scope-target resource is one instance shared across sessions", () => {
  let built = 0;
  const conn = resource({ label: "conn", factory: () => ({ id: ++built }) });
  const root = createScope();
  const s1 = root.createSession();
  const s2 = root.createSession();
  const a = s1.getController(conn).resolve();
  const b = s2.getController(conn).resolve();
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
  const a1 = s1.getController(conn).resolve();
  const a2 = s1.getController(conn).resolve();
  const b = s2.getController(conn).resolve();
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
    session.getController(conn).resolve();
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
  session.getController(port).set(6000);
  expect(session.getController(conn).resolve()).toBe("eu:6000");
});
