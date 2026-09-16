import { expect, test } from "vite-plus/test";
import {
  createScope,
  data,
  isError,
  makeTestClock,
  type Observe,
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
  const result: number = createScope().getController(double).resolve({ rawInput: 3 });
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
  scope.getController(bump).resolve({ rawInput: 5 });
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
    run: ({ inner }) => inner.resolve({ rawInput: 9 }),
  });
  expect(createScope().getController(outer).resolve()).toBe(10);
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
    run: ({ inner }) => inner.resolve({ rawInput: 9 }),
  });
  expect(createScope().getController(outer).resolve()).toBe(10);
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
  const a = scope.getController(tx).resolve();
  const b = scope.getController(tx).resolve();
  expect(a).toBe(b);
  expect(a.from).toBe(1);
  expect(pools).toBe(1);
});

test("a resource dep the factory never reads is never built (lazy deps)", () => {
  let unusedBuilds = 0;
  const unused = resource({ label: "unused", factory: () => ({ n: ++unusedBuilds }) });
  const used = resource({ label: "used", factory: () => ({ v: "ok" }) });
  const top = resource({
    label: "top",
    depends: { unused, used },
    factory: ({ used }) => used.v,
  });
  expect(createScope().getController(top).resolve()).toBe("ok");
  expect(unusedBuilds).toBe(0);
});

test("a resource dep the factory reads twice builds once and caches (lazy access parity)", () => {
  let builds = 0;
  const dep = resource({ label: "dep", factory: () => ({ id: ++builds }) });
  const top = resource({
    label: "top",
    depends: { dep },
    factory: (deps) => deps.dep.id + deps.dep.id,
  });
  const scope = createScope();
  expect(scope.getController(top).resolve()).toBe(2);
  expect(scope.getController(top).resolve()).toBe(2);
  expect(builds).toBe(1);
});

