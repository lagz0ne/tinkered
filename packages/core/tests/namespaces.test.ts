import { expect, test } from "vite-plus/test";
import {
  createScope,
  data,
  extension,
  isError,
  namespace,
  operation,
  resource,
  tag,
  type Ns,
  type Resource,
} from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

const cellOps = (cell: ReturnType<typeof data<number>>) => ({
  bump: operation({
    label: "bump",
    input: asNumber,
    depends: { c: cell.controller },
    run: ({ c }, ctx) => {
      c.set(ctx.input);
      return c.get();
    },
  }),
  read: operation({
    label: "read",
    depends: { count: cell },
    run: ({ count }) => count,
  }),
});

test("two namespaces split one cell; the default is untouched", () => {
  const a = namespace();
  const b = namespace();
  const count = data({ label: "count", initial: 0, parse: asNumber });
  const { bump, read } = cellOps(count);
  const scope = createScope();
  expect(scope.run(bump, { input: 1, ns: a })).toBe(1);
  expect(scope.run(bump, { input: 2, ns: b })).toBe(2);
  expect(scope.run(read, { ns: a })).toBe(1);
  expect(scope.run(read, { ns: b })).toBe(2);
  expect(scope.run(read, { ns: [a, b] })).toBe(1);
  expect(scope.run(read)).toBe(0);
  expect(scope.resolve(count)).toBe(0);
  expect(scope.controller(count, { ns: b }).get()).toBe(2);
  return scope.close();
});

test("a tag chain [a, muse] finds the binding bound in muse", () => {
  const model = tag<string>({ label: "model" });
  const a = namespace();
  const muse = namespace({ tags: [model("claude")] });
  const getModel = operation({
    label: "getModel",
    depends: { model },
    run: ({ model }) => model,
  });
  const scope = createScope();
  expect(scope.run(getModel, { ns: [a, muse] })).toBe("claude");
  expect(scope.resolve(model.required, { ns: [a, muse] })).toBe("claude");
  expect(scope.resolve(model.optional, { ns: [a] })).toEqual({ present: false });
  let error: unknown;
  try {
    scope.run(getModel, { ns: [a] });
  } catch (cause) {
    error = cause;
  }
  expect(isError(error, "MissingTag")).toBe(true);
  return scope.close();
});

test("ambient createSession({ ns }) resolves in that ns; a per-call ns wins for one run", () => {
  const a = namespace();
  const b = namespace();
  const count = data({ label: "count", initial: 0, parse: asNumber });
  const { bump, read } = cellOps(count);
  const scope = createScope();
  const session = scope.createSession({ ns: a });
  expect(session.run(bump, { input: 5 })).toBe(5);
  expect(session.run(read)).toBe(5);
  expect(scope.resolve(count)).toBe(0);
  expect(session.run(read, { ns: b })).toBe(0);
  expect(session.run(read)).toBe(5);
  return scope.close();
});

test("a child's own default write shadows a parent's namespaced write (layers-first)", () => {
  const a = namespace();
  const b = namespace();
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const scope = createScope();
  const parent = scope.createSession();
  parent.controller(cell, { ns: b }).set(99);
  const child = parent.createSession();
  child.controller(cell).set(7);
  expect(child.controller(cell, { ns: [a, b] }).get()).toBe(7);
  expect(parent.controller(cell, { ns: [a, b] }).get()).toBe(99);
  return scope.close();
});

test("tags and cells both use layers-first chain order", () => {
  const value = tag<number>({ label: "value" });
  const far = namespace({ tags: [value(99)] });
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const scope = createScope();
  scope.controller(cell, { ns: far }).set(99);
  const child = scope.createSession({ tags: [value(7)] });
  child.controller(cell).set(7);
  expect(child.resolve(cell, { ns: far })).toBe(7);
  expect(child.resolve(value, { ns: far })).toBe(7);
  expect(child.resolve(value.all, { ns: far })).toEqual([7, 99]);
  return scope.close();
});

test("a child session inherits the parent's ambient ns; its own ns replaces it", () => {
  const model = tag<string>({ label: "model" });
  const muse = namespace({ tags: [model("claude")] });
  const other = namespace({ tags: [model("gpt")] });
  const getModel = operation({
    label: "getModel",
    depends: { model },
    run: ({ model }) => model,
  });
  const scope = createScope();
  const outer = scope.createSession({ ns: muse });
  const inner = outer.createSession();
  expect(inner.run(getModel)).toBe("claude");
  const own = outer.createSession({ ns: other });
  expect(own.run(getModel)).toBe("gpt");
  expect(inner.run(getModel)).toBe("claude");
  return scope.close();
});

test("a named write lands at (layer, first key) and never notifies a default watcher", () => {
  const a = namespace();
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const scope = createScope();
  const defaultSeen: number[] = [];
  scope.controller(cell).watch((next) => defaultSeen.push(next));
  const ctl = scope.controller(cell, { ns: a });
  ctl.set(3);
  expect(scope.resolve(cell, { ns: a })).toBe(3);
  expect(scope.resolve(cell)).toBe(0);
  expect(defaultSeen).toEqual([]);
  const namedSeen: number[] = [];
  scope.controller(cell, { ns: a }).watch((next) => namedSeen.push(next));
  ctl.set(4);
  expect(namedSeen).toEqual([4]);
  expect(defaultSeen).toEqual([]);
  return scope.close();
});

