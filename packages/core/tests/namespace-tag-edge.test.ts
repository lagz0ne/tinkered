import { expect, test } from "vite-plus/test";
import { createScope, namespace, tag } from "../src/index.ts";

test("named tag all keeps repeated bindings through a chain", async () => {
  const value = tag<number>({ label: "value" });
  const a = namespace({ tags: [value(1), value(1)] });
  const b = namespace({ tags: [value(2)] });
  const scope = createScope();
  expect(scope.resolve(value.all, { ns: a })).toEqual([1, 1]);
  expect(scope.resolve(value.all, { ns: [a, b] })).toEqual([1, 1, 2]);
  await scope.close();
});
