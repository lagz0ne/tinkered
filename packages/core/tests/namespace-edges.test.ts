import { expect, test } from "vite-plus/test";
import { createScope, data, namespace } from "../src/index.ts";

test("named and chained cell watches notify only when their resolved value changes", async () => {
  const a = namespace();
  const b = namespace();
  const cell = data({ initial: 0 });
  const scope = createScope();
  const named: [number, number][] = [];
  const chain: [number, number][] = [];
  scope.controller(cell, { ns: a }).watch((next, prev) => named.push([prev, next]));
  scope.controller(cell, { ns: [a, b] }).watch((next, prev) => chain.push([prev, next]));
  scope.controller(cell, { ns: b }).set(1);
  expect(named).toEqual([]);
  expect(chain).toEqual([[0, 1]]);
  scope.controller(cell, { ns: b }).set(2);
  expect(chain).toEqual([[0, 1], [1, 2]]);
  scope.controller(cell, { ns: a }).set(3);
  expect(named).toEqual([[0, 3]]);
  expect(chain).toEqual([[0, 1], [1, 2], [2, 3]]);
  scope.controller(cell).set(9);
  expect(named).toEqual([[0, 3]]);
  expect(chain).toEqual([[0, 1], [1, 2], [2, 3]]);
  await scope.close();
});