test("a subflow .run({ input, ns }) writes its own bucket; without ns it inherits the run's", () => {
  const a = namespace();
  const b = namespace();
  const count = data({ label: "count", initial: 0, parse: asNumber });
  const bump = operation({
    label: "bump",
    input: asNumber,
    depends: { c: count.controller },
    run: ({ c }, ctx) => {
      c.set(ctx.input);
    },
  });
  const override = operation({
    label: "override",
    depends: { bump },
    run: ({ bump }) => {
      bump.run({ input: 9, ns: b });
    },
  });
  const inherit = operation({
    label: "inherit",
    depends: { bump },
    run: ({ bump }) => {
      bump.run({ input: 8 });
    },
  });
  const scope = createScope();
  scope.run(override, { ns: a });
  expect(scope.resolve(count, { ns: b })).toBe(9);
  expect(scope.resolve(count, { ns: a })).toBe(0);
  scope.run(inherit, { ns: a });
  expect(scope.resolve(count, { ns: a })).toBe(8);
  expect(scope.resolve(count)).toBe(0);
  return scope.close();
});

test("a tagged subflow inherits its named caller's namespace", async () => {
  const named = namespace();
  const marker = tag({ label: "marker", default: false });
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const child = operation({
    label: "child",
    depends: { cell: cell.controller, marker },
    run: ({ cell, marker }) => {
      expect(marker).toBe(true);
      cell.set(cell.get() + 2);
      return cell.get();
    },
  });
  const parent = operation({
    label: "parent",
    depends: { child },
    run: ({ child }) => child.run({ tags: [marker(true)] }),
  });
  const scope = createScope();
  scope.controller(cell, { ns: named }).set(3);
  expect(await scope.run(parent, { ns: named })).toBe(5);
  expect(scope.resolve(cell, { ns: named })).toBe(3);
  expect(scope.resolve(cell)).toBe(0);
  await scope.close();
});

test("named calls keep the real layer lifecycle and extension registry", async () => {
  const readyValue = extension({ label: "readyValue", start: async () => 42 });
  const named = namespace();
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const readExtension = operation({
    label: "readExtension",
    depends: { readyValue },
    run: ({ readyValue }) => readyValue,
  });
  const waitForAbort = operation({
    label: "waitForAbort",
    run: (_deps, ctx) =>
      new Promise<boolean>((resolve) => {
        ctx.signal.addEventListener("abort", () => resolve(ctx.signal.aborted), { once: true });
      }),
  });
  const scope = createScope({ extensions: [readyValue] });
  await scope.ready;
  expect(scope.run(readExtension, { ns: named })).toBe(42);
  const waiting = scope.run(waitForAbort, { ns: named });
  const closing = scope.close();
  expect(await waiting).toBe(true);
  await closing;
  expect(() => scope.controller(cell, { ns: named }).set(1)).toThrow("Disposed");
});

test("a tagged subflow in a named run uses session hooks", async () => {
  let sessions = 0;
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => {
      sessions += 1;
      return next();
    },
  });
  const marker = tag({ label: "marker", default: 0 });
  const child = operation({ label: "child", depends: { marker }, run: ({ marker }) => marker });
  const parent = operation({
    label: "parent",
    depends: { child },
    run: ({ child }) => child.run({ tags: [marker(1)] }),
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  expect(await scope.run(parent, { ns: namespace() })).toBe(1);
  expect(sessions).toBe(1);
  await scope.close();
});

test("pass-through extensions preserve namespaces for writes and resolves", async () => {
  const pass = extension({
    label: "pass",
    resolve: (_target, next) => next(),
    write: (_target, _value, next) => next(),
  });
  const named = namespace();
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const scope = createScope({ extensions: [pass] });
  await scope.ready;
  const defaultSeen: number[] = [];
  scope.controller(cell).watch((next) => defaultSeen.push(next));
  scope.controller(cell, { ns: named }).set(4);
  expect(scope.resolve(cell, { ns: named })).toBe(4);
  expect(scope.resolve(cell)).toBe(0);
  expect(defaultSeen).toEqual([]);
  await scope.close();
});

test("invalid input leaves no namespace resource bucket behind", async () => {
  const tenant = tag<string>({ label: "tenant" });
  const a = namespace({ tags: [tenant("A")] });
  const b = namespace({ tags: [tenant("B")] });
  const ended: string[] = [];
  const client = resource({
    label: "client",
    target: "session",
    depends: { tenant },
    factory: ({ tenant }, ctx) => {
      ctx.defer((end) => void ended.push(`${tenant}:${end.status}`));
      return tenant;
    },
  });
  const bad = operation({
    label: "bad",
    input: () => {
      throw new Error("bad input");
    },
    depends: { client },
    run: ({ client }) => client,
  });
  const scope = createScope();
  try {
    scope.run(bad, { rawInput: 1, ns: b });
  } catch {}
  expect(scope.resolve(client, { ns: [a, b] })).toBe("A");
  expect(scope.resolve(client, { ns: b })).toBe("B");
  scope.releaseNs(client, b);
  expect(ended).toEqual(["B:released"]);
  await scope.close({ graceful: true });
  expect(ended).toEqual(["B:released", "A:success"]);
});

