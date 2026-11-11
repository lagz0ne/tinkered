import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";

import { bench } from "@/bench";
import { report, sample } from "@/bench/harness";
import type { Sampler } from "@/bench/harness";
import type { Lib } from "@/bench/subjects";

// The bench harness, run with a hand-driven timer and a library that renders on demand. The
// lint's one-door rule is for features; a test reads the harness file as the page does.

/** A timer that answers each `now()` from a list: the batch's start, then its end, and so on. */
const timer = (reads: number[]) => ({ now: () => reads.shift() ?? 0 });

/** A library whose every write counts as `per` renders. */
const lib = (name: string, per = 1): Lib => {
  let renders = 0;
  return {
    name,
    fine: true,
    App: () => null,
    update: () => void (renders += per),
    updateShared: () => void (renders += per * 50),
    renders: () => renders,
    reset: () => void (renders = 0),
  };
};

const sampler = (
  l: Lib,
  times: Partial<Record<"update" | "fanout" | "mount", number[]>> = {},
): Sampler => ({
  lib: l,
  rerenders: 1,
  live: null,
  k: 1,
  update: times.update ?? [],
  fanout: times.fanout ?? [],
  mount: times.mount ?? [],
});

const scopeWith = (reads: number[]) =>
  createScope({ capsules: [bench({ timer: timer(reads) })] }).ready;

test("a 1.9 ms batch grows, and the first batch counts in the average", async () => {
  const scope = await scopeWith([0, 1.9, 10, 14.1]);

  expect(scope.run(sample, { input: { s: sampler(lib("a")), phase: "update" } })).toBe(6 / 2400);
});

test("a timer that first reads zero still gives a result", async () => {
  const scope = await scopeWith([5, 5, 5, 7]);

  expect(scope.run(sample, { input: { s: sampler(lib("a")), phase: "update" } })).toBe(2 / 2400);
});

test("a timer that never moves stops the run, naming the library", async () => {
  const scope = await scopeWith([]);
  const result = scope.settle(sample, {
    input: { s: sampler(lib("still")), phase: "update" },
  });

  expect(result.status).toBe("failed");
  expect(Object(result).error).toMatchObject({
    kind: "HarnessInvariant",
    payload: { library: "still" },
  });
});

test("a library that renders less than it was asked stops the run", async () => {
  const scope = await scopeWith([0, 5]);
  const result = scope.settle(sample, {
    input: { s: sampler(lib("lazy", 0)), phase: "update" },
  });

  expect(Object(result).error).toMatchObject({
    payload: { library: "lazy", reason: "0 renders for 800 writes, expected 800" },
  });
});

test("the report sorts by update, says each gap, and puts @tinker/react in context", async () => {
  const scope = await scopeWith([]);
  const steady = (ms: number) => Array.from({ length: 9 }, () => ms);
  const out = scope.run(report, {
    input: [
      sampler(lib("slow store"), { update: steady(0.004), fanout: steady(0.1), mount: steady(1) }),
      sampler(lib("@tinker/react"), {
        update: steady(0.002),
        fanout: steady(0.1),
        mount: steady(1),
      }),
    ],
  });

  expect(out.rows.map((r) => r.name)).toEqual(["@tinker/react", "slow store"]);
  expect(out.rows[1]!.update).toMatchObject({ text: "4.00", compare: "2.0× slower", bar: 100 });
  expect(out.rows[0]!.update).toMatchObject({ text: "2.00", compare: "≈ fastest", fastest: true });
  expect(out.takeaway?.update.gaps).toEqual([{ name: "slow store", words: "2.0× faster than" }]);
  expect(out.takeaway?.fanout.gaps).toEqual([{ name: "slow store", words: "about the same as" }]);
});
