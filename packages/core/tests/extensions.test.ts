import { expect, test } from "vite-plus/test";
import { createScope, data, extension } from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

test("a write chain skips an extension with no write hook", async () => {
  const cell = data({ initial: 0, parse: asNumber });
  const plain = extension({ label: "plain" });
  let seen: unknown = "unset";
  const spy = extension({
    label: "spy",
    write: (_cell, value, next) => {
      seen = value;
      next();
    },
  });
  const scope = createScope({ extensions: [plain, spy] });
  await scope.ready;
  scope.controller(cell).set(4);
  expect(seen).toBe(4);
  expect(scope.controller(cell).get()).toBe(4);
  await scope.close();
});

test("a write chain that skips still refuses when the writer denies", async () => {
  const cell = data({ initial: 1, parse: asNumber });
  const plain = extension({ label: "plain" });
  const deny = extension({ label: "deny", write: () => undefined });
  const scope = createScope({ extensions: [plain, deny] });
  await scope.ready;
  scope.controller(cell).set(2);
  expect(scope.controller(cell).get()).toBe(1);
  await scope.close();
});

test("three write hooks nest in registration order", async () => {
  const cell = data({ initial: 0, parse: asNumber });
  const order: string[] = [];
  const hook = (label: string) =>
    extension({
      label,
      write: (_cell, _value, next) => {
        order.push(`${label}:before`);
        next();
        order.push(`${label}:after`);
      },
    });
  const scope = createScope({ extensions: [hook("a"), hook("b"), hook("c")] });
  await scope.ready;
  scope.controller(cell).set(1);
  expect(order).toEqual(["a:before", "b:before", "c:before", "c:after", "b:after", "a:after"]);
  expect(scope.controller(cell).get()).toBe(1);
  await scope.close();
});

test("three resolve hooks nest in registration order", async () => {
  const cell = data({ initial: 7, parse: asNumber });
  const order: string[] = [];
  const hook = (label: string) =>
    extension({
      label,
      resolve: (target, next) => {
        order.push(`${label}:before`);
        const value = next();
        order.push(`${label}:after`);
        return value;
      },
    });
  const scope = createScope({ extensions: [hook("a"), hook("b"), hook("c")] });
  await scope.ready;
  expect(scope.resolve(cell)).toBe(7);
  expect(order).toEqual(["a:before", "b:before", "c:before", "c:after", "b:after", "a:after"]);
  await scope.close();
});

test("a scope with no resolve hooks reads straight through", async () => {
  const cell = data({ initial: 3, parse: asNumber });
  const scope = createScope({ extensions: [extension({ label: "plain" })] });
  await scope.ready;
  expect(scope.resolve(cell)).toBe(3);
  await scope.close();
});

test("a session chain is installed only when a hook exists", async () => {
  const plain = createScope({ extensions: [extension({ label: "plain" })] });
  await plain.ready;
  expect(await plain.session(() => 5)).toBe(5);
  await plain.close();
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => next(),
  });
  const wrapped = createScope({ extensions: [spy] });
  await wrapped.ready;
  expect(await wrapped.session(() => 6)).toBe(6);
  await wrapped.close();
});