test("a session-target resource builds once in each namespace and reuses its warm bucket", () => {
  const a = namespace();
  const b = namespace();
  let builds = 0;
  const client = resource({
    label: "client",
    target: "session",
    factory: () => ({ build: ++builds }),
  });
  const scope = createScope();
  const firstA = scope.resolve(client, { ns: a });
  const secondA = scope.resolve(client, { ns: a });
  const firstB = scope.resolve(client, { ns: b });
  expect(secondA).toBe(firstA);
  expect(firstB).not.toBe(firstA);
  expect(builds).toBe(2);
  return scope.close();
});

test("a resource namespace chain reuses its first built fallback bucket", () => {
  const a = namespace();
  const b = namespace();
  let builds = 0;
  const client = resource({
    label: "client",
    target: "session",
    factory: () => ({ build: ++builds }),
  });
  const scope = createScope();
  const fromB = scope.resolve(client, { ns: b });
  expect(scope.resolve(client, { ns: [a, b] })).toBe(fromB);
  const fromA = scope.resolve(client, { ns: a });
  expect(scope.resolve(client, { ns: [a, b] })).toBe(fromA);
  expect(builds).toBe(2);
  return scope.close();
});

test("a named resource controller keeps one settled async promise per bucket", async () => {
  const a = namespace();
  const b = namespace();
  let builds = 0;
  const client = resource({
    label: "async-client",
    target: "session",
    factory: async () => ({ build: ++builds }),
  });
  const scope = createScope();
  const ctlA = scope.controller(client, { ns: a });
  const firstA = ctlA.resolve();
  expect(ctlA.resolve()).toBe(firstA);
  expect(await firstA).toEqual({ build: 1 });
  expect(ctlA.get()).toBe(firstA);
  const firstB = scope.controller(client, { ns: b }).resolve();
  expect(firstB).not.toBe(firstA);
  expect(await firstB).toEqual({ build: 2 });
  await scope.close();
});

test("a named resource controller reports NotResolved before its first build", async () => {
  const a = namespace();
  const client = resource({ label: "client", target: "session", factory: () => ({}) });
  const scope = createScope();
  let error: unknown;
  try {
    scope.controller(client, { ns: a }).get();
  } catch (cause) {
    error = cause;
  }
  if (!isError(error, "NotResolved")) throw error;
  expect(error.payload.label).toBe("client");
  await scope.close();
});

test("a named controller keeps a scope-target resource namespace-blind", async () => {
  const a = namespace();
  const shared = resource({ label: "shared", target: "scope", factory: () => ({}) });
  const scope = createScope();
  const ctl = scope.controller(shared, { ns: a });
  const value = ctl.resolve();
  expect(ctl.get()).toBe(value);
  await scope.close();
});

test("a failed async named build stays on its bucket until releaseNs", async () => {
  const a = namespace();
  const cause = new Error("build failed");
  let builds = 0;
  const client = resource({
    label: "client",
    target: "session",
    factory: async () => {
      builds += 1;
      throw cause;
    },
  });
  const scope = createScope();
  const ctl = scope.controller(client, { ns: a });
  const first = ctl.resolve();
  await expect(first).rejects.toBe(cause);
  expect(ctl.resolve()).toBe(first);
  expect(ctl.get()).toBe(first);
  scope.releaseNs(client, a);
  const second = ctl.resolve();
  expect(second).not.toBe(first);
  await expect(second).rejects.toBe(cause);
  expect(builds).toBe(2);
  await scope.close();
});

test("a circular named resource fails instead of reading a half-built bucket", async () => {
  const a = namespace();
  const scope = createScope();
  let client: Resource.Handle<unknown>;
  client = resource({
    label: "client",
    target: "session",
    factory: () => scope.resolve(client, { ns: a }),
  });
  let error: unknown;
  try {
    scope.resolve(client, { ns: a });
  } catch (cause) {
    error = cause;
  }
  if (!isError(error, "CircularResource")) throw error;
  expect(error.payload.label).toBe("client");
  await scope.close();
});

test("named session resources stay distinct across owner layers", async () => {
  const a = namespace();
  let builds = 0;
  const client = resource({
    label: "client",
    target: "session",
    factory: () => ({ build: ++builds }),
  });
  const scope = createScope();
  const child = scope.createSession();
  expect(child.resolve(client, { ns: a })).not.toBe(scope.resolve(client, { ns: a }));
  expect(builds).toBe(2);
  await scope.close();
});

