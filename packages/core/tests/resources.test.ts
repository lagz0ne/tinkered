import { expect, test } from "vite-plus/test";
import { createScope, data, isError, operation, resource } from "../src/index.ts";

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
  const result = await scope.close();
  expect(seen).toEqual(["kept"]);
  expect(result.teardownErrors).toContain(boom);
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
  expect(result.teardownErrors).toContain(boom);
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
