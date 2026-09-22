import { expect, test } from "vite-plus/test";
import { measureBatch } from "../src/index.ts";

test("a 1.9 ms benchmark batch grows and includes the first batch in its average", () => {
  const batches: number[] = [];
  const result = measureBatch("Preact Signals", 800, (count) => {
    batches.push(count);
    return batches.length === 1 ? 1.9 : 4.1;
  });
  expect(batches).toEqual([800, 1600]);
  expect(result).toBe(6 / 2400);
});

test("a clock that first reports zero can still produce a benchmark result", () => {
  let work = 0;
  const result = measureBatch("quantized clock", 32, (count) => {
    work += count;
    return work < 200 ? 0 : 2;
  });
  expect(result).toBe(2 / 224);
});

test("a benchmark stops if the timer never advances", () => {
  expect(() => measureBatch("stopped clock", 32, () => 0)).toThrow();
});