test("a chain controller follows a nearer namespace bucket built later", async () => {
  const a = namespace();
  const b = namespace();
  let builds = 0;
  const client = resource({
    label: "client",
    target: "session",
    factory: () => ({ build: ++builds }),
  });
  const scope = createScope();
  const fromB = scope.resolve(client, { ns: b });
  const ctl = scope.controller(client, { ns: [a, b] });
  expect(ctl.resolve()).toBe(fromB);
  const fromA = scope.resolve(client, { ns: a });
  expect(ctl.get()).toBe(fromA);
  await scope.close();
});

test("a chain borrow waits on the fallback bucket it resolved", async () => {
  const a = namespace();
  const b = namespace();
  const ended: string[] = [];
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const client = resource({
    label: "client",
    target: "session",
    factory: (_deps, ctx) => {
      ctx.defer(() => void ended.push("client"));
      return {};
    },
  });
  const hold = operation({
    label: "hold",
    depends: { client },
    run: async () => gate,
  });
  const scope = createScope();
  scope.resolve(client, { ns: b });
  const running = scope.run(hold, { ns: [a, b] });
  scope.releaseNs(client, a);
  expect(ended).toEqual([]);
  scope.releaseNs(client, b);
  expect(ended).toEqual([]);
  finish();
  await running;
  await scope.settled();
  expect(ended).toEqual(["client"]);
  await scope.close();
});

test("a named run borrows the bucket selected after earlier dependencies resolve", async () => {
  const tenant = tag<string>({ label: "tenant" });
  const a = namespace({ tags: [tenant("A")] });
  const b = namespace({ tags: [tenant("B")] });
  const ended: string[] = [];
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const scope = createScope();
  const client = resource({
    label: "client",
    target: "session",
    depends: { tenant },
    factory: ({ tenant }, ctx) => {
      const value = { tenant, closed: false };
      ctx.defer(() => {
        value.closed = true;
        ended.push(tenant);
      });
      return value;
    },
  });
  scope.resolve(client, { ns: b });
  const trigger = resource({
    label: "trigger",
    target: "session",
    factory: () => {
      scope.resolve(client, { ns: a });
      return {};
    },
  });
  let held = { tenant: "", closed: true };
  const hold = operation({
    label: "hold",
    depends: { trigger, client },
    run: async ({ client }) => {
      held = client;
      await gate;
    },
  });
  const running = scope.run(hold, { ns: [a, b] });
  scope.releaseNs(client, a);
  expect(held).toEqual({ tenant: "A", closed: false });
  expect(ended).toEqual([]);
  scope.releaseNs(client, b);
  expect(ended).toEqual(["B"]);
  finish();
  await running;
  await scope.settled();
  expect(ended).toEqual(["B", "A"]);
  await scope.close();
});

test("a named run borrows a replacement built after an earlier dependency releases it", async () => {
  const a = namespace();
  const ended: string[] = [];
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const scope = createScope();
  const client = resource({
    label: "client",
    target: "session",
    factory: (_deps, ctx) => {
      const value = { closed: false };
      ctx.defer(() => {
        value.closed = true;
        ended.push("client");
      });
      return value;
    },
  });
  const trigger = resource({
    label: "trigger",
    target: "session",
    factory: () => {
      scope.releaseNs(client, a);
      return {};
    },
  });
  let held = { closed: true };
  const hold = operation({
    label: "hold",
    depends: { trigger, client },
    run: async ({ client }) => {
      held = client;
      await gate;
    },
  });
  const running = scope.run(hold, { ns: a });
  scope.releaseNs(client, a);
  expect(held.closed).toBe(false);
  expect(ended).toEqual([]);
  finish();
  await running;
  await scope.settled();
  expect(ended).toEqual(["client"]);
  await scope.close();
});

test("a named run keeps a late dependency cleanup alive through its dependent", async () => {
  const a = namespace();
  const ended: string[] = [];
  let finishBuild = (): void => undefined;
  const buildGate = new Promise<void>((resolve) => {
    finishBuild = resolve;
  });
  let finishRun = (): void => undefined;
  const runGate = new Promise<void>((resolve) => {
    finishRun = resolve;
  });
  let enter = (): void => undefined;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const pool = resource({
    label: "pool",
    target: "session",
    factory: async (_deps, ctx) => {
      await buildGate;
      const value = { closed: false };
      ctx.defer(() => {
        value.closed = true;
        ended.push("pool");
      });
      return value;
    },
  });
  const client = resource({
    label: "client",
    target: "session",
    depends: { pool },
    factory: async ({ pool }, ctx) => {
      ctx.defer(() => void ended.push("client"));
      return pool;
    },
  });
  let held = { closed: true };
  const hold = operation({
    label: "hold",
    depends: { client },
    run: async ({ client }) => {
      held = client;
      enter();
      await runGate;
    },
  });
  const scope = createScope();
  const running = scope.run(hold, { ns: a });
  scope.releaseNs(pool, a);
  finishBuild();
  await entered;
  expect(held.closed).toBe(false);
  expect(ended).toEqual([]);
  finishRun();
  await running;
  await scope.settled();
  expect(held.closed).toBe(true);
  expect(ended).toHaveLength(2);
  expect(ended).toContain("client");
  expect(ended).toContain("pool");
  await scope.close();
});