test("an operation dep the run never reads is never built (lazy deps)", () => {
  let builds = 0;
  const unused = resource({ label: "unused", factory: () => ({ n: ++builds }) });
  const op = operation({ label: "op", depends: { unused }, run: () => "ok" });
  expect(createScope().getController(op).resolve()).toBe("ok");
  expect(builds).toBe(0);
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
  const p = createScope().getController(slow).resolve({ rawInput: 21 });
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
  const p1 = scope.getController(echo).resolve({ rawInput: 1 });
  const p2 = scope.getController(echo).resolve({ rawInput: 2 });
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
    factory: (_deps, { defer }) => {
      defer(() => void closed.push("conn"));
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
    factory: async (_deps, { defer }) => {
      await gate.promise;
      defer(() => void closed.push("conn"));
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
    s.getController(tx).resolve();
  });
  const cause = new Error("boom");
  const thrown = await root
    .session((s) => {
      s.getController(tx).resolve();
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
      s.getController(bad).resolve();
      s.getController(good).resolve();
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
    inner.getController(cell).read();
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
      s.getController(tx).resolve();
      void s.getController(failer).resolve();
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
    s.getController(tx).resolve();
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
      child.getController(tx).resolve();
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
    scope.getController(boom).resolve();
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
    void s.getController(slow).resolve();
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
      leaf.getController(tx).resolve();
      void leaf.getController(failer).resolve();
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
  void root.getController(waiter).resolve();
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
    s.getController(tx).resolve();
    void s.getController(failer).resolve();
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
  const a = scope.getController(conn).resolve();
  scope.release(conn);
  expect(cleaned).toEqual([1]);
  const b = scope.getController(conn).resolve();
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
  const first = scope.getController(conn).resolve();
  scope.release(conn);
  gate.resolve();
  await first;
  try {
    void scope.getController(conn).get();
    throw new Error("expected NotResolved");
  } catch (error) {
    if (!isError(error, "NotResolved")) throw error;
  }
});

test("releasing a data cell resets it to its initial value and notifies watchers", () => {
  const count = data({ initial: 1, parse: asNumber });
  const scope = createScope();
  const ctl = scope.getController(count);
  const seen: number[] = [];
  ctl.watch((n) => void seen.push(n));
  ctl.set(5);
  scope.release(count);
  expect(ctl.read()).toBe(1);
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
  const first = scope.getController(conn).resolve();
  scope.release(conn);
  const second = scope.getController(conn).resolve();
  gates[0].resolve();
  await first;
  gates[1].resolve();
  const b = await second;
  expect(b).toEqual({ id: 1 });
  expect(await scope.getController(conn).resolve()).toBe(b);
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
    void s
      .getController(conn)
      .resolve()
      .then(undefined, () => undefined);
    s.release(conn);
    const replacement = s.getController(conn).resolve();
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
  const first = scope.getController(conn).resolve();
  const settled = first.then(
    () => undefined,
    () => undefined,
  );
  gate.reject(new Error("boom"));
  await settled;
  const again = scope.getController(conn).resolve();
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
  const first = scope.getController(conn).resolve();
  const settled = first.then(
    () => undefined,
    () => undefined,
  );
  gate.reject(new Error("boom"));
  await settled;
  scope.release(conn);
  const rebuilt = await scope.getController(conn).resolve();
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
  const first = scope.getController(b).resolve();
  const settled = first.then(
    () => undefined,
    () => undefined,
  );
  gate.reject(new Error("boom"));
  await settled;
  scope.release(a);
  const rebuilt = await scope.getController(b).resolve();
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
  const a = s1.getController(conn).resolve();
  const b = s2.getController(conn).resolve();
  expect(b).toBe(a);
  const settled = a.then(
    () => undefined,
    () => undefined,
  );
  gate.reject(new Error("boom"));
  await settled;
  const c = s2.getController(conn).resolve();
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
  scope.getController(conn).resolve();
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
  scope.getController(flag).watch((n) => {
    if (n === 1) scope.release(conn);
  });
  scope.getController(conn).resolve();
  try {
    scope.getController(conn).get();
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
  child.getController(conn).resolve();
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
  scope.getController(b).resolve();
  scope.getController(a).resolve();
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
  scope.getController(conn).resolve();
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
      void s
        .getController(conn)
        .resolve()
        .then(undefined, () => undefined);
      gate.resolve();
      return "ok";
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  expect(thrown).toBe(cause);
});

test("a release cleanup that rejects surfaces as secondary without changing the outcome", async () => {
  const seen: string[] = [];
  const cleanupError = new Error("cleanup-fail");
  const audited = resource({
    label: "audited",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((o) => void seen.push(o.status));
      return 1;
    },
  });
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
      s.getController(audited).resolve();
      s.getController(conn).resolve();
      s.release(conn);
      return "ok";
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  expect(seen).toEqual(["success"]);
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
  scope.getController(a).resolve();
  expect([cBuilds, bBuilds, aBuilds]).toEqual([1, 1, 1]);
  scope.release(b);
  scope.getController(a).resolve();
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
  scope.getController(top).resolve();
  scope.release(d);
  expect(cleaned).toEqual(["top"]);
});

test("a cascade re-runs no command", () => {
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
  scope.getController(cmd).resolve();
  scope.getController(r).resolve();
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
  scope.getController(top).resolve();
  scope.release(base);
  scope.getController(top).resolve();
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
  for (const node of chain) scope.getController(node).resolve();
  scope.release(chain[0]);
  expect(scope.getController(chain[0]).resolve().n).toBe(0);
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
  scope.getController(base).set(5);
  scope.getController(r).resolve();
  scope.getController(base).watch(() => {
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
  const build1 = scope.getController(r).resolve();
  const settled1 = build1.then(
    () => undefined,
    () => undefined,
  );
  scope.release(r);
  await scope.getController(r).resolve();
  gate.resolve();
  await settled1;
  scope.release(base);
  const c = await scope.getController(r).resolve();
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
  s1.getController(tx).resolve();
  s2.getController(tx).resolve();
  expect([poolBuilds, txBuilds]).toEqual([1, 2]);
  root.release(pool);
  s1.getController(tx).resolve();
  s2.getController(tx).resolve();
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
  s1.getController(tx).resolve();
  const otherInstance = s2.getController(other).resolve();
  root.release(pool);
  expect(s2.getController(other).resolve()).toBe(otherInstance);
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
  s1.getController(tx).resolve();
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
  s1.getController(tx).resolve();
  s2.getController(tx).resolve();
  const closing = s1.close();
  root.release(pool);
  await closing;
  expect(poolCleaned).toBe(true);
  s2.getController(tx).resolve();
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
  s1.getController(tx).resolve();
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
  parent.getController(tx).resolve();
  child.getController(tx).resolve();
  expect([connBuilds, txBuilds]).toEqual([2, 2]);
  parent.release(conn);
  const childTx = child.getController(tx).resolve();
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
  b.getController(r).resolve();
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
    run: ({ inner }) => inner.resolve({ rawInput: 9 }),
  });
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  expect(scope.getController(outer).resolve()).toBe(10);
  const outerSpan = spans.find((s) => s.name === "outer");
  const innerSpan = spans.find((s) => s.name === "inner");
  expect(innerSpan?.parentId).toBe(outerSpan?.id);
  expect(outerSpan?.parentId).toBe(undefined);
  expect(outerSpan?.kind).toBe("operation");
});

test("two interleaved async commands keep separate parent-linked span trees (no ALS)", async () => {
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
      return leaf.resolve({ rawInput: 1 });
    },
  });
  const b = operation({
    label: "b",
    depends: { leaf },
    run: async ({ leaf }) => {
      await g2.promise;
      return leaf.resolve({ rawInput: 2 });
    },
  });
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  const pa = scope.getController(a).resolve();
  const pb = scope.getController(b).resolve();
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
  scope.getController(op).resolve();
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
  expect(scope.getController(op).resolve()).toBe(42);
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
  scope.getController(op).resolve();
  scope.getController(op).resolve();
  scope.getController(op).resolve();
  expect(scope.spans().length).toBe(2);
  expect(logs).toEqual(["hi", "hi", "hi"]);
});

