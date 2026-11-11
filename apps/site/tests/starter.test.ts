import { createScope, isError } from "@tinker/core";
import { makeTestClock } from "@tinker/core/testing";
import { expect, test } from "vite-plus/test";

import { clear, facing, press, setStorm, tune, turn } from "@/play/starter/engine";
import { ocean } from "@/play/starter/ocean";
import { board, heading, storm, walls, waves } from "@/play/starter/state";
import type { Frames } from "@/play/starter/state";

// The starter ocean, as the play page compiles it, run here on a 3×3 board: a hand-driven frame
// queue, a test clock, and a random that always says 0. Ported from the playground's engine tests.

/** Frames by hand: `pump` runs what is queued, `pending` counts it. */
const frameQueue = () => {
  let next = 1;
  const due = new Map<number, FrameRequestCallback>();
  const frames: Frames = {
    requestAnimationFrame: (cb) => (due.set(next, cb), next++),
    cancelAnimationFrame: (id) => void due.delete(id),
  };
  const pump = () => {
    const run = [...due.values()];
    due.clear();
    for (const cb of run) cb(0);
  };
  return { frames, pump, pending: () => due.size };
};

const game = async () => {
  const queue = frameQueue();
  const clock = makeTestClock({ now: 1000 });
  const app = createScope({
    clock,
    random: { next: () => 0, uuid: () => "0" },
    capsules: [ocean({ cols: 3, rows: 3, frames: queue.frames })],
  });
  const scope = await app.ready;

  const shades = () => scope.controller(board).get();
  const count = () => scope.controller(waves).get().length;
  return { scope, clock, queue, shades, count };
};

const refused = (call: () => unknown) => {
  try {
    call();
  } catch (error) {
    expect(isError(error, "DataValidationFailed")).toBe(true);
    return;
  }
  expect.unreachable();
};

test("a press lifts the tile it hits, and the lift moves outward", async () => {
  const { scope, clock, queue, shades } = await game();
  queue.pump();
  expect(shades()[4]!.z).toBe(0);

  expect(scope.run(press, { input: { x: 1, y: 1 } })).toBe(0);
  clock.advance(300);
  queue.pump();
  expect(shades()[4]!.z).toBeGreaterThan(0);
  expect(shades()[1]!.z).toBeGreaterThan(0);

  clock.advance(300);
  queue.pump();
  expect(shades()[4]!.z).toBe(0);
  expect(shades()[1]!.z).toBeGreaterThan(0);
  expect(queue.pending()).toBe(1);
});

test("a pressed tile rises into its wave instead of jumping to full height", async () => {
  const { scope, clock, queue, shades } = await game();
  scope.run(press, { input: { x: 1, y: 1 } });
  queue.pump();
  expect(shades()[4]!.z).toBe(0);

  clock.advance(40);
  queue.pump();
  const rising = shades()[4]!.z;

  clock.advance(50);
  queue.pump();
  expect(rising).toBeGreaterThan(0);
  expect(shades()[4]!.z).toBeGreaterThan(rising);
});

test("a slow wave settles before its life ends, and expires after it", async () => {
  const { scope, clock, queue, shades, count } = await game();
  scope.run(tune, { input: { speed: 1 } });
  scope.run(press, { input: { x: 1, y: 1 } });
  clock.advance(2350);
  queue.pump();

  const crest = shades()[1]!.z;
  clock.advance(200);
  queue.pump();
  expect(crest).toBeGreaterThan(0);
  expect(shades()[1]!.z).toBeLessThan(crest / 2);
  expect(count()).toBe(1);

  clock.advance(100);
  queue.pump();
  expect(count()).toBe(0);
});

test("a tile whose look did not change keeps its object", async () => {
  const { scope, clock, queue, shades } = await game();
  queue.pump();
  const calm = shades();
  scope.run(press, { input: { x: 0, y: 0 } });
  clock.advance(20);
  queue.pump();

  expect(shades()).not.toBe(calm);
  expect(shades()[8]).toBe(calm[8]);
  expect(shades()[0]).not.toBe(calm[0]);
});

