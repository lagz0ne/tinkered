import { expect, test } from "vite-plus/test";
import { createScope, data, extension, namespace, operation, resource, tag } from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

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

test("a named run keeps a scope pool alive through its session client", async () => {
  const a = namespace();
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const ended: string[] = [];
  const pool = resource({
    label: "pool",
    target: "scope",
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
  scope.release(pool);
  expect(held.closed).toBe(false);
  expect(ended).toEqual([]);
  finish();
  await running;
  await scope.settled();
  expect(ended).toEqual(["client", "pool"]);
  await scope.close();
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

test("releaseNs on parent data invalidates a child resource that read its bucket", async () => {
  const a = namespace();
  const config = data({ label: "config", initial: 0 });
  const ended: string[] = [];
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
  const child = scope.createSession();
  scope.controller(config, { ns: a }).set(1);
  const first = child.resolve(client, { ns: a });
  scope.releaseNs(config, a);
  expect(ended).toEqual(["1:released"]);
  expect(child.resolve(client, { ns: a })).toEqual({ config: 0 });
  expect(child.resolve(client, { ns: a })).not.toBe(first);
  await scope.close();
});

test("releaseNs on parent data cleans child resources before parent resources", async () => {
  const a = namespace();
  const config = data({ label: "config", initial: 0 });
  const ended: number[] = [];
  let builds = 0;
  const client = resource({
    label: "client",
    target: "session",
    depends: { config },
    factory: (_deps, ctx) => {
      const build = ++builds;
      ctx.defer(() => void ended.push(build));
      return {};
    },
  });
  const scope = createScope();
  const child = scope.createSession();
  scope.controller(config, { ns: a }).set(1);
  child.resolve(client, { ns: a });
  scope.resolve(client, { ns: a });
  scope.releaseNs(config, a);
  expect(ended).toEqual([1, 2]);
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

test("a throwing named data watcher still runs the extracted release cleanup (N2)", async () => {
  const ns = namespace();
  const cell = data<number>({ label: "n2cell", initial: 0 });
  const ended: string[] = [];
  const client = resource({
    label: "n2client",
    target: "session",
    depends: { cell },
    factory: ({ cell }, ctx) => {
      ctx.defer((end) => {
        ended.push(end.status);
      });
      return { cell };
    },
  });
  const scope = createScope();
  const ctl = scope.controller(cell, { ns });
  ctl.set(1);
  scope.resolve(client, { ns });
  ctl.watch(() => {
    throw new Error("watcher");
  });
  let threw = false;
  try {
    scope.releaseNs(cell, ns);
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
  expect(ended).toEqual(["released"]);
  await scope.close({ graceful: true });
  expect(ended).toEqual(["released"]);
});

test("a failed named build's cleanup is still run by releaseNs (N3)", async () => {
  const ns = namespace();
  const ended: string[] = [];
  const client = resource({
    label: "n3client",
    target: "session",
    factory: (_deps, ctx) => {
      ctx.defer((end) => {
        ended.push(end.status);
      });
      throw new Error("build");
    },
  });
  const scope = createScope();
  try {
    scope.resolve(client, { ns });
  } catch {
    // expected
  }
  scope.releaseNs(client, ns);
  expect(ended).toEqual(["failed"]);
  await scope.close({ graceful: true });
  expect(ended).toEqual(["failed"]);
});

test("a failed named build does not fill a sibling chain's fallback (N3)", () => {
  const tenant = tag<string>({ label: "n3tenant" });
  const a = namespace({ tags: [tenant("A")] });
  const b = namespace({ tags: [tenant("B")] });
  let fail = true;
  const client = resource({
    label: "n3fb",
    target: "session",
    depends: { tenant },
    factory: ({ tenant }) => {
      if (tenant === "B" && fail) {
        fail = false;
        throw new Error("bad");
      }
      return tenant;
    },
  });
  const scope = createScope();
  try {
    scope.resolve(client, { ns: b });
  } catch {
    // expected
  }
  expect(scope.resolve(client, { ns: [a, b] })).toBe("A");
  expect(scope.resolve(client, { ns: b })).toBe("B");
});

test("releasing a far named data bucket does not invalidate a client reading a nearer default (N6)", () => {
  const config = data<number>({ label: "n6config", initial: 0 });
  const a = namespace();
  const client = resource({
    label: "n6client",
    target: "session",
    depends: { config },
    factory: ({ config }) => ({ value: config }),
  });
  const scope = createScope();
  scope.controller(config, { ns: a }).set(1);
  const child = scope.createSession();
  child.controller(config).set(2);
  const first = child.resolve(client, { ns: [a] });
  expect(first.value).toBe(2);
  scope.releaseNs(config, a);
  const second = child.resolve(client, { ns: [a] });
  expect(second).toBe(first);
});

test("releaseNs unlinks a namespace-target resource at the root from a child", async () => {
  const a = namespace();
  const b = namespace();
  const ended: string[] = [];
  let builds = 0;
  const pool = resource({
    label: "root-pool",
    target: "namespace",
    factory: (_deps, ctx) => {
      const build = ++builds;
      ctx.defer((end) => {
        ended.push(`${build}:${end.status}`);
      });
      return { build };
    },
  });
  const root = createScope();
  const child = root.createSession();
  const first = child.resolve(pool, { ns: a });
  const sibling = child.resolve(pool, { ns: b });
  const plain = child.resolve(pool);
  child.releaseNs(pool, a);
  expect(ended).toEqual([`${first.build}:released`]);
  expect(root.resolve(pool, { ns: a })).not.toBe(first);
  expect(root.resolve(pool, { ns: b })).toBe(sibling);
  expect(root.resolve(pool)).toBe(plain);
  await root.close({ graceful: true });
});

test("a rebuilt named data dependent leaves its old fallback entry", async () => {
  const a = namespace();
  const b = namespace();
  const config = data({ label: "fallback-config", initial: 0 });
  const ended: number[] = [];
  const client = resource({
    label: "fallback-client",
    target: "session",
    depends: { config },
    factory: ({ config }, ctx) => {
      ctx.defer(() => {
        ended.push(config);
      });
      return { config };
    },
  });
  const scope = createScope();
  scope.controller(config, { ns: b }).set(2);
  scope.resolve(client, { ns: [a, b] });
  scope.releaseNs(client, a);
  scope.controller(config, { ns: a }).set(1);
  const rebuilt = scope.resolve(client, { ns: [a, b] });
  scope.releaseNs(config, b);
  expect(scope.resolve(client, { ns: [a, b] })).toBe(rebuilt);
  expect(ended).toEqual([2]);
  scope.releaseNs(config, a);
  expect(ended).toEqual([2, 1]);
  await scope.close({ graceful: true });
});

test("releaseNs rebuilds a hookless named client without touching its sibling", async () => {
  const a = namespace();
  const b = namespace();
  let builds = 0;
  const pool = resource({
    label: "plain-pool",
    target: "session",
    factory: () => ++builds,
  });
  const client = resource({
    label: "plain-client",
    target: "session",
    depends: { pool },
    factory: ({ pool }) => ({ pool }),
  });
  const scope = createScope();
  const first = scope.resolve(client, { ns: a });
  const sibling = scope.resolve(client, { ns: b });
  scope.releaseNs(pool, a);
  expect(scope.resolve(client, { ns: a })).not.toBe(first);
  expect(scope.resolve(client, { ns: a }).pool).toBe(3);
  expect(scope.resolve(client, { ns: b })).toBe(sibling);
  await scope.close({ graceful: true });
});

test("a fallback client survives release of a different pool bucket, with or without hooks", async () => {
  for (const hooked of [false, true]) {
    const a = namespace();
    const b = namespace();
    let builds = 0;
    const pool = hooked
      ? resource({
          label: "hookful-pool",
          target: "session",
          factory: (_deps, ctx) => {
            ctx.defer(() => undefined);
            return ++builds;
          },
        })
      : resource({ label: "hookless-pool", target: "session", factory: () => ++builds });
    const client = resource({
      label: "fallback-client",
      target: "session",
      depends: { pool },
      factory: ({ pool }) => ({ pool }),
    });
    const scope = createScope();
    scope.resolve(pool, { ns: b });
    const first = scope.resolve(client, { ns: [a, b] });
    scope.resolve(pool, { ns: a });
    scope.releaseNs(pool, a);
    expect(scope.resolve(client, { ns: [a, b] })).toBe(first);
    await scope.close({ graceful: true });
  }
});

test("a fallback client rebuilds when its selected pool bucket is released, with or without hooks", async () => {
  for (const hooked of [false, true]) {
    const a = namespace();
    const c = namespace();
    let builds = 0;
    const pool = hooked
      ? resource({
          label: "hookful-pool",
          target: "session",
          factory: (_deps, ctx) => {
            ctx.defer(() => undefined);
            return ++builds;
          },
        })
      : resource({ label: "hookless-pool", target: "session", factory: () => ++builds });
    const client = resource({
      label: "fallback-client",
      target: "session",
      depends: { pool },
      factory: ({ pool }) => ({ pool }),
    });
    const scope = createScope();
    scope.resolve(pool, { ns: a });
    const first = scope.resolve(client, { ns: [c, a] });
    scope.releaseNs(pool, a);
    const rebuilt = scope.resolve(client, { ns: [c, a] });
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.pool).toBe(2);
    await scope.close({ graceful: true });
  }
});

test("a rebuilt client drops the named resource link from its failed build", async () => {
  const a = namespace();
  const b = namespace();
  let builds = 0;
  const pool = resource({
    label: "generation-pool",
    target: "session",
    factory: () => ++builds,
  });
  let failing = true;
  const client = resource({
    label: "generation-client",
    target: "session",
    depends: { pool },
    factory: ({ pool }) => {
      if (failing) {
        failing = false;
        throw new Error("build failed");
      }
      return { pool };
    },
  });
  const scope = createScope();
  scope.resolve(pool, { ns: b });
  expect(() => scope.resolve(client, { ns: [a, b] })).toThrow();
  scope.releaseNs(client, a);
  scope.resolve(pool, { ns: a });
  const rebuilt = scope.resolve(client, { ns: [a, b] });
  scope.releaseNs(pool, b);
  expect(scope.resolve(client, { ns: [a, b] })).toBe(rebuilt);
  await scope.close({ graceful: true });
});

test("releaseNs on a named pool drops a dependent's sticky async failure", async () => {
  const a = namespace();
  const b = namespace();
  let builds = 0;
  const pool = resource({
    label: "failed-pool-dependency",
    target: "session",
    factory: () => ++builds,
  });
  let failing = true;
  const client = resource({
    label: "sticky-client",
    target: "session",
    depends: { pool },
    factory: async ({ pool }) => {
      if (failing) {
        failing = false;
        throw new Error("failed client");
      }
      return { pool };
    },
  });
  const scope = createScope();
  scope.resolve(pool, { ns: b });
  const failed = scope.resolve(client, { ns: [a, b] });
  await expect(failed).rejects.toThrow("failed client");
  expect(scope.resolve(client, { ns: [a, b] })).toBe(failed);
  scope.releaseNs(pool, b);
  const rebuilt = scope.resolve(client, { ns: [a, b] });
  expect(rebuilt).not.toBe(failed);
  await expect(rebuilt).resolves.toEqual({ pool: 2 });
  await scope.close({ graceful: true });
});

test("releaseNs finishes a named diamond once, dependent before its pool", async () => {
  const a = namespace();
  const b = namespace();
  const ended: string[] = [];
  const pool = resource({
    label: "diamond-pool",
    target: "session",
    factory: (_deps, ctx) => {
      ctx.defer(() => {
        ended.push("pool");
      });
      return {};
    },
  });
  const left = resource({
    label: "diamond-left",
    target: "session",
    depends: { pool },
    factory: ({ pool }, ctx) => {
      ctx.defer(() => {
        ended.push("left");
      });
      return pool;
    },
  });
  const right = resource({
    label: "diamond-right",
    target: "session",
    depends: { pool },
    factory: ({ pool }, ctx) => {
      ctx.defer(() => {
        ended.push("right");
      });
      return pool;
    },
  });
  const client = resource({
    label: "diamond-client",
    target: "session",
    depends: { left, right },
    factory: ({ left }, ctx) => {
      ctx.defer(() => {
        ended.push("client");
      });
      return left;
    },
  });
  const scope = createScope();
  scope.resolve(pool, { ns: b });
  const first = scope.resolve(client, { ns: [a, b] });
  scope.releaseNs(pool, b);
  expect(ended).toEqual(["client", "right", "left", "pool"]);
  expect(scope.resolve(client, { ns: [a, b] })).not.toBe(first);
  await scope.close({ graceful: true });
});

test("releaseNs on a root pool unlinks child clients built on that namespace", async () => {
  const a = namespace();
  const b = namespace();
  const ended: string[] = [];
  const pool = resource({
    label: "tenant-pool",
    target: "namespace",
    factory: (_deps, ctx) => {
      ctx.defer(() => {
        ended.push("pool");
      });
      return {};
    },
  });
  const client = resource({
    label: "request-client",
    target: "session",
    depends: { pool },
    factory: ({ pool }, ctx) => {
      ctx.defer(() => {
        ended.push("client");
      });
      return { pool };
    },
  });
  const root = createScope();
  const child = root.createSession();
  const first = child.resolve(client, { ns: a });
  const sibling = child.resolve(client, { ns: b });
  root.releaseNs(pool, a);
  expect(ended).toEqual(["client", "pool"]);
  expect(child.resolve(client, { ns: a })).not.toBe(first);
  expect(child.resolve(client, { ns: b })).toBe(sibling);
  await root.close({ graceful: true });
});

test("releaseNs notifies a chain watcher of its fallback value", async () => {
  const a = namespace();
  const b = namespace();
  const cell = data({ label: "fallback-cell", initial: 0 });
  const scope = createScope();
  scope.controller(cell, { ns: b }).set(2);
  scope.controller(cell, { ns: a }).set(1);
  const changes: number[] = [];
  scope.controller(cell, { ns: [a, b] }).watch((value) => {
    changes.push(value);
  });
  scope.releaseNs(cell, a);
  expect(changes).toEqual([2]);
  await scope.close({ graceful: true });
});

test("a watcher starting another namespace cannot hold the released instance (N4)", async () => {
  const a = namespace();
  const b = namespace();
  const cell = data<number>({ label: "n4cell", initial: 0 });
  const ended: string[] = [];
  let finishRun!: () => void;
  const gate = new Promise<void>((resolve) => (finishRun = resolve));
  const client = resource({
    label: "n4client",
    target: "session",
    depends: { cell },
    factory: ({ cell }, ctx) => {
      ctx.defer(() => {
        ended.push(String(cell));
      });
      return cell;
    },
  });
  const hold = operation({
    label: "n4hold",
    depends: { client },
    run: async () => {
      await gate;
    },
  });
  const scope = createScope();
  scope.controller(cell, { ns: a }).set(1);
  scope.resolve(client, { ns: a });
  let running: Promise<void> | undefined;
  scope.controller(cell, { ns: a }).watch(() => {
    running = scope.run(hold, { ns: b });
  });
  scope.releaseNs(cell, a);
  expect(ended).toEqual(["1"]);
  finishRun();
  await running;
  await scope.close({ graceful: true });
});

test("a late named dependency finishes after its dependent (N5)", async () => {
  const ns = namespace();
  let finishBuild!: () => void;
  const buildGate = new Promise<void>((resolve) => (finishBuild = resolve));
  let finishRun!: () => void;
  const runGate = new Promise<void>((resolve) => (finishRun = resolve));
  let entered!: () => void;
  const runningBody = new Promise<void>((resolve) => (entered = resolve));
  const ended: string[] = [];
  const pool = resource({
    label: "n5pool",
    target: "namespace",
    factory: async (_deps, ctx) => {
      await buildGate;
      ctx.defer((end) => {
        ended.push(`pool:${end.status}`);
      });
      return { closed: false };
    },
  });
  const client = resource({
    label: "n5client",
    target: "session",
    depends: { pool },
    factory: async ({ pool }, ctx) => {
      const value = await Promise.resolve(pool);
      ctx.defer((end) => {
        expect(value.closed).toBe(false);
        ended.push(`client:${end.status}`);
        value.closed = true;
      });
      return value;
    },
  });
  const hold = operation({
    label: "n5hold",
    depends: { client },
    run: async () => {
      entered();
      await runGate;
    },
  });
  const scope = createScope();
  const running = scope.run(hold, { ns });
  scope.releaseNs(pool, ns);
  finishBuild();
  await runningBody;
  expect(ended).toEqual([]);
  scope.releaseNs(client, ns);
  finishRun();
  await running;
  await scope.settled();
  expect(ended).toEqual(["client:released", "pool:released"]);
  await scope.close({ graceful: true });
});