test("observation on keeps the command's returned value identity (behavior-neutral)", async () => {
  const promise = Promise.resolve(7);
  const op = operation({ label: "op", run: () => promise });
  const scope = createScope({ observe: { export: () => undefined } });
  const result = scope.getController(op).resolve();
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
  expect(scope.getController(op).resolve()).toBe(1);
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
  expect(scope.getController(op).resolve()).toBe(5);
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
    scope.getController(op).resolve({ rawInput: 1 });
    throw new Error("expected the parser to throw");
  } catch (error) {
    if (error !== parseError) throw error;
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
  scope.getController(op).resolve();
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
  expect(scope.getController(op).resolve()).toBe(3);
});

test("a shared resource used by two commands links a used edge to each caller span", () => {
  const spans: Observe.Span[] = [];
  const conn = resource({ label: "conn", factory: () => ({ id: 1 }) });
  const a = operation({ label: "a", depends: { conn }, run: ({ conn }) => conn.id });
  const b = operation({ label: "b", depends: { conn }, run: ({ conn }) => conn.id });
  const scope = createScope({ observe: { export: (s) => void spans.push(s) } });
  scope.getController(a).resolve();
  scope.getController(b).resolve();
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
  expect(scope.getController(conn).resolve()).toBe(instance);
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
  const p = scope.getController(conn).resolve();
  gate.resolve();
  await p;
  const connSpan = spans.find((s) => s.name === "conn" && s.kind === "resource");
  expect(connSpan?.status).toBe("ok");
  expect(connSpan?.end).not.toBe(undefined);
});

