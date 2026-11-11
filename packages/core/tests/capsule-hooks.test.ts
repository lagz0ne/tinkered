import { expect, test } from "vite-plus/test";

import { createScope, data, capsule, isError, operation } from "@/index";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

const press = operation({
  label: "press",
  input: (raw): { x: number } => ({ x: asNumber(raw) }),
  run: (_, { input }) => input.x,
});

test("a write chain skips a capsule with no write hook", async () => {
  const cell = data({ initial: 0, parse: asNumber });
  const plain = capsule({ label: "plain" });
  let seen: unknown = "unset";
  const spy = capsule({
    label: "spy",
    hooks: {
      write: (event) => {
        seen = event.value;
        event.next();
      },
    },
  });

  const scope = createScope({ capsules: [plain, spy] });
  await scope.ready;
  scope.controller(cell).set(4);

  expect(seen).toBe(4);
  expect(scope.controller(cell).get()).toBe(4);
  await scope.close();
});

test("a write chain that skips still refuses when the writer denies", async () => {
  const cell = data({ initial: 1, parse: asNumber });
  const plain = capsule({ label: "plain" });
  const deny = capsule({
    label: "deny",
    hooks: {
      write: () => undefined,
    },
  });
  const scope = createScope({ capsules: [plain, deny] });
  await scope.ready;

  scope.controller(cell).set(2);

  expect(scope.controller(cell).get()).toBe(1);
  await scope.close();
});

test("three write hooks nest in registration order", async () => {
  const cell = data({ initial: 0, parse: asNumber });
  const order: string[] = [];
  const hook = (label: string) =>
    capsule({
      label,
      hooks: {
        write: (event) => {
          order.push(`${label}:before`);
          event.next();
          order.push(`${label}:after`);
        },
      },
    });

  const scope = createScope({ capsules: [hook("a"), hook("b"), hook("c")] });
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
    capsule({
      label,
      hooks: {
        resolve: (event) => {
          order.push(`${label}:before`);
          const value = event.next();
          order.push(`${label}:after`);
          return value;
        },
      },
    });

  const scope = createScope({ capsules: [hook("a"), hook("b"), hook("c")] });
  await scope.ready;
  expect(scope.resolve(cell)).toBe(7);

  expect(order).toEqual(["a:before", "b:before", "c:before", "c:after", "b:after", "a:after"]);
  await scope.close();
});

test("a scope with no resolve hooks reads straight through", async () => {
  const cell = data({ initial: 3, parse: asNumber });
  const scope = createScope({ capsules: [capsule({ label: "plain" })] });
  await scope.ready;
  expect(scope.resolve(cell)).toBe(3);
  await scope.close();
});

test("a session chain is installed only when a hook exists", async () => {
  const plain = createScope({ capsules: [capsule({ label: "plain" })] });
  await plain.ready;
  expect(await plain.session(() => 5)).toBe(5);
  await plain.close();

  const spy = capsule({
    label: "spy",
    hooks: {
      session: async (event) => event.next(),
    },
  });

  const wrapped = createScope({ capsules: [spy] });
  await wrapped.ready;
  expect(await wrapped.session(() => 6)).toBe(6);
  await wrapped.close();
});

test("three run hooks nest in registration order", async () => {
  const order: string[] = [];
  const op = operation({ label: "op", run: () => 1 });
  const hook = (label: string) =>
    capsule({
      label,
      hooks: {
        run: (event) => {
          order.push(`${label}:before`);
          const out = event.next();
          order.push(`${label}:after`);
          return out;
        },
      },
    });

  const scope = createScope({ capsules: [hook("a"), hook("b"), hook("c")] });
  await scope.ready;
  await scope.run(op);

  expect(order).toEqual(["a:before", "b:before", "c:before", "c:after", "b:after", "a:after"]);
  await scope.close();
});

test("two close hooks nest in reverse install order", async () => {
  const order: string[] = [];
  const hook = (label: string) =>
    capsule({
      label,
      hooks: {
        close: async (event) => {
          order.push(`${label}:before`);
          const result = await event.next();
          order.push(`${label}:after`);
          return result;
        },
      },
    });

  const scope = createScope({ capsules: [hook("a"), hook("b")] });
  await scope.ready;
  await scope.close({ graceful: true });

  expect(order).toEqual(["b:before", "a:before", "a:after", "b:after"]);
});

