import { expect, test } from "vite-plus/test";
import { createScope, data, extension, namespace, operation, tag } from "../src/index.ts";

test("a tagged run invokes its hook once with the original call", async () => {
  const zone = tag({ label: "zone", default: "base" });
  const op = operation({ label: "op", depends: { zone }, run: ({ zone }) => zone });
  const seen: unknown[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "spy",
        run: (_op, call, next) => {
          seen.push(call);
          return next();
        },
      }),
    ],
  });
  const call = { tags: zone("west") };
  expect(await scope.run(op, call)).toBe("west");
  expect(seen).toEqual([call]);
  await scope.close();
});

test("a subflow run invokes its hook once", async () => {
  const child = operation({ label: "child", run: () => 3 });
  const parent = operation({
    label: "parent",
    depends: { child },
    run: ({ child }) => child.run(),
  });
  const seen: string[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "spy",
        run: (op, _call, next) => {
          seen.push(op.label ?? "inline");
          return next();
        },
      }),
    ],
  });
  expect(scope.run(parent)).toBe(3);
  expect(seen).toEqual(["parent", "child"]);
  await scope.close();
});

test("an inline run in a session invokes its hook with the inline config", async () => {
  const inline = { run: () => 4 };
  const seen: unknown[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "spy",
        run: (op, _call, next) => {
          seen.push(op);
          return next();
        },
      }),
    ],
  });
  expect(await scope.session((session) => session.run(inline))).toBe(4);
  expect(seen).toEqual([inline]);
  await scope.close();
});

test("a run hook that skips next stops a subflow with its substitute", async () => {
  let ran = false;
  const child = operation({
    label: "child",
    run: () => {
      ran = true;
      return "ran";
    },
  });
  const parent = operation({
    label: "parent",
    depends: { child },
    run: ({ child }) => child.run(),
  });
  const scope = createScope({
    extensions: [
      extension({
        label: "deny",
        run: (op, _call, next) => ("label" in op && op.label === "child" ? "denied" : next()),
      }),
    ],
  });
  expect(scope.run(parent)).toBe("denied");
  expect(ran).toBe(false);
  await scope.close();
});

test("a namespaced write invokes its hook once", async () => {
  const cell = data({ initial: 0 });
  const east = namespace();
  const seen: unknown[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "spy",
        write: (_cell, value, next) => {
          seen.push(value);
          next();
        },
      }),
    ],
  });
  scope.controller(cell, { ns: east }).set(2);
  expect(scope.controller(cell, { ns: east }).get()).toBe(2);
  expect(seen).toEqual([2]);
  await scope.close();
});

test("two hooks keep registration order on a child layer", async () => {
  const cell = data({ initial: 0 });
  const op = operation({ label: "op", run: () => 5 });
  const order: string[] = [];
  const hook = (label: string) =>
    extension({
      label,
      run: (_op, _call, next) => {
        order.push(`${label}:run-before`);
        const result = next();
        order.push(`${label}:run-after`);
        return result;
      },
      write: (_cell, _value, next) => {
        order.push(`${label}:write-before`);
        next();
        order.push(`${label}:write-after`);
      },
    });
  const scope = createScope({ extensions: [hook("a"), hook("b")] });
  const session = scope.createSession();
  expect(session.run(op)).toBe(5);
  session.controller(cell).set(1);
  expect(order).toEqual([
    "a:run-before",
    "b:run-before",
    "b:run-after",
    "a:run-after",
    "a:write-before",
    "b:write-before",
    "b:write-after",
    "a:write-after",
  ]);
  await scope.close();
});
