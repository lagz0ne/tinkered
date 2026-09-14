import { expect, test } from "vite-plus/test";
import { createScope, data, isError, operation } from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
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