test("a data preset is seen by a downstream command, validated by parse", () => {
  const count = data({ initial: 1, parse: asNumber });
  const read = operation({ label: "read", depends: { n: count }, run: ({ n }) => n });
  const scope = createScope({ presets: [preset(count, 42)] });
  expect(scope.getController(read).resolve()).toBe(42);
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

test("a command preset replaces the run for a downstream subflow", () => {
  const inner = operation({
    label: "inner",
    input: asNumber,
    run: (_deps, { input }) => input + 1,
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => inner.resolve({ rawInput: 9 }),
  });
  const scope = createScope({ presets: [preset(inner, (_deps, { input }) => input * 100)] });
  expect(scope.getController(outer).resolve()).toBe(900);
});

test("a command preset replaces the run for a direct resolve too", () => {
  const greet = operation({
    label: "greet",
    input: asText,
    run: (_deps, { input }) => `hello ${input}`,
  });
  const scope = createScope({ presets: [preset(greet, (_deps, { input }) => `hi ${input}`)] });
  expect(scope.getController(greet).resolve({ rawInput: "ada" })).toBe("hi ada");
});

test("a preset is scoped to its scope, not the node globally", () => {
  const count = data({ initial: 1, parse: asNumber });
  const read = operation({ label: "read", depends: { n: count }, run: ({ n }) => n });
  const presetScope = createScope({ presets: [preset(count, 42)] });
  const plainScope = createScope();
  expect(presetScope.getController(read).resolve()).toBe(42);
  expect(plainScope.getController(read).resolve()).toBe(1);
});

test("a void-input operation is always delivered as a callable subflow, never a value", () => {
  let runs = 0;
  const ping = operation({ label: "ping", run: () => ++runs });
  const outer = operation({
    label: "outer",
    depends: { ping },
    run: ({ ping }) => [ping.resolve(), ping.resolve()],
  });
  expect(createScope().getController(outer).resolve()).toEqual([1, 2]);
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
  expect(scope.getController(op).resolve({ input: 7 })).toBe(7);
  expect(parses).toBe(0);
  expect(scope.getController(op).resolve({ rawInput: 8 })).toBe(8);
  expect(parses).toBe(1);
});

test("a subflow call layers per-call tags over the caller's ambient bindings, per call only", () => {
  const zone = tag<string>({ label: "zone", default: "base" });
  const readZone = operation({ label: "readZone", depends: { zone }, run: ({ zone }) => zone });
  const scope = createScope({ tags: [zone("eu")] });
  expect(scope.getController(readZone).resolve()).toBe("eu");
  expect(scope.getController(readZone).resolve({ tags: [zone("us")] })).toBe("us");
  expect(scope.getController(readZone).resolve()).toBe("eu");
});

test("per-call tags do not propagate into a nested subflow", () => {
  const zone = tag<string>({ label: "zone", default: "base" });
  const inner = operation({ label: "inner", depends: { zone }, run: ({ zone }) => zone });
  const outer = operation({
    label: "outer",
    depends: { inner, zone },
    run: ({ inner, zone }) => `${zone}/${inner.resolve()}`,
  });
  const scope = createScope({ tags: [zone("eu")] });
  expect(scope.getController(outer).resolve({ tags: [zone("us")] })).toBe("us/eu");
});

test("an undefined input is treated as absent, so rawInput is parsed (no NaN leak)", () => {
  const double = operation({
    label: "double",
    input: asNumber,
    run: (_deps, { input }) => input * 2,
  });
  expect(createScope().getController(double).resolve({ input: undefined, rawInput: 7 })).toBe(14);
});

test("the invocation type requires an argument for a never-parse operation", () => {
  const neverRequiresArg: [] extends Parameters<Scope.CommandController<number, never>["resolve"]>
    ? false
    : true = true;
  expect(neverRequiresArg).toBe(true);
});

test("a resource preset replaces the built instance for downstream consumers", () => {
  const conn = resource({ label: "conn", factory: () => ({ id: "real" }) });
  const read = operation({ label: "read", depends: { conn }, run: ({ conn }) => conn.id });
  expect(createScope().getController(read).resolve()).toBe("real");
  const presetScope = createScope({ presets: [preset(conn, () => ({ id: "fake" }))] });
  expect(presetScope.getController(read).resolve()).toBe("fake");
});

test("a resource preset is built once per owner and cached", () => {
  let builds = 0;
  const conn = resource({ label: "conn", factory: () => ({ id: 0 }) });
  const scope = createScope({ presets: [preset(conn, () => ({ id: ++builds }))] });
  const a = scope.getController(conn).resolve();
  const b = scope.getController(conn).resolve();
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
  scope.getController(conn).resolve();
  await scope.close();
  expect(events).toEqual(["fake-teardown"]);
});

test("an async resource preset resolves to its awaited value", async () => {
  const conn = resource({ label: "conn", factory: async () => ({ id: "real" }) });
  const scope = createScope({ presets: [preset(conn, async () => ({ id: "fake" }))] });
  const value = await scope.getController(conn).resolve();
  expect(value.id).toBe("fake");
});

test("a resource preset receives the resolved deps, delivered untyped (narrow at use)", () => {
  const count = data({ initial: 41, parse: asNumber });
  const conn = resource({ label: "conn", depends: { count }, factory: ({ count }) => count + 1 });
  const scope = createScope({
    presets: [preset(conn, (deps) => asNumber(deps.count) + 100)],
  });
  expect(scope.getController(conn).resolve()).toBe(141);
});

test("a unit carries static tag meta, readable off its handle via tag.read", () => {
  const ui = tag<string>({ label: "ui" });
  const group = tag<string>({ label: "group", default: "misc" });
  const other = tag<string>({ label: "other" });
  const port = data({ initial: 8080, parse: asNumber, meta: [ui("slider")] });
  expect(port.meta.length).toBe(1);
  expect(ui.read(port)).toEqual({ present: true, value: "slider" });
  expect(group.read(port)).toEqual({ present: true, value: "misc" });
  expect(other.read(port)).toEqual({ present: false });
});

test("meta attaches to every unit kind, including a tag itself", () => {
  const ui = tag<string>({ label: "ui" });
  const op = operation({ label: "op", run: () => 1, meta: [ui("button")] });
  const res = resource({ label: "res", factory: () => 1, meta: [ui("panel")] });
  const secret = tag<string>({ label: "secret", meta: [ui("password")] });
  expect(ui.read(op)).toEqual({ present: true, value: "button" });
  expect(ui.read(res)).toEqual({ present: true, value: "panel" });
  expect(ui.read(secret)).toEqual({ present: true, value: "password" });
});

test("meta is static and never affects resolution; no meta reads as empty", () => {
  const ui = tag<string>({ label: "ui" });
  const count = data({ initial: 5, parse: asNumber, meta: [ui("slider")] });
  const read = operation({ label: "read", depends: { count }, run: ({ count }) => count });
  expect(createScope().getController(read).resolve()).toBe(5);
  expect(operation({ label: "bare", run: () => 0 }).meta).toEqual([]);
});

test("shared empty meta is frozen, so a no-meta unit cannot be mutated to leak across units", () => {
  const ui = tag<string>({ label: "ui" });
  const a = data({ initial: 0 });
  const b = resource({ label: "b", factory: () => 0 });
  expect(() => Array.prototype.push.call(a.meta, ui("leaked"))).toThrow();
  expect(ui.read(b)).toEqual({ present: false });
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
  scope.getController(a).resolve();
  scope.getController(b).resolve();
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
  scope.getController(r).resolve();
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
  scope.getController(top).resolve();
  await scope.close();
  expect(seen).toEqual(["top", "base"]);
});

test("an operation defer sees success, and failed when the run throws", () => {
  const seen: string[] = [];
  const ok = operation({
    label: "ok",
    run: (_deps, { defer }) => {
      defer((end) => void seen.push(end.status));
      return 1;
    },
  });
  const bad = operation({
    label: "bad",
    run: (_deps, { defer }) => {
      defer((end) => void seen.push(end.status));
      throw new Error("boom");
    },
  });
  createScope().getController(ok).resolve();
  expect(() => createScope().getController(bad).resolve()).toThrow();
  expect(seen).toEqual(["success", "failed"]);
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
  forced.getController(r).resolve();
  await forced.close();
  const graceful = createScope();
  graceful.getController(r).resolve();
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
  const done = scope.getController(parked).resolve();
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
  scope.getController(answer).watch((v) => void seen.push(v));
  await scope.getController(chat).resolve();
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
    void s.getController(op).resolve();
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
  const running = root.session((s) => s.getController(parked).resolve());
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
  scope.getController(r).resolve();
  const result = await scope.close();
  expect(seen).toEqual(["kept"]);
  expect(result.teardownErrors).toContain(boom);
});

test("closing a scope with thousands of defers does not overflow", async () => {
  const scope = createScope();
  for (let i = 0; i < 5000; i++) {
    const r = resource({
      label: `r${i}`,
      factory: (_deps, { defer }) => {
        defer(() => undefined);
        return i;
      },
    });
    scope.getController(r).resolve();
  }
  await scope.close();
  expect(true).toBe(true);
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
  const done = root.session((s) => s.getController(tx).resolve());
  await Promise.all([root.close(), done.catch(() => undefined)]);
  expect(seen).toEqual(["cancelled"]);
});

test("closing a deeply nested scope tree does not overflow", async () => {
  const root = createScope();
  let leaf = root;
  for (let i = 0; i < 3000; i++) leaf = leaf.createSession();
  await root.close();
  expect(true).toBe(true);
  // 3000-deep async close cascade: generous timeout so coverage-instrumented runs (mutation) don't
  // flake on the default 5s; the assertion here is "no stack overflow", not wall-clock speed.
}, 30000);

test("an owned rejection with an undefined cause keeps that cause", async () => {
  const op = operation({ label: "fail", run: () => Promise.reject(undefined) });
  const done = createScope().session((s) => {
    void s.getController(op).resolve();
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
  scope.getController(op).resolve();
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
      return inner.createSession().getController(park).resolve();
    });
  });
  const rejected = done.catch(() => undefined);
  const closing = closeBoundary();
  await Promise.resolve();
  gate.resolve();
  await closing;
  await rejected;
  expect(true).toBe(true);
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
      void child
        .getController(failer)
        .resolve()
        .catch(() => undefined);
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
      void leaf
        .getController(failer)
        .resolve()
        .catch(() => undefined);
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
      void late
        .getController(failer)
        .resolve()
        .catch(() => undefined);
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
    void s
      .getController(bad)
      .resolve()
      .catch(() => undefined);
    return s.getController(tx).resolve();
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
          await child
            .getController(failer)
            .resolve()
            .catch(() => undefined);
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
  child.getController(tx).resolve();
  await scope
    .getController(failer)
    .resolve()
    .catch(() => undefined);
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
    await child
      .getController(failer)
      .resolve()
      .then(
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
      scope.createSession().getController(tx).resolve();
      await bodyGate.promise;
    })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  await failedChild
    .getController(failer)
    .resolve()
    .then(
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
  const failed = first
    .getController(failer)
    .resolve()
    .then(
      () => expect.unreachable(),
      (e: unknown) => expect(e).toBe(cause),
    );
  root.createSession().getController(tx).resolve();
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
      childSignal = child.getController(tx).resolve();
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
    await expect(child.getController(bad).resolve()).rejects.toBe(own);
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
    child.getController(tx).resolve();
    await expect(child.getController(bad).resolve()).rejects.toBe(ownedCause);
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
    await expect(child.getController(bad).resolve()).rejects.toBe(own);
    return child.session(() => Promise.reject(ancestor));
  });
  await expect(done).rejects.toBe(ancestor);
  await root.close();
});

