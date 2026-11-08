import { expect, expectTypeOf, test } from "vite-plus/test";

import {
  capsule,
  createScope,
  data,
  isError,
  namespace,
  operation,
  resource,
  type Data,
} from "@/index";

const caught = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

const point = data<string | null>({ label: "talk.point", initial: "a" });

const clearPoint = operation({
  label: "talk.clearPoint",
  depends: { point: point.controller },
  run: ({ point }) => point.set(null),
});

const talk = capsule({ label: "talk", exports: { point, clearPoint } });

test("R1 a cell export is a read view, not the raw cell", () => {
  expect(talk.point).not.toBe(point);
  expect(talk.point.label).toBe("talk.point");
  expect(talk().point).toBe(talk.point);
  expect(talk.clearPoint).toBe(clearPoint);

  expect(Object.keys(talk)).toEqual(expect.arrayContaining(["point", "clearPoint"]));
  expectTypeOf(talk.point).toEqualTypeOf<Data.View<string | null>>();
});

test("R2 a unit that depends on the view gets get and watch, and sees the owner's op write", async () => {
  const seen: (string | null)[] = [];
  const follow = resource({
    label: "work.follow",
    depends: { point: talk.point },
    factory: ({ point }) => {
      expectTypeOf(point).toEqualTypeOf<Data.Reader<string | null>>();
      point.watch((next) => seen.push(next));
      return point;
    },
  });
  const scope = await createScope({ capsules: [talk] }).ready;

  const reader = scope.resolve(follow) as Data.Reader<string | null>;
  expect(Object.keys(reader).sort()).toEqual(["get", "watch"]);
  expect(reader.get()).toBe("a");
  scope.run(talk.clearPoint);

  expect(reader.get()).toBe(null);
  expect(seen).toEqual([null]);
});

test("R3 the view has no controller and no path to the cell: nothing to write through", () => {
  expect(talk.point).not.toHaveProperty("controller");
  expect(talk.point).not.toHaveProperty("target");
  expect(Object.values(talk.point)).not.toContain(point);
  // @ts-expect-error a view has no controller
  expect(talk.point.controller).toBeUndefined();
});

test("R3b a depends that names the missing controller fails at first touch, before any work", async () => {
  const work: string[] = [];
  const clearFromWork = operation({
    label: "work.clear",
    // @ts-expect-error a view has no controller
    depends: { point: talk.point.controller },
    run: () => work.push("ran"),
  });
  const scope = await createScope({ capsules: [talk] }).ready;

  const error = caught(() => scope.run(clearFromWork));

  if (!isError(error, "InvalidDependency")) throw error;
  expect(error.payload).toEqual({
    label: "work.clear",
    reason: "depends.point names no unit (a capsule export has no controller)",
  });
  expect(work).toEqual([]);
});

test("R4 the raw cell keeps full power, as today", async () => {
  const clearRaw = operation({
    label: "work.clearRaw",
    depends: { point: point.controller },
    run: ({ point }) => point.set("raw"),
  });
  const scope = await createScope({ capsules: [talk] }).ready;

  scope.run(clearRaw);

  expect(scope.resolve(point)).toBe("raw");
});

test("R5 the view still needs its capsule: CapsuleMissing", () => {
  const read = operation({
    label: "work.read",
    depends: { point: talk.point },
    run: ({ point }) => point.get(),
  });
  const error = caught(() => createScope({}).run(read));

  if (!isError(error, "CapsuleMissing")) throw error;
  expect(error.payload).toEqual({ unit: "talk.point", capsule: "talk" });
});

test("R6 scope.resolve on the view answers the same reader each time", () => {
  const scope = createScope({ capsules: [talk] });

  const one = scope.resolve(talk.point);
  const two = scope.resolve(talk.point);

  expectTypeOf(one).toEqualTypeOf<Data.Reader<string | null>>();
  expect(one).toBe(two);
  expect(one.get()).toBe("a");
});

test("R7 a hook's load of the view answers a reader, never a controller", async () => {
  const seen: unknown[] = [];
  const watcher = capsule({
    label: "watcher",
    hooks: {
      start: async ({ load, run, next }) => {
        const reader = load(talk.point, { role: "worker", explain: "Follows the point" });
        expectTypeOf(reader).toEqualTypeOf<Data.Reader<string | null>>();

        seen.push(Object.keys(reader).sort(), reader.get());
        reader.watch((value) => seen.push(value));

        await run(talk.clearPoint, {}, { role: "setup", explain: "Clears it" });
        return next();
      },
    },
  });

  const scope = createScope({ capsules: [talk, watcher] });
  await scope.ready;

  expect(seen).toEqual([["get", "watch"], "a", null]);
});

test("R8 a family member reads through the view in its namespace", () => {
  const scope = createScope({ capsules: [talk] });
  const room = namespace();
  scope.controller(point, { ns: room }).set("in room");

  expect(scope.resolve(talk.point, { ns: room }).get()).toBe("in room");
  expect(scope.resolve(talk.point).get()).toBe("a");
});

test("R9 a resource on the view rebuilds when the cell is released, as on the cell", () => {
  let built = 0;
  const follow = resource({
    label: "work.follow",
    depends: { point: talk.point },
    factory: ({ point }) => {
      built += 1;
      return point.get();
    },
  });
  const scope = createScope({ capsules: [talk] });

  expect(scope.resolve(follow)).toBe("a");
  scope.release(point);
  scope.resolve(follow);

  expect(built).toBe(2);
});

test("R10 a raw controller edge on an exported cell still needs its capsule", () => {
  const write = operation({
    label: "work.write",
    depends: { point: point.controller },
    run: ({ point }) => point.set("x"),
  });

  const error = caught(() => createScope({}).run(write));

  if (!isError(error, "CapsuleMissing")) throw error;
  expect(error.payload).toEqual({ unit: "talk.point", capsule: "talk" });
});

test("R11 an inline run that names the view's controller fails before its body", async () => {
  const work: string[] = [];
  const scope = await createScope({ capsules: [talk] }).ready;

  const error = caught(() =>
    scope.run({
      // @ts-expect-error a view has no controller
      depends: { point: talk.point.controller },
      run: () => work.push("ran"),
    }),
  );

  if (!isError(error, "InvalidDependency")) throw error;
  expect(error.payload).toEqual({
    label: "inline",
    reason: "depends.point names no unit (a capsule export has no controller)",
  });
  expect(work).toEqual([]);
});