test("a scope with no close hooks closes straight through", async () => {
  const scope = createScope({ capsules: [capsule({ label: "plain" })] });
  await scope.ready;
  expect((await scope.close({ graceful: true })).status).toBe("success");

  const forced = createScope({ capsules: [capsule({ label: "plain" })] });
  await forced.ready;
  expect((await forced.close()).status).toBe("cancelled");
});

test("a forced close with a close hook still settles cancelled", async () => {
  const seen: string[] = [];
  const hook = capsule({
    label: "spy",
    hooks: {
      close: async (event) => {
        const result = await event.next();
        seen.push(result.status);
        return result;
      },
    },
  });
  const scope = createScope({ capsules: [hook] });
  await scope.ready;

  const result = await scope.close();

  expect(result.status).toBe("cancelled");
  expect(seen).toEqual(["cancelled"]);
});

test("a close chain runs past a capsule with no close hook", async () => {
  const order: string[] = [];
  const plain = capsule({ label: "plain" });
  const closer = capsule({
    label: "closer",
    hooks: {
      close: async (event) => {
        order.push("before");
        const result = await event.next();
        order.push("after");
        return result;
      },
    },
  });

  const scope = createScope({ capsules: [plain, closer] });
  await scope.ready;
  await scope.close({ graceful: true });

  expect(order).toEqual(["before", "after"]);
});

test("a resolve chain runs past a capsule with no resolve hook", async () => {
  const cell = data({ initial: 5, parse: asNumber });
  const order: string[] = [];
  const plain = capsule({ label: "plain" });
  const wrap = capsule({
    label: "wrap",
    hooks: {
      resolve: (event) => {
        order.push("before");
        const value = event.next();
        order.push("after");
        return value;
      },
    },
  });

  const scope = createScope({ capsules: [plain, wrap] });
  await scope.ready;

  expect(scope.resolve(cell)).toBe(5);
  expect(order).toEqual(["before", "after"]);
  await scope.close();
});

test("a run hook that asks which op it wraps changes that op only", async () => {
  const tick = operation({ label: "tick", run: () => 1 });
  const twice = capsule({
    label: "twice",
    hooks: {
      run: (event) => (event.is(press) ? event.next() + event.input.x : event.next()),
    },
  });
  const scope = createScope({ capsules: [twice] });
  await scope.ready;

  const out = [await scope.run(press, { input: { x: 2 } }), await scope.run(tick)];

  expect(out).toEqual([4, 1]);
  await scope.close();
});

test("a run event gives a raw call's input as the op parses it", async () => {
  let seen: unknown = "unset";
  const spy = capsule({
    label: "spy",
    hooks: {
      run: (event) => {
        seen = event.input;
        return event.next();
      },
    },
  });
  const scope = createScope({ capsules: [spy] });
  await scope.ready;

  await scope.run(press, { rawInput: 3 });

  expect(seen).toEqual({ x: 3 });
  await scope.close();
});

test("a run event's input refuses a bad raw input as the op does", async () => {
  const reader = capsule({ label: "reader", hooks: { run: (event) => event.input } });
  const scope = createScope({ capsules: [reader] });
  await scope.ready;

  const failed = await scope.run(press, { rawInput: "three" }).then(
    () => undefined,
    (error: unknown) => error,
  );

  if (!isError(failed, "DataValidationFailed")) throw failed;
  expect(failed.payload.label).toBe("press");
  await scope.close();
});

test("a run event of an inline run gives the caller's input", async () => {
  const reader = capsule({ label: "reader", hooks: { run: (event) => event.input } });
  const scope = createScope({ capsules: [reader] });
  await scope.ready;

  const out = await scope.run({ run: (_, { input }) => input }, { input: 5 });

  expect(out).toBe(5);
  await scope.close();
});

test("a run event of a run with no call has no input", async () => {
  let seen: unknown = "unset";
  const tick = operation({ label: "tick", run: () => 1 });
  const spy = capsule({
    label: "spy",
    hooks: {
      run: (event) => {
        seen = event.input;
        return event.next();
      },
    },
  });
  const scope = createScope({ capsules: [spy] });
  await scope.ready;

  await scope.run(tick);

  expect(seen).toBe(undefined);
  await scope.close();
});