test("a named run keeps dependencies borrowed after its dependent is released", async () => {
  const a = namespace();
  const ended: string[] = [];
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const pool = resource({
    label: "pool",
    target: "session",
    factory: (_deps, ctx) => {
      const value = { closed: false };
      ctx.defer(() => {
        value.closed = true;
        ended.push("pool");
      });
      return value;
    },
  });
  const client = resource({
    label: "client",
    target: "session",
    depends: { pool },
    factory: ({ pool }, ctx) => {
      ctx.defer(() => void ended.push("client"));
      return pool;
    },
  });
  let held = { closed: true };
  const hold = operation({
    label: "hold",
    depends: { client },
    run: async ({ client }) => {
      held = client;
      await gate;
    },
  });
  const scope = createScope();
  const running = scope.run(hold, { ns: a });
  scope.releaseNs(client, a);
  scope.releaseNs(pool, a);
  expect(held.closed).toBe(false);
  expect(ended).toEqual([]);
  finish();
  await running;
  await scope.settled();
  expect(ended).toEqual(["client", "pool"]);
  await scope.close();
});

test("namespace clients share one scope-target pool", () => {
  const a = namespace();
  const b = namespace();
  let poolBuilds = 0;
  let clientBuilds = 0;
  const pool = resource({
    label: "pool",
    target: "scope",
    factory: () => ({ build: ++poolBuilds }),
  });
  const client = resource({
    label: "client",
    target: "session",
    depends: { pool },
    factory: ({ pool }) => ({ build: ++clientBuilds, pool }),
  });
  const scope = createScope();
  const clientA = scope.resolve(client, { ns: a });
  const clientB = scope.resolve(client, { ns: b });
  expect(clientA.pool).toBe(clientB.pool);
  expect(poolBuilds).toBe(1);
  expect(clientBuilds).toBe(2);
  return scope.close();
});

test("releaseNs cleans one resource bucket and close drains the buckets left behind", async () => {
  const a = namespace();
  const b = namespace();
  let builds = 0;
  const ended: string[] = [];
  const client = resource({
    label: "client",
    target: "session",
    factory: (_deps, ctx) => {
      const build = ++builds;
      ctx.defer((end) => void ended.push(`${build}:${end.status}`));
      return { build };
    },
  });
  const scope = createScope();
  const plain = scope.resolve(client);
  const firstA = scope.resolve(client, { ns: a });
  const firstB = scope.resolve(client, { ns: b });
  scope.releaseNs(client, a);
  await scope.settled();
  expect(ended).toEqual([`${firstA.build}:released`]);
  const secondA = scope.resolve(client, { ns: a });
  expect(secondA).not.toBe(firstA);
  expect(scope.resolve(client, { ns: b })).toBe(firstB);
  expect(scope.resolve(client)).toBe(plain);
  const result = await scope.close({ graceful: true });
  expect(result.teardownErrors).toBeUndefined();
  expect(ended).toEqual([
    `${firstA.build}:released`,
    `${secondA.build}:success`,
    `${firstB.build}:success`,
    `${plain.build}:success`,
  ]);
});

test("release without ns drops every named resource bucket", async () => {
  const a = namespace();
  const b = namespace();
  const ended: string[] = [];
  let builds = 0;
  const client = resource({
    label: "client",
    target: "session",
    factory: (_deps, ctx) => {
      const build = ++builds;
      ctx.defer((end) => void ended.push(`${build}:${end.status}`));
      return { build };
    },
  });
  const scope = createScope();
  scope.resolve(client, { ns: a });
  scope.resolve(client, { ns: b });
  scope.release(client);
  await scope.settled();
  expect(ended).toEqual(["2:released", "1:released"]);
  expect(scope.resolve(client, { ns: a })).toEqual({ build: 3 });
  expect(scope.resolve(client, { ns: b })).toEqual({ build: 4 });
  const result = await scope.close();
  expect(result.teardownErrors).toBeUndefined();
});

test("releaseNs waits for its own live borrow but not a sibling namespace", async () => {
  const a = namespace();
  const b = namespace();
  const ended: string[] = [];
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const client = resource({
    label: "client",
    target: "session",
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ended.push(end.status));
      return {};
    },
  });
  const hold = operation({
    label: "hold",
    depends: { client },
    run: async () => gate,
  });
  const scope = createScope();
  scope.resolve(client, { ns: b });
  const running = scope.run(hold, { ns: a });
  scope.releaseNs(client, b);
  expect(ended).toEqual(["released"]);
  scope.releaseNs(client, a);
  expect(ended).toEqual(["released"]);
  finish();
  await running;
  await scope.settled();
  expect(ended).toEqual(["released", "released"]);
  await scope.close();
});

