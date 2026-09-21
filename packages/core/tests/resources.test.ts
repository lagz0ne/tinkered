import { expect, test } from "vite-plus/test";
import {
  createScope,
  data,
  extension,
  isError,
  operation,
  resource,
  type Resource,
} from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

test("a child session reads its parent's cell value", () => {
  const count = data({ initial: 7, parse: asNumber });
  const scope = createScope();
  const child = scope.createSession();
  expect(child.controller(count).get()).toBe(7);
});

test("releasing a resource drops its dependents so they rebuild", () => {
  let builds = 0;
  const base = resource({ label: "base", factory: () => ({ v: 1 }) });
  const top = resource({
    label: "top",
    depends: { base },
    factory: ({ base }) => ({ v: base.v + builds++ }),
  });
  const scope = createScope();
  expect(scope.resolve(top)).toEqual({ v: 1 });
  scope.release(base);
  expect(scope.resolve(top)).toEqual({ v: 2 });
});

test("a throwing operation defer is aggregated as TeardownFailed", async () => {
  const boom = new Error("op-defer-boom");
  const seen: string[] = [];
  const op = operation({
    label: "op",
    run: (_deps, { defer }) => {
      defer(() => void seen.push("kept"));
      defer(() => {
        throw boom;
      });
      return 1;
    },
  });
  const scope = createScope();
  scope.run(op);
  scope.onClose(() => undefined);
  const result = await scope.close();
  expect(seen).toEqual(["kept"]);
  expect(result.teardownErrors).toEqual([boom]);
});

test("releasing a cell cascades into a resource behind its controller edge", () => {
  let builds = 0;
  const count = data({ initial: 1, parse: asNumber });
  const view = resource({
    label: "view",
    depends: { c: count.controller },
    factory: ({ c }) => ({ v: c.get() + builds++ }),
  });
  const scope = createScope();
  expect(scope.resolve(view)).toEqual({ v: 1 });
  scope.release(count);
  expect(scope.resolve(view)).toEqual({ v: 2 });
});

test("a released resource rebuilds with a fresh generation", () => {
  let builds = 0;
  const conn = resource({
    label: "conn",
    factory: () => ({ n: ++builds }),
  });
  const scope = createScope();
  expect(scope.resolve(conn)).toEqual({ n: 1 });
  scope.release(conn);
  expect(scope.resolve(conn)).toEqual({ n: 2 });
});

test("releasing a data cell resets it and releases only its dependents", () => {
  const count = data({ initial: 3, parse: asNumber });
  const other = data({ initial: 9, parse: asNumber });
  const scope = createScope();
  scope.controller(count).set(30);
  scope.controller(other).set(90);
  scope.release(count);
  expect(scope.controller(count).get()).toBe(3);
  expect(scope.controller(other).get()).toBe(90);
});

test("a factory that declares no ctx fails its defer with Disposed", () => {
  let thrown: unknown;
  const sneaky = resource({
    label: "sneaky",
    factory: (...args: unknown[]) => {
      const ctx = args[1] as { defer: (fn: () => void) => void };
      try {
        ctx.defer(() => undefined);
      } catch (error) {
        thrown = error;
      }
      return 2;
    },
  });
  expect(createScope().resolve(sneaky)).toBe(2);
  if (!isError(thrown, "Disposed")) throw thrown;
  expect(thrown.payload.reason).toBe("resource factory declared no ctx");
});

test("a factory that declares no ctx still reads its abort signal", async () => {
  let aborted = false;
  const quiet = resource({
    label: "quiet",
    factory: (...args: unknown[]) => {
      const ctx = args[1] as { signal: AbortSignal };
      ctx.signal.addEventListener("abort", () => {
        aborted = true;
      });
      return 3;
    },
  });
  const scope = createScope();
  expect(scope.resolve(quiet)).toBe(3);
  await scope.close();
  expect(aborted).toBe(true);
});

test("a resource context hands the same abort signal on every read", () => {
  const seen: AbortSignal[] = [];
  const probe = resource({
    label: "probe",
    factory: (_deps, ctx) => {
      seen.push(ctx.signal, ctx.signal);
      return 1;
    },
  });
  expect(createScope().resolve(probe)).toBe(1);
  expect(seen[0]).toBe(seen[1]);
});

