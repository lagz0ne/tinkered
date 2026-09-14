/** Bench-lane probe (ADR 0016 exception to the no-clock rule): a warm read must be
 * O(1) in chain depth — the effective-cell cache must not re-walk ancestors. Ratio
 * against a shallow chain, with generous slack, so it proves shape without flaking. */
import { expect, test } from "vite-plus/test";
import { createScope, data } from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

const warmReadMs = (depth: number, iters: number, seedRoot: boolean): number => {
  const v = data({ initial: 0, parse: asNumber });
  const root = createScope();
  let layer = root;
  for (let i = 0; i < depth; i++) layer = layer.createSession();
  if (seedRoot) root.getController(v).set(1);
  const leaf = layer.getController(v);
  leaf.read();
  const start = performance.now();
  for (let i = 0; i < iters; i++) leaf.read();
  return performance.now() - start;
};

test("warm read with a cached inherited entry is O(1) in chain depth", () => {
  const iters = 100_000;
  const shallow = warmReadMs(1, iters, true);
  const deep = warmReadMs(200, iters, true);
  expect(deep).toBeLessThan(shallow * 5 + 10);
});

test("warm read with cached absence (initial) is O(1) in chain depth", () => {
  const iters = 100_000;
  const shallow = warmReadMs(1, iters, false);
  const deep = warmReadMs(200, iters, false);
  expect(deep).toBeLessThan(shallow * 5 + 10);
});