test("a reused error object is a later session's own body failure, not a stale propagation", async () => {
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
    child.getController(tx).resolve();
    await expect(child.getController(bad).resolve()).rejects.toBe(ownedCause);
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
    parent.getController(tx).resolve();
    parent.createSession();
    await expect(parent.getController(bad).resolve()).rejects.toBe(ownedCause);
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
    parent.getController(tx).resolve();
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
  scope.getController(top).resolve();
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
  const running = scope.getController(op).resolve();
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
  scope.getController(op).resolve();
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
  const running = child.getController(use).resolve();
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
  const running = child.getController(use).resolve();
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
  child.getController(tx).resolve();
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
  await scope.getController(use).resolve();
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
  const running = child.getController(use).resolve();
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
  expect(() => scope.getController(use).resolve()).toThrow(cause);
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
  const running = scope.getController(use).resolve();
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
  const oldBuild = root.getController(conn).resolve();
  root.release(conn);
  await root.getController(conn).resolve();
  gate.resolve();
  await oldBuild;
  const open = await child.getController(use).resolve();
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
        root.getController(conn).resolve();
      });
      return deps.conn;
    },
  });
  const child = root.createSession();
  child.getController(tx).resolve();
  root.release(conn);
  const open = root.getController(conn).get().open;
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
  child.getController(tx).resolve();
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
  scope.getController(use).resolve();
  gate.resolve();
  await scope.close();
  expect(order).toEqual(["op-clean-open", "conn-clean"]);
});

