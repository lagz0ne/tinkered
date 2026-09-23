import { expect, test } from "vite-plus/test";
import { createScope, data, namespace } from "../src/index.ts";

test("a notifying watcher cannot rob the next watcher with a nested write", async () => {
  const ns = namespace();
  const cell = data({ initial: 0 });
  const scope = createScope();
  const ctl = scope.controller(cell, { ns });
  ctl.set(1);
  const seen: [number, number][] = [];
  ctl.watch((next) => {
    if (next === 2) ctl.set(3);
  });
  ctl.watch((next, prev) => seen.push([prev, next]));
  ctl.set(2);
  expect(seen).toEqual([
    [2, 3],
    [1, 2],
  ]);
  await scope.close();
});
