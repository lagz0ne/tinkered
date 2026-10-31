import { expect, test } from "vite-plus/test";

import { createScope, data, isError, operation } from "@/index";

const refused = "Refused" as const;
type RefusedPayload = { message: string };

test("isError rejects a plain error with no kind", () => {
  expect(isError(new Error("plain"), "Disposed")).toBe(false);
});

test("isError rejects a real error of the wrong kind", async () => {
  const cell = data({ initial: 0 });
  const scope = createScope();
  const held = scope.controller(cell);

  await scope.close();
  let thrown: unknown;
  try {
    held.set(1);
  } catch (error) {
    thrown = error;
  }

  if (!isError(thrown, "Disposed")) throw thrown;
  expect(isError(thrown, "NotResolved")).toBe(false);
});

test("an app's own raise kind comes back on settle with its payload", () => {
  const book = operation({
    label: "book",
    run: (_deps, { raise }) => raise(refused, { message: "no seat" } satisfies RefusedPayload),
  });
  const scope = createScope();

  const result = scope.settle(book);
  if (result.status !== "failed") throw result;
  expect(result).toMatchObject({
    kind: "error",
    error: { kind: refused, payload: { message: "no seat" } },
  });

  return scope.close();
});