test("releasing one resource leaves another resource's cleanup in place", async () => {
  const order: string[] = [];
  const first = resource({
    label: "first",
    factory: (_deps, { defer }) => {
      defer(() => void order.push("first-clean"));
      return 1;
    },
  });
  const second = resource({
    label: "second",
    factory: (_deps, { defer }) => {
      defer(() => void order.push("second-clean"));
      return 2;
    },
  });
  const scope = createScope();
  scope.resolve(first);
  scope.resolve(second);
  scope.release(first);
  expect(order).toEqual(["first-clean"]);
  await scope.close();
  expect(order).toEqual(["first-clean", "second-clean"]);
});

test("releasing a mid-chain resource tears down each dependent once in order", () => {
  const cleaned: string[] = [];
  const base = resource({
    label: "base",
    factory: (_deps, { defer }) => {
      defer(() => void cleaned.push("base"));
      return { v: 1 };
    },
  });
  const mid = resource({
    label: "mid",
    depends: { base },
    factory: ({ base: b }, { defer }) => {
      defer(() => void cleaned.push("mid"));
      return { v: (b as { v: number }).v };
    },
  });
  const top = resource({
    label: "top",
    depends: { mid },
    factory: ({ mid: m }, { defer }) => {
      defer(() => void cleaned.push("top"));
      return { v: (m as { v: number }).v };
    },
  });
  const scope = createScope();
  scope.resolve(top);
  scope.release(mid);
  expect(cleaned).toEqual(["top", "mid"]);
  expect(scope.resolve(top).v).toBe(1);
});

test("a resource cleanup that rejects asynchronously lands in teardown errors", async () => {
  const boom = new Error("async-cleanup-boom");
  const seen: string[] = [];
  const r = resource({
    label: "r",
    factory: (_deps, { defer }) => {
      defer(() => void seen.push("kept"));
      defer(() => Promise.reject(boom));
      return 1;
    },
  });
  const scope = createScope();
  scope.resolve(r);
  const result = await scope.close();
  expect(seen).toEqual(["kept"]);
  expect(result.teardownErrors).toEqual([boom]);
});

test("a child session reads its parent's latest write", () => {
  const count = data({ initial: 1, parse: asNumber });
  const scope = createScope();
  scope.controller(count).set(5);
  const child = scope.createSession();
  expect(child.controller(count).get()).toBe(5);
});

test("a child update builds on its parent's latest write", () => {
  const count = data({ initial: 1, parse: asNumber });
  const scope = createScope();
  scope.controller(count).set(5);
  const child = scope.createSession();
  child.controller(count).update((n) => n + 1);
  expect(child.controller(count).get()).toBe(6);
  expect(scope.controller(count).get()).toBe(5);
});

test("releasing a dependency after its dependent never tears down twice", () => {
  const cleaned: string[] = [];
  const base = resource({
    label: "base",
    factory: (_deps, { defer }) => {
      defer(() => void cleaned.push("base"));
      return { v: 1 };
    },
  });
  const top = resource({
    label: "top",
    depends: { base },
    factory: ({ base: b }, { defer }) => {
      defer(() => void cleaned.push("top"));
      return { v: (b as { v: number }).v };
    },
  });
  const scope = createScope();
  scope.resolve(top);
  scope.release(top);
  scope.release(base);
  expect(cleaned).toEqual(["top", "base"]);
});

test("a release inside a run drains unrelated cleanups at once", () => {
  const cleaned: string[] = [];
  const count = data({ initial: 1, parse: asNumber });
  const resA = resource({ label: "resA", factory: () => ({ n: 1 }) });
  const resB = resource({
    label: "resB",
    depends: { count },
    factory: ({ count: n }, { defer }) => {
      defer(() => void cleaned.push(`resB:${n}`));
      return { n };
    },
  });
  const scope = createScope();
  scope.resolve(resB);
  const probe = operation({
    label: "probe",
    depends: { count, c: count.controller, resA },
    run: ({ count: n }) => {
      scope.release(count);
      return `${n}:${cleaned.length}`;
    },
  });
  expect(scope.run(probe)).toBe("1:1");
  expect(cleaned).toEqual(["resB:1"]);
});

