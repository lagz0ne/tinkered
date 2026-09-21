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