test("releaseNs keeps a dependency alive until its named dependent borrow ends", async () => {
  const a = namespace();
  const ended: string[] = [];
  let baseBuilds = 0;
  let clientBuilds = 0;
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const base = resource({
    label: "base",
    target: "session",
    factory: (_deps, ctx) => {
      const build = ++baseBuilds;
      ctx.defer(() => void ended.push(`base:${build}`));
      return { build };
    },
  });
  const client = resource({
    label: "client",
    target: "session",
    depends: { base },
    factory: ({ base }, ctx) => {
      const build = ++clientBuilds;
      ctx.defer(() => void ended.push(`client:${build}`));
      return { base, build };
    },
  });
  const hold = operation({
    label: "hold",
    depends: { client },
    run: async () => gate,
  });
  const scope = createScope();
  const running = scope.run(hold, { ns: a });
  scope.releaseNs(base, a);
  expect(ended).toEqual([]);
  finish();
  await running;
  await scope.settled();
  expect(ended).toEqual(["client:1", "base:1"]);
  expect(scope.resolve(client, { ns: a })).toEqual({ base: { build: 2 }, build: 2 });
  await scope.close();
});

test("releaseNs resets one data bucket and leaves its sibling and default", async () => {
  const a = namespace();
  const b = namespace();
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const scope = createScope();
  scope.controller(cell).set(3);
  scope.controller(cell, { ns: a }).set(1);
  scope.controller(cell, { ns: b }).set(2);
  scope.releaseNs(cell, a);
  expect(scope.resolve(cell, { ns: a })).toBe(3);
  expect(scope.resolve(cell, { ns: b })).toBe(2);
  expect(scope.resolve(cell)).toBe(3);
  await scope.close();
});

test("releaseNs on named data invalidates only resources that read that bucket", async () => {
  const a = namespace();
  const b = namespace();
  const ended: string[] = [];
  const config = data({ label: "config", initial: 0 });
  const client = resource({
    label: "client",
    target: "session",
    depends: { config },
    factory: ({ config }, ctx) => {
      ctx.defer((end) => void ended.push(`${config}:${end.status}`));
      return { config };
    },
  });
  const scope = createScope();
  scope.controller(config, { ns: a }).set(1);
  scope.controller(config, { ns: b }).set(2);
  const plain = scope.resolve(client);
  const first = scope.resolve(client, { ns: a });
  const sibling = scope.resolve(client, { ns: b });
  scope.releaseNs(config, a);
  expect(scope.resolve(config, { ns: a })).toBe(0);
  expect(scope.resolve(client, { ns: a })).toEqual({ config: 0 });
  expect(scope.resolve(client, { ns: a })).not.toBe(first);
  expect(scope.resolve(client, { ns: b })).toBe(sibling);
  expect(scope.resolve(client)).toBe(plain);
  expect(ended).toEqual(["1:released"]);
  await scope.close();
});

test("releaseNs leaves a namespace-blind scope resource built", async () => {
  const a = namespace();
  const ended: string[] = [];
  const shared = resource({
    label: "shared",
    target: "scope",
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ended.push(end.status));
      return {};
    },
  });
  const scope = createScope();
  const first = scope.resolve(shared, { ns: a });
  scope.releaseNs(shared, a);
  expect(scope.resolve(shared)).toBe(first);
  expect(ended).toEqual([]);
  await scope.close({ graceful: true });
  expect(ended).toEqual(["success"]);
});

test("releasing a shared pool drops every named client that depends on it", async () => {
  const a = namespace();
  const b = namespace();
  const ended: string[] = [];
  let poolBuilds = 0;
  let clientBuilds = 0;
  let viewBuilds = 0;
  const pool = resource({
    label: "pool",
    target: "scope",
    factory: (_deps, ctx) => {
      const build = ++poolBuilds;
      ctx.defer(() => void ended.push(`pool:${build}`));
      return { build };
    },
  });
  const client = resource({
    label: "client",
    target: "session",
    depends: { pool },
    factory: ({ pool }, ctx) => {
      const build = ++clientBuilds;
      ctx.defer(() => void ended.push(`client:${build}`));
      return { build, pool };
    },
  });
  const view = resource({
    label: "view",
    target: "session",
    depends: { client },
    factory: ({ client }, ctx) => {
      const build = ++viewBuilds;
      ctx.defer(() => void ended.push(`view:${build}`));
      return { build, client };
    },
  });
  const scope = createScope();
  scope.resolve(view, { ns: a });
  scope.resolve(view, { ns: b });
  scope.release(pool);
  await scope.settled();
  expect(ended).toEqual(["view:2", "client:2", "view:1", "client:1", "pool:1"]);
  expect(scope.resolve(view, { ns: a })).toEqual({
    build: 3,
    client: { build: 3, pool: { build: 2 } },
  });
  await scope.close();
});

test("releaseNs waits for an async cleanup without a live borrow", async () => {
  const a = namespace();
  let finish = (): void => undefined;
  let ended = false;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const client = resource({
    label: "client",
    target: "session",
    factory: (_deps, ctx) => {
      ctx.defer(async () => {
        await gate;
        ended = true;
      });
      return {};
    },
  });
  const scope = createScope();
  scope.resolve(client, { ns: a });
  scope.releaseNs(client, a);
  expect(ended).toBe(false);
  finish();
  await scope.settled();
  expect(ended).toBe(true);
  await scope.close();
});