test("a clean scope closes success when graceful, cancelled when forced, and never throws", async () => {
  const graceful = await createScope().close({ graceful: true });
  expect(graceful).toEqual({ status: "success", teardownErrors: undefined });
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

test("a released build's first lazy read cannot invalidate its unused replacement", async () => {
  const gate = deferred();
  let builds = 0;
  const base = resource({ label: "base", factory: () => ({}) });
  const view = resource({
    label: "view",
    depends: { base },
    factory: async (deps) => {
      const generation = ++builds;
      if (generation === 1) {
        await gate.promise;
        void deps.base;
      }
      return { generation };
    },
  });
  const scope = createScope();
  const controller = scope.getController(view);
  const old = controller.resolve();
  scope.release(view);
  const replacement = await controller.resolve();
  gate.resolve();
  await old;
  scope.release(base);
  const current = await controller.resolve();
  await scope.close();
  expect(current).toBe(replacement);
});

test("an operation reads the scope's clock, and advancing it moves later reads", () => {
  const clk = makeTestClock({ now: 0 });
  const now = operation({ label: "now", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const c = createScope({ clock: clk }).getController(now);
  expect(c.resolve()).toBe(0);
  clk.advance(50);
  expect(c.resolve()).toBe(50);
});

test("a resource factory reads the scope's clock", () => {
  const stamped = resource({
    label: "stamped",
    factory: (_deps, { clock }) => clock.currentTimeMillis(),
  });
  const built: number = createScope({ clock: makeTestClock({ now: 500 }) })
    .getController(stamped)
    .resolve();
  expect(built).toBe(500);
});

test("the test clock handles fractional virtual time: truncated millis, precise nanos", () => {
  const millis = operation({ label: "ms", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const nanos = operation({ label: "ns", run: (_deps, { clock }) => clock.currentTimeNanos() });
  const scope = createScope({ clock: makeTestClock({ now: 2.5 }) });
  expect(scope.getController(millis).resolve()).toBe(2);
  expect(scope.getController(nanos).resolve()).toBe(2_500_000n);
});

test("the default scope clock reads real wall-clock time", () => {
  const now = operation({ label: "now", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const before = Date.now();
  const read: number = createScope().getController(now).resolve();
  const after = Date.now();
  expect(read).toBeGreaterThanOrEqual(before);
  expect(read).toBeLessThanOrEqual(after);
});

test("a child session reads its parent scope's clock", async () => {
  const now = operation({ label: "now", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const scope = createScope({ clock: makeTestClock({ now: 1234 }) });
  const seen = await scope.session((s) => s.getController(now).resolve());
  expect(seen).toBe(1234);
});

test("setTime replaces the test clock's current time", () => {
  const clk = makeTestClock({ now: 100 });
  const now = operation({ label: "now", run: (_deps, { clock }) => clock.currentTimeMillis() });
  const c = createScope({ clock: clk }).getController(now);
  expect(c.resolve()).toBe(100);
  clk.setTime(9000);
  expect(c.resolve()).toBe(9000);
});

test("a resource factory that defaults its deps param still reads the injected clock", () => {
  const stamped = resource({
    label: "stamped-default-deps",
    factory: (_deps = {}, { clock }) => clock.currentTimeMillis(),
  });
  const built: number = createScope({ clock: makeTestClock({ now: 777 }) })
    .getController(stamped)
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
  const woke = createScope({ clock: clk }).getController(nap).resolve();
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
  const p = createScope({ clock: clk }).getController(nap).resolve();
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
  const p = createScope().getController(nap).resolve();
  ac.abort(cause);
  await expect(p).rejects.toBe(cause);
});

test("a test-clock sleep of zero resolves without advancing time", async () => {
  const clk = makeTestClock({ now: 0 });
  const nap = operation({
    label: "nap0",
    run: (_deps, { clock }) => clock.sleep(0).then(() => "woke"),
  });
  expect(await createScope({ clock: clk }).getController(nap).resolve()).toBe("woke");
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
  const done = scope.getController(napping).resolve();
  const result = await scope.close();
  expect(result.status).toBe("cancelled");
  expect(end).toBe("cancelled");
  await expect(done).rejects.toBeDefined();
});
