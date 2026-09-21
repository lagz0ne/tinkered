import { expect, test } from "vite-plus/test";
import { createScope, data, operation, tag } from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

test("a tagged call replays typed input inside the child session", async () => {
  const zone = tag<string>({ label: "zone" });
  const double = operation({
    label: "double",
    input: asNumber,
    run: (_deps, { input }) => input * 2,
  });
  expect(await createScope().run(double, { input: 21, tags: [zone("eu")] })).toBe(42);
});

test("a tagged call replays raw input inside the child session", async () => {
  const zone = tag<string>({ label: "zone" });
  const double = operation({
    label: "double",
    input: asNumber,
    run: (_deps, { input }) => input * 2,
  });
  expect(await createScope().run(double, { rawInput: 21, tags: [zone("eu")] })).toBe(42);
});

test("a tagged call with no input still reads the call tags", async () => {
  const zone = tag<string>({ label: "zone" });
  const read = operation({
    label: "read",
    depends: { zone },
    run: ({ zone }) => zone,
  });
  expect(await createScope().run(read, { tags: [zone("us")] })).toBe("us");
});

test("an operation writes through a data controller edge", () => {
  const count = data({ initial: 10, parse: asNumber });
  const bump = operation({
    label: "bump",
    input: asNumber,
    depends: { c: count.controller },
    run: ({ c }, { input }) => c.update((n) => n + input),
  });
  const scope = createScope();
  scope.run(bump, { rawInput: 5 });
  expect(scope.resolve(count)).toBe(15);
});
