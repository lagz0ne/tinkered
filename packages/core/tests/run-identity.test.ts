import { expect, test } from "vite-plus/test";

import { createScope, namespace, operation, tag, type Operation } from "@/index";

type Payload = { x: number };

const isPayload = (raw: unknown): raw is Payload =>
  typeof raw === "object" && raw !== null && "x" in raw;

/** Stands in for a parser that hands back the object it read. */
const readPayload = (raw: unknown): Payload => {
  if (!isPayload(raw)) throw new Error("not a payload");
  return raw;
};

/** The object a building parser answers with, kept so a test can name it by identity. */
const built: Payload = { x: 99 };
const buildPayload = (): Payload => built;

const zone = tag({ label: "zone", default: "home" });

test("a nested controller run passes the caller's object to the callee and returns the callee's own object", () => {
  const obj: Payload = { x: 1 };
  const returned: Payload = { x: 2 };
  let seen: Payload | undefined;
  const inner: Operation.Handle<Payload, Payload> = operation({
    label: "inner",
    run: (_deps, ctx) => {
      seen = ctx.input;
      return returned;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner.controller },
    run: ({ sub }) => sub.run({ input: obj }),
  });
  const scope = createScope();

  expect(scope.run(outer)).toBe(returned);
  expect(seen).toBe(obj);

  return scope.close();
});

test("an async nested controller run gives the caller the callee's own object", async () => {
  const obj: Payload = { x: 1 };
  const returned: Payload = { x: 2 };
  let seen: Payload | undefined;
  const inner: Operation.Handle<Promise<Payload>, Payload> = operation({
    label: "inner",
    run: async (_deps, ctx) => {
      seen = ctx.input;
      return returned;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner.controller },
    run: async ({ sub }) => sub.run({ input: obj }),
  });
  const scope = createScope();

  expect(await scope.run(outer)).toBe(returned);
  expect(seen).toBe(obj);

  await scope.close();
});

test("a callee that changes ctx.input changes the caller's object", () => {
  const obj: Payload = { x: 1 };
  const inner: Operation.Handle<void, Payload> = operation({
    label: "inner",
    run: (_deps, ctx) => {
      ctx.input.x = 2;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner.controller },
    run: ({ sub }) => {
      sub.run({ input: obj });
      return obj.x;
    },
  });
  const scope = createScope();

  expect(scope.run(outer)).toBe(2);

  return scope.close();
});

test("a tagged nested call passes the caller's object into the child session", async () => {
  const obj: Payload = { x: 1 };
  let seen: Payload | undefined;
  const inner: Operation.Handle<Payload, Payload> = operation({
    label: "inner",
    depends: { zone },
    run: (_deps, ctx) => {
      seen = ctx.input;
      return ctx.input;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner.controller },
    run: ({ sub }) => sub.run({ input: obj, tags: zone("away") }),
  });
  const scope = createScope();

  expect(await scope.run(outer)).toBe(obj);
  expect(seen).toBe(obj);

  await scope.close();
});

test("a namespaced nested call passes the caller's object to the callee", () => {
  const obj: Payload = { x: 1 };
  const ns = namespace();
  let seen: Payload | undefined;
  const inner: Operation.Handle<Payload, Payload> = operation({
    label: "inner",
    run: (_deps, ctx) => {
      seen = ctx.input;
      return ctx.input;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner.controller },
    run: ({ sub }) => sub.run({ input: obj, ns }),
  });
  const scope = createScope();

  expect(scope.run(outer)).toBe(obj);
  expect(seen).toBe(obj);

  return scope.close();
});

test("a scope run passes the caller's object to the callee and returns the callee's own object", () => {
  const obj: Payload = { x: 1 };
  const returned: Payload = { x: 2 };
  let seen: Payload | undefined;
  const op: Operation.Handle<Payload, Payload> = operation({
    label: "op",
    run: (_deps, ctx) => {
      seen = ctx.input;
      return returned;
    },
  });
  const scope = createScope();

  expect(scope.run(op, { input: obj })).toBe(returned);
  expect(seen).toBe(obj);

  return scope.close();
});

test("a session run passes the caller's object to the callee and returns the callee's own object", async () => {
  const obj: Payload = { x: 1 };
  const returned: Payload = { x: 2 };
  let seen: Payload | undefined;
  const op: Operation.Handle<Payload, Payload> = operation({
    label: "op",
    run: (_deps, ctx) => {
      seen = ctx.input;
      return returned;
    },
  });
  const scope = createScope();
  const session = scope.createSession();

  expect(session.run(op, { input: obj })).toBe(returned);
  expect(seen).toBe(obj);

  await session.close();
  await scope.close();
});

test("a parser that hands back its raw object gives ctx.input that object", () => {
  const obj: Payload = { x: 1 };
  let raw: unknown;
  let parsed: Payload | undefined;
  const read = operation({
    label: "read",
    input: readPayload,
    run: (_deps, ctx) => {
      raw = ctx.rawInput;
      parsed = ctx.input;
      return ctx.input;
    },
  });
  const scope = createScope();

  expect(scope.run(read, { rawInput: obj })).toBe(obj);
  expect(raw).toBe(obj);
  expect(parsed).toBe(obj);

  return scope.close();
});

test("a parser's new object is ctx.input while ctx.rawInput stays the caller's", () => {
  const obj: Payload = { x: 1 };
  let raw: unknown;
  let parsed: Payload | undefined;
  const build = operation({
    label: "build",
    input: buildPayload,
    run: (_deps, ctx) => {
      raw = ctx.rawInput;
      parsed = ctx.input;
      return ctx.input;
    },
  });
  const scope = createScope();

  expect(scope.run(build, { rawInput: obj })).toBe(built);
  expect(raw).toBe(obj);
  expect(parsed).toBe(built);

  return scope.close();
});
