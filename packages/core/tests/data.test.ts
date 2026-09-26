import { expect, test } from "vite-plus/test";
import { createScope, data, isError, operation, readMany, tag } from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

test("an empty nested list reads frozen", () => {
  const items = readMany<number>([[], []]);
  let threw = false;
  try {
    (items as number[]).push(1);
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
});

test("a data controller get reads the latest write", () => {
  const count = data({ initial: 0, parse: asNumber });
  const scope = createScope();
  const ctl = scope.controller(count);
  ctl.set(9);
  expect(ctl.get()).toBe(9);
});

test("a scope with empty tag bindings reads defaults", () => {
  const zone = tag<string>({ label: "zone", default: "base" });
  const read = operation({
    label: "read",
    depends: { zone },
    run: ({ zone: z }) => z,
  });
  expect(createScope({ tags: [] }).controller(read).run()).toBe("base");
});

test("an operation depending on a non-unit fails with InvalidDependency", () => {
  const bad = operation({
    label: "bad",
    depends: { junk: {} as never },
    run: () => 1,
  });
  let thrown: unknown;
  try {
    createScope().controller(bad).run();
  } catch (error) {
    thrown = error;
  }
  if (!isError(thrown, "InvalidDependency")) throw thrown;
  expect(thrown.payload.label).toBe("unknown");
});