test("release waits for a live borrow from a named bucket", async () => {
  const a = namespace();
  let finish = (): void => undefined;
  const ended: string[] = [];
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const client = resource({
    label: "client",
    target: "session",
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ended.push(end.status));
      return {};
    },
  });
  const hold = operation({
    label: "hold",
    depends: { client },
    run: async () => gate,
  });
  const scope = createScope();
  const running = scope.run(hold, { ns: a });
  scope.release(client);
  expect(ended).toEqual([]);
  finish();
  await running;
  await scope.settled();
  expect(ended).toEqual(["released"]);
  await scope.close();
});

test("a late named resource build cleans up and never fills its released bucket", async () => {
  const a = namespace();
  let builds = 0;
  let finish = (): void => undefined;
  const ended: string[] = [];
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const client = resource({
    label: "client",
    target: "session",
    factory: async (_deps, ctx) => {
      const build = ++builds;
      await gate;
      ctx.defer((end) => void ended.push(`${build}:${end.status}`));
      return { build };
    },
  });
  const scope = createScope();
  const first = scope.resolve(client, { ns: a });
  scope.releaseNs(client, a);
  finish();
  expect(await first).toEqual({ build: 1 });
  await scope.settled();
  expect(ended).toEqual(["1:released"]);
  expect(scope.resolve(client, { ns: a })).not.toBe(first);
  expect(builds).toBe(2);
  await scope.close();
});

test("release supersedes a named build before its late cleanup registers", async () => {
  const a = namespace();
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const ended: string[] = [];
  const client = resource({
    label: "client",
    target: "session",
    factory: async (_deps, ctx) => {
      await gate;
      ctx.defer((end) => void ended.push(end.status));
      return {};
    },
  });
  const scope = createScope();
  const first = scope.resolve(client, { ns: a });
  scope.release(client);
  finish();
  await first;
  await scope.settled();
  expect(ended).toEqual(["released"]);
  expect(scope.resolve(client, { ns: a })).not.toBe(first);
  await scope.close();
});

test("a rebuilt chain dependent leaves its old fallback bucket", async () => {
  const a = namespace();
  const b = namespace();
  const ended: string[] = [];
  let baseBuilds = 0;
  let clientBuilds = 0;
  const base = resource({
    label: "base",
    target: "session",
    factory: (_deps, ctx) => {
      const build = ++baseBuilds;
      ctx.defer(() => void ended.push(`base:${build}`));
      return { build };
    },
  });
  const client = resource({
    label: "client",
    target: "session",
    depends: { base },
    factory: ({ base }, ctx) => {
      const build = ++clientBuilds;
      ctx.defer(() => void ended.push(`client:${build}`));
      return { base, build };
    },
  });
  const scope = createScope();
  scope.resolve(base, { ns: b });
  scope.resolve(client, { ns: [a, b] });
  scope.releaseNs(client, a);
  scope.resolve(base, { ns: a });
  const rebuilt = scope.resolve(client, { ns: [a, b] });
  scope.releaseNs(base, b);
  await scope.settled();
  expect(scope.resolve(client, { ns: [a, b] })).toBe(rebuilt);
  expect(ended).toEqual(["client:1", "base:1"]);
  scope.releaseNs(base, a);
  await scope.settled();
  expect(ended).toEqual(["client:1", "base:1", "client:2", "base:2"]);
  await scope.close();
});

test("a scope-target resource is namespace-blind and keeps default storage clean", () => {
  const tenant = tag<string>({ label: "tenant" });
  const named = namespace({ tags: [tenant("named")] });
  const shared = resource({
    label: "shared",
    target: "scope",
    depends: { tenant },
    factory: ({ tenant }) => tenant,
  });
  const scope = createScope({ tags: [tenant("default")] });
  expect(scope.resolve(shared, { ns: named })).toBe("default");
  expect(scope.resolve(shared)).toBe("default");
  return scope.close();
});

test("an ambient namespace cannot enter a scope-target resource build", () => {
  const tenant = tag<string>({ label: "tenant" });
  const named = namespace({ tags: [tenant("named")] });
  const shared = resource({
    label: "ambient-shared",
    target: "scope",
    depends: { tenant },
    factory: ({ tenant }) => tenant,
  });
  const scope = createScope({ ns: named, tags: [tenant("default")] });
  expect(scope.resolve(shared)).toBe("default");
  expect(scope.resolve(shared)).toBe("default");
  return scope.close();
});

test("namespace-blind scope builds keep tagged operation dependencies blind", async () => {
  const tenant = tag<string>({ label: "tenant" });
  const marker = tag({ label: "marker", default: false });
  const named = namespace({ tags: [tenant("named")] });
  const readTenant = operation({
    label: "readTenant",
    depends: { tenant, marker },
    run: ({ tenant, marker }) => (marker ? tenant : "missing-marker"),
  });
  const shared = resource({
    label: "tagged-ambient-shared",
    target: "scope",
    depends: { readTenant },
    factory: ({ readTenant }) => readTenant.run({ tags: [marker(true)] }),
  });
  const scope = createScope({ ns: named, tags: [tenant("default")] });
  expect(await scope.resolve(shared)).toBe("default");
  await scope.close();
});