test("height doubles the lift on the next frame", async () => {
  const { scope, clock, queue, shades } = await game();
  scope.run(press, { input: { x: 1, y: 1 } });
  clock.advance(300);
  queue.pump();
  const lifted = shades()[4]!.i;
  expect(lifted).toBeGreaterThan(0);

  scope.run(tune, { input: { height: 2 } });
  queue.pump();
  expect(shades()[4]!.z).toBe(lifted * 2);
});

test("the storm presses a tile every gap, and a longer gap delays the next", async () => {
  const { scope, clock, queue, count } = await game();
  scope.run(setStorm, { input: true });
  clock.advance(400);
  queue.pump();
  expect(count()).toBe(1);

  scope.run(tune, { input: { gap: 1200 } });
  clock.advance(400);
  queue.pump();
  expect(count()).toBe(1);

  clock.advance(800);
  queue.pump();
  expect(count()).toBe(2);

  scope.run(setStorm, { input: false });
  clock.advance(1200);
  queue.pump();
  expect(count()).toBe(2);
});

test("each turn moves a quarter turn, eases both ends, and lands in 250 ms", async () => {
  const { scope, clock, queue } = await game();
  const angle = () => scope.controller(heading).get().angle;
  scope.run(turn, { input: 1 });
  clock.advance(25);
  queue.pump();
  expect(angle()).toBeGreaterThan(0);
  expect(angle()).toBeLessThan(9);

  clock.advance(200);
  queue.pump();
  expect(angle()).toBeGreaterThan(81);
  expect(angle()).toBeLessThan(90);

  clock.advance(25);
  queue.pump();
  expect(angle()).toBe(90);
  expect(scope.controller(walls).get()).toBe("s e");

  for (let q = 0; q < 5; q++) {
    scope.run(turn, { input: -1 });
    clock.advance(300);
    queue.pump();
  }
  expect(scope.controller(heading).get().to).toBe(-360);
  expect(angle()).toBe(-360);
});

test("clear empties the waves and stops the storm", async () => {
  const { scope, clock, queue, count } = await game();
  scope.run(setStorm, { input: true });
  clock.advance(400);
  queue.pump();
  expect(count()).toBe(1);

  scope.run(clear);
  clock.advance(1200);
  queue.pump();
  expect(count()).toBe(0);
  expect(scope.controller(storm).get().on).toBe(false);
});

test("closing the scope cancels the frame loop", async () => {
  const { scope, clock, queue } = await game();
  scope.run(press, { input: { x: 1, y: 1 } });
  clock.advance(300);
  queue.pump();
  expect(queue.pending()).toBe(1);

  const closed = await scope.close();
  expect(closed.teardownErrors).toBeUndefined();
  expect(queue.pending()).toBe(0);
});

test("a bad press, setting, storm switch or turn is refused at the door", async () => {
  const { scope } = await game();
  refused(() => scope.run(press, { rawInput: { x: 1 } }));
  refused(() => scope.run(tune, { rawInput: { speed: "fast" } }));
  refused(() => scope.run(setStorm, { rawInput: "on" }));
  refused(() => scope.run(turn, { rawInput: 2 }));
});

test("the walls facing the viewer follow turns past a full circle, and change at each edge", async () => {
  const { scope } = await game();
  const at = (h: number) => scope.run(facing, { input: h });
  const seen = [-45, 45, 135, 225, -405, 765].map(at);
  expect(seen).toEqual(["s w", "s e", "n e", "n w", "s w", "s e"]);

  for (const [h, before, on, after] of [
    [0, "s w", "s", "s e"],
    [90, "s e", "e", "n e"],
    [180, "n e", "n", "n w"],
    [270, "n w", "w", "s w"],
    [-90, "n w", "w", "s w"],
  ] as const) {
    expect([at(h - 0.001), at(h), at(h + 0.001)]).toEqual([before, on, after]);
  }
});
