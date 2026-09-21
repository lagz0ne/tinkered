import { expect, test } from "vite-plus/test";
import { createScope, data, isError } from "../src/index.ts";

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
