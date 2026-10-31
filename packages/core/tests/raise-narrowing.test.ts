import { expect, expectTypeOf, test } from "vite-plus/test";

import { createScope, data, operation, type Operation } from "@/index";

/** Holds nothing, so every body below reaches its `raise` and throws a managed error. */
const maybe = data<string | undefined>({ label: "maybe", initial: undefined });

test("a destructured raise call does not narrow a later value", () => {
  const op = operation({
    label: "destructured",
    depends: { v: maybe },
    run: ({ v }, { raise }) => {
      if (v === undefined) raise("Missing", {});

      expectTypeOf(v).toEqualTypeOf<string | undefined>();
      return v;
    },
  });
  const scope = createScope();

  const result = scope.settle(op);
  if (result.status !== "failed") throw result;
  expect(result).toMatchObject({ kind: "error", error: { kind: "Missing" } });

  return scope.close();
});

test("a ctx read without a written type does not narrow a later value", () => {
  const op = operation({
    label: "unwritten ctx",
    depends: { v: maybe },
    run: ({ v }, ctx) => {
      if (v === undefined) ctx.raise("Missing", {});

      expectTypeOf(v).toEqualTypeOf<string | undefined>();
      return v;
    },
  });
  const scope = createScope();

  const result = scope.settle(op);
  if (result.status !== "failed") throw result;
  expect(result).toMatchObject({ kind: "error", error: { kind: "Missing" } });

  return scope.close();
});

test("a raise call on a written ctx type narrows a later value", () => {
  const op = operation({
    label: "written ctx",
    depends: { v: maybe },
    run: ({ v }, ctx: Operation.Ctx<void>) => {
      if (v === undefined) ctx.raise("Missing", {});

      expectTypeOf(v).toEqualTypeOf<string>();
      return v;
    },
  });
  const scope = createScope();

  const result = scope.settle(op);
  if (result.status !== "failed") throw result;
  expect(result).toMatchObject({ kind: "error", error: { kind: "Missing" } });

  return scope.close();
});

test("a returned raise narrows a later value even when raise is destructured", () => {
  const op = operation({
    label: "returned raise",
    depends: { v: maybe },
    run: ({ v }, { raise }) => {
      if (v === undefined) return raise("Missing", {});

      expectTypeOf(v).toEqualTypeOf<string>();
      return v;
    },
  });
  const scope = createScope();

  const result = scope.settle(op);
  if (result.status !== "failed") throw result;
  expect(result).toMatchObject({ kind: "error", error: { kind: "Missing" } });

  return scope.close();
});
