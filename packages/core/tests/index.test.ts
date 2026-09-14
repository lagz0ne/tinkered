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

test("session(fn) success commits via onOutcome; a thrown error rolls back and propagates", async () => {
  const audit: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { onOutcome }) => {
      onOutcome((o) => void audit.push(o.status === "success" ? "commit" : "rollback"));
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
    factory: (_deps, { onOutcome }) => {
      onOutcome(() => {
        throw hookError;
      });
      return 1;
    },
  });
  const good = resource({
    label: "good",
    target: "session",
    factory: (_deps, { onOutcome }) => {
      onOutcome((o) => void seen.push(o.status));
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
    factory: (_deps, { onOutcome }) => {
      onOutcome((o) => void seen.push(o.status));
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
    factory: (_deps, { onOutcome }) => {
      onOutcome((o) => void seen.push(o.status));
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

test("a failing session rolls back a resource owned by its nested child", async () => {
  const seen: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { onOutcome }) => {
      onOutcome((o) => void seen.push(o.status));
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
  expect(seen).toEqual(["failed"]);
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
    saved?.onOutcome(() => undefined);
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
    factory: (_deps, { onOutcome }) => {
      onOutcome((o) => void seen.push(o.status));
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
  scope.onClose(() => scope.close());
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
  const secondErr = await second.then(
    () => undefined,
    (e: unknown) => e,
  );
  await first.then(
    () => undefined,
    () => undefined,
  );
  if (!isError(secondErr, "TeardownFailed")) throw secondErr;
  expect(secondErr.payload.causes).toContain(hookError);
});

test("closing again after a failed close re-reports the aggregated failure", async () => {
  const hookError = new Error("hook");
  const scope = createScope();
  scope.onClose(() => {
    throw hookError;
  });
  const first = await scope.close().then(
    () => undefined,
    (e: unknown) => e,
  );
  const second = await scope.close().then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!isError(first, "TeardownFailed")) throw first;
  if (!isError(second, "TeardownFailed")) throw second;
  expect(second.payload.causes).toContain(hookError);
});

test("when owned work and the body both fail, the body cause is primary for hook and caller", async () => {
  const seen: unknown[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { onOutcome }) => {
      onOutcome((o) => void seen.push(o.status === "failed" ? o.error : "success"));
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
    factory: (_deps, { cleanup }) => {
      const id = ++built;
      cleanup(() => void cleaned.push(id));
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

test("release drops only the resource's cleanup, not a shared onClose callback", async () => {
  let calls = 0;
  const shared = () => void calls++;
  const conn = resource({
    label: "conn",
    factory: (_deps, { cleanup }) => {
      cleanup(shared);
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
    factory: (_deps, { cleanup }) => {
      cleanup(() => undefined);
      return 1;
    },
  });
  const a = resource({
    label: "a",
    factory: (_deps, { cleanup }) => {
      cleanup(() => {
        scope.release(b);
        return scope.close();
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
    factory: (_deps, { cleanup }) => {
      cleanup(() => scope.close());
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
    factory: (_deps, { onOutcome }) => {
      onOutcome((o) => void seen.push(o.status));
      return 1;
    },
  });
  const conn = resource({
    label: "conn",
    target: "session",
    factory: (_deps, { cleanup }) => {
      cleanup(async () => {
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