test("a build superseded twice never publishes its value", async () => {
  let g2!: (v: string) => void;
  let g3!: (v: string) => void;
  const gate2 = new Promise<string>((resolve) => {
    g2 = resolve;
  });
  const gate3 = new Promise<string>((resolve) => {
    g3 = resolve;
  });
  let builds = 0;
  const slow = resource({
    label: "slow",
    factory: () => {
      builds += 1;
      const n = builds;
      if (n <= 2) return gate2.then(() => "stale");
      return gate3.then(() => "fresh");
    },
  });
  const scope = createScope();
  const first = scope.controller(slow).resolve() as Promise<unknown>;
  scope.release(slow);
  const second = scope.controller(slow).resolve() as Promise<unknown>;
  scope.release(slow);
  g2("go");
  expect(await first).toBe("stale");
  expect(await second).toBe("stale");
  const third = scope.controller(slow).resolve() as Promise<unknown>;
  g3("go");
  expect(await third).toBe("fresh");
  await scope.close();
}, 10000);

test("a finished borrow is forgotten before the next release", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
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
    run: async ({ res: n }) => {
      await gate;
      order.push(`op:${n}`);
      return n;
    },
  });
  const scope = createScope();
  const running = scope.run(op) as Promise<unknown>;
  release();
  expect(await running).toBe(1);
  scope.release(res);
  expect(order).toEqual(["op:1", "res-clean"]);
  await scope.close();
  expect(order).toEqual(["op:1", "res-clean"]);
});

test("a defer from a superseded build never joins the live rebuild's drain", async () => {
  let release!: (v: number) => void;
  const gate = new Promise<number>((resolve) => {
    release = resolve;
  });
  const seen: string[] = [];
  const slow = resource({
    label: "slow",
    factory: (_deps, ctx) =>
      gate.then((n) => {
        ctx.defer((end) => void seen.push(`late:${end.status}`));
        return n;
      }),
  });
  const scope = createScope();
  const first = scope.controller(slow).resolve() as Promise<unknown>;
  scope.release(slow);
  release(7);
  expect(await first).toBe(7);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(seen).toEqual(["late:released"]);
  await scope.close();
  expect(seen).toEqual(["late:released"]);
});

test("a failing start fails the scope with its cause", async () => {
  const cause = new Error("start-boom");
  const ext = extension({
    label: "bad",
    start: () => Promise.reject(cause),
  });
  const scope = createScope({ extensions: [ext] });
  const thrown = await scope.ready.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBe(cause);
  const result = await scope.close();
  expect(result.status).toBe("failed");
  if (result.status !== "failed") expect.unreachable();
  expect(result.error).toBe(cause);
  await scope.close();
});

test("a forced close aborts a nested grandchild session", async () => {
  let aborted = false;
  const scope = createScope();
  const child = scope.createSession();
  const grand = child.createSession();
  const probe = resource({
    label: "probe",
    target: "session",
    factory: (_deps, ctx) => {
      ctx.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );
      return 1;
    },
  });
  grand.resolve(probe);
  await scope.close();
  expect(aborted).toBe(true);
});

test("a rejection from a superseded build never goes sticky", async () => {
  let release!: (v: number) => void;
  const gate = new Promise<number>((resolve) => {
    release = resolve;
  });
  const boom = new Error("stale-boom");
  let builds = 0;
  const flaky = resource({
    label: "flaky",
    factory: () => {
      builds += 1;
      const n = builds;
      return gate.then((v) => {
        if (n === 1) throw boom;
        return v * n;
      });
    },
  });
  const scope = createScope();
  const first = scope.controller(flaky).resolve() as Promise<unknown>;
  scope.release(flaky);
  release(10);
  await expect(first).rejects.toBe(boom);
  expect(await scope.resolve(flaky)).toBe(20);
  await scope.close();
});

test("get on a rejected build returns its rejection", async () => {
  const cause = new Error("build-boom");
  const bad = resource({
    label: "bad",
    factory: () => Promise.reject(cause),
  });
  const scope = createScope();
  await scope.resolve(bad).then(
    () => undefined,
    () => undefined,
  );
  await expect(scope.controller(bad).get()).rejects.toBe(cause);
  await scope.close();
});