test("invalid input rejects before dependencies build", () => {
  let builds = 0;
  const dep = resource({ label: "dep", factory: () => ++builds });
  const op = operation({
    label: "op",
    input: asNumber,
    depends: { dep },
    run: ({ dep }) => dep,
  });
  const scope = createScope();
  expect(() => scope.run(op, { rawInput: "bad" })).toThrow("DataValidationFailed");
  expect(builds).toBe(0);
  return scope.close();
});

test("a re-registered named watcher refreshes its comparison value", () => {
  const named = namespace();
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const scope = createScope();
  const ctl = scope.controller(cell, { ns: named });
  const stop = ctl.watch(() => undefined);
  stop();
  ctl.set(2);
  const seen: [number, number][] = [];
  ctl.watch((next, prev) => seen.push([next, prev]));
  ctl.set(0);
  expect(seen).toEqual([[0, 2]]);
  return scope.close();
});

test("a namespace-blind watcher observes default storage, never ambient tenant storage", () => {
  const tenant = namespace();
  const other = namespace();
  const cell = data({ label: "cell", initial: 1, parse: asNumber });
  const seen: [number, number][] = [];
  const observer = resource({
    label: "observer",
    target: "scope",
    depends: { cell: cell.controller },
    factory: ({ cell }) => {
      cell.watch((next, prev) => seen.push([prev, next]));
      cell.set(0);
      return cell.get();
    },
  });
  const scope = createScope({ ns: tenant });
  scope.controller(cell).set(9);
  expect(scope.resolve(observer)).toBe(0);
  expect(seen).toEqual([[1, 0]]);
  expect(scope.resolve(cell)).toBe(9);
  expect(scope.resolve(cell, { ns: other })).toBe(0);
  return scope.close();
});

test.each(["head-first", "chain-first"] as const)(
  "watchers with one head and different chains compare independently: %s",
  (order) => {
    const a = namespace();
    const b = namespace();
    const cell = data({ label: "cell", initial: 0, parse: asNumber });
    const scope = createScope();
    scope.controller(cell, { ns: b }).set(2);
    const head = scope.controller(cell, { ns: a });
    const chain = scope.controller(cell, { ns: [a, b] });
    const headSeen: [number, number][] = [];
    const chainSeen: [number, number][] = [];
    const watchHead = () => head.watch((next, prev) => headSeen.push([next, prev]));
    const watchChain = () => chain.watch((next, prev) => chainSeen.push([next, prev]));
    if (order === "head-first") {
      watchHead();
      watchChain();
    } else {
      watchChain();
      watchHead();
    }
    head.set(1);
    expect(headSeen).toEqual([[1, 0]]);
    expect(chainSeen).toEqual([[1, 2]]);
    return scope.close().then(() => undefined);
  },
);

test("a chained watcher compares against the full resolved namespace chain", () => {
  const a = namespace();
  const b = namespace();
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const scope = createScope();
  scope.controller(cell, { ns: b }).set(2);
  const ctl = scope.controller(cell, { ns: [a, b] });
  const seen: [number, number][] = [];
  ctl.watch((next, prev) => seen.push([next, prev]));
  ctl.set(0);
  expect(seen).toEqual([[0, 2]]);
  return scope.close();
});

test("an empty namespace chain is rejected", () => {
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const scope = createScope();
  expect(() => scope.controller(cell, { ns: [] }).set(8)).toThrow("InvalidDependency");
  expect(scope.resolve(cell)).toBe(0);
  return scope.close();
});

test("a non-namespace ns value is a loud error, not a silent key", () => {
  const cell = data({ label: "cell", initial: 0, parse: asNumber });
  const scope = createScope();
  let error: unknown;
  try {
    scope.resolve(cell, { ns: "tenant" as unknown as Ns });
  } catch (cause) {
    error = cause;
  }
  expect(isError(error, "InvalidDependency")).toBe(true);
  return scope.close();
});

test("a watcher that writes during notify does not rob a later watcher of its change", async () => {
  const a = namespace();
  const cell = data<number>({ label: "reentrant", initial: 0 });
  const scope = createScope();
  scope.controller(cell, { ns: a }).set(1);
  const seen2: [number, number][] = [];
  // two watchers on the SAME bucket; the first re-writes on seeing 2, the second must still be told 1->2
  scope.controller(cell, { ns: a }).watch((next) => {
    if (next === 2) scope.controller(cell, { ns: a }).set(0);
  });
  scope.controller(cell, { ns: a }).watch((next, prev) => seen2.push([prev, next]));
  scope.controller(cell, { ns: a }).set(2);
  // the second watcher must see 1->2 (not miss it or see 1->0), then the re-write's own round 2->0
  expect(seen2).toEqual([
    [2, 0],
    [1, 2],
  ]);
  await scope.close();
});