test("concurrent resolves share one tracked build", async () => {
  let release!: (v: string) => void;
  const gate = new Promise<string>((resolve) => {
    release = resolve;
  });
  let builds = 0;
  const slow = resource({
    label: "slow",
    factory: () => {
      builds += 1;
      const n = builds;
      return gate.then((v) => `${v}-${n}`);
    },
  });
  const scope = createScope();
  const first = scope.controller(slow).resolve() as Promise<unknown>;
  scope.release(slow);
  const second = scope.controller(slow).resolve() as Promise<unknown>;
  release("v");
  expect(await first).toBe("v-1");
  expect(await second).toBe("v-2");
  const third = scope.controller(slow).resolve() as Promise<unknown>;
  expect(await third).toBe("v-2");
  await scope.close();
});

test("releasing a diamond leg then the root still tears down the other leg", () => {
  const cleaned: string[] = [];
  const hook =
    (label: string) =>
    (_deps: never, { defer }: any) => {
      defer(() => void cleaned.push(label));
      return { v: label };
    };
  const d = resource({ label: "d", factory: hook("d") as never });
  const l = resource({ label: "l", depends: { d }, factory: hook("l") as never });
  const r = resource({ label: "r", depends: { d }, factory: hook("r") as never });
  const top = resource({
    label: "top",
    depends: { l, r },
    factory: hook("top") as never,
  });
  const scope = createScope();
  scope.resolve(top);
  scope.release(l);
  expect(cleaned).toEqual(["top", "l"]);
  scope.release(d);
  expect(cleaned).toEqual(["top", "l", "r", "d"]);
});

test("a resource factory may return a non-promise thenable", async () => {
  const slow = resource({
    label: "slow",
    factory: () => ({ then: (resolve: (v: string) => void) => resolve("thenable") }) as never,
  });
  const scope = createScope();
  expect(await scope.resolve(slow)).toBe("thenable");
  await scope.close();
});

test("a build that releases itself still rebuilds on the next resolve", async () => {
  let release!: (v: string) => void;
  const gate = new Promise<string>((resolve) => {
    release = resolve;
  });
  let builds = 0;
  let scope!: ReturnType<typeof createScope>;
  let linked!: Resource.Handle<unknown>;
  const trig = resource({
    label: "trig",
    factory: () => {
      scope.release(linked);
      return 1;
    },
  });
  linked = resource({
    label: "linked",
    depends: { trig },
    factory: ({ trig: t }) => {
      builds += 1;
      const n = builds;
      return gate.then(() => `b${n}:${t}`);
    },
  });
  scope = createScope();
  const first = scope.controller(linked).resolve() as Promise<unknown>;
  const second = scope.controller(linked).resolve() as Promise<unknown>;
  release("go");
  expect(await first).toBe("b1:1");
  expect(await second).toBe("b2:1");
  await scope.close();
});

test("a release waits for every borrower, not just the first done", async () => {
  let release1!: () => void;
  let release2!: () => void;
  const gate1 = new Promise<void>((resolve) => {
    release1 = resolve;
  });
  const gate2 = new Promise<void>((resolve) => {
    release2 = resolve;
  });
  const cleaned: string[] = [];
  const res = resource({
    label: "res",
    factory: (_deps, { defer }) => {
      defer(() => void cleaned.push("res-clean"));
      return 1;
    },
  });
  const borrower = (label: string, gate: Promise<void>) =>
    operation({
      label,
      depends: { res },
      run: async ({ res: n }) => {
        await gate;
        return `${label}:${n}`;
      },
    });
  const scope = createScope();
  const first = scope.run(borrower("one", gate1)) as Promise<unknown>;
  const second = scope.run(borrower("two", gate2)) as Promise<unknown>;
  release1();
  expect(await first).toBe("one:1");
  scope.release(res);
  expect(cleaned).toEqual([]);
  release2();
  expect(await second).toBe("two:1");
  await scope.close();
  expect(cleaned).toEqual(["res-clean"]);
});
