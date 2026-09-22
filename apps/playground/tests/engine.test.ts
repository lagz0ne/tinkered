import { createScope, isError, makeTestClock } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import {
  angle,
  board,
  clear,
  frames,
  grid,
  isError as isExampleError,
  press,
  random,
  setPhysics,
  setStorm,
  stormOn,
  targetAngle,
  ticker,
  turn,
  waves,
  type ErrorCode,
  type Frames,
} from "../example/index.ts";

/** A hand-driven frame source: `request` queues a callback, `pump` runs the queued frame, and
 * `pending` counts what is still queued. Stands in for requestAnimationFrame with no DOM and no
 * global patch. */
function frameQueue(): { frames: Frames; pump: () => void; pending: () => number } {
  let next = 1;
  const due = new Map<number, () => void>();
  const frames: Frames = {
    request: (cb) => {
      due.set(next, cb);
      return next++;
    },
    cancel: (id) => due.delete(id),
  };
  const pump = () => {
    const run = [...due.values()];
    due.clear();
    for (const cb of run) cb();
  };
  return { frames, pump, pending: () => due.size };
}

const START = 1000;

/** A scope running a 3×3 board with hand-driven frames, a virtual clock, and fixed randomness. */
function game() {
  const queue = frameQueue();
  const clock = makeTestClock({ now: START });
  const scope = createScope({
    clock,
    tags: [grid({ cols: 3, rows: 3 }), frames(queue.frames), random(() => 0)],
  });
  const size = scope.resolve(ticker);
  const shades = () => scope.controller(board).get();
  return { scope, clock, queue, size, shades };
}

/** Run a call that must be refused, and check the registry code it was refused with. */
function refused(code: ErrorCode, call: () => unknown): void {
  try {
    call();
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "DataValidationFailed")) throw error;
    if (!isExampleError(error.payload.cause, code)) throw error.payload.cause;
  }
}

test("a press lifts the tile it hits, and the lift moves outward", () => {
  const { scope, clock, queue, size, shades } = game();
  expect(size).toEqual({ cols: 3, rows: 3 });
  queue.pump();
  expect(shades()[4].z).toBe(0);

  const hue = scope.run(press, { input: { x: 1, y: 1 } });
  expect(hue).toBe(0);
  clock.advance(300);
  queue.pump();
  expect(shades()[4].z).toBeGreaterThan(0);
  expect(shades()[1].z).toBeGreaterThan(0);

  clock.advance(300);
  queue.pump();
  expect(shades()[4].z).toBe(0);
  expect(shades()[1].z).toBeGreaterThan(0);
  expect(queue.pending()).toBe(1);
});

test("a pressed tile rises into its wave instead of jumping to full height", () => {
  const { scope, clock, queue, shades } = game();
  scope.run(press, { input: { x: 1, y: 1 } });
  queue.pump();
  expect(shades()[4].z).toBe(0);
  clock.advance(40);
  queue.pump();
  const rising = shades()[4].z;
  clock.advance(50);
  queue.pump();
  expect(rising).toBeGreaterThan(0);
  expect(shades()[4].z).toBeGreaterThan(rising);
});

test("a slow wave settles before its lifetime ends", () => {
  const { scope, clock, queue, shades } = game();
  scope.run(setPhysics, { input: { speed: 1 } });
  scope.run(press, { input: { x: 1, y: 1 } });
  clock.advance(2350);
  queue.pump();
  const crest = shades()[1].z;
  clock.advance(200);
  queue.pump();
  expect(crest).toBeGreaterThan(0);
  expect(shades()[1].z).toBeLessThan(crest / 2);
  expect(scope.resolve(waves)).toHaveLength(1);
});

test("a wave expires after its life", () => {
  const { scope, clock, queue } = game();
  scope.run(press, { input: { x: 1, y: 1 } });
  clock.advance(1000);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(1);
  clock.advance(2000);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(0);
});

test("setting physics.height doubles the lift on the next frame", () => {
  const { scope, clock, queue, shades } = game();
  scope.run(press, { input: { x: 1, y: 1 } });
  clock.advance(300);
  queue.pump();
  const lifted = shades()[4].i;
  expect(lifted).toBeGreaterThan(0);

  scope.run(setPhysics, { input: { height: 2 } });
  queue.pump();
  expect(shades()[4].z).toBe(lifted * 2);
});

test("the storm presses a tile every stormRate, and setStorm false stops it", () => {
  const { scope, clock, queue } = game();
  scope.run(setStorm, { input: true });
  clock.advance(400);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(1);

  clock.advance(400);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(2);

  scope.run(setStorm, { input: false });
  clock.advance(1200);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(2);
});

test("raising stormRate mid-flight delays the next storm press", () => {
  const { scope, clock, queue } = game();
  scope.run(setStorm, { input: true });
  clock.advance(400);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(1);

  scope.run(setPhysics, { input: { stormRate: 1200 } });
  clock.advance(400);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(1);

  clock.advance(800);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(2);
});

test("each turn rotates the board a quarter turn and lands on its target", () => {
  const { scope, clock, queue } = game();
  queue.pump();
  for (let quarter = 0; quarter < 5; quarter++) {
    scope.run(turn, { input: -1 });
    clock.advance(100);
    queue.pump();
    const target = scope.resolve(targetAngle);
    const heading = scope.resolve(angle);
    expect(heading).toBeLessThan(0);
    expect(heading).toBeGreaterThan(target);

    clock.advance(1000);
    queue.pump();
    expect(scope.resolve(angle)).toBe(target);
  }
  expect(scope.resolve(targetAngle)).toBe(-450);
});

test("a turn eases at both ends and finishes in 250 milliseconds", () => {
  const { scope, clock, queue } = game();
  scope.run(turn, { input: 1 });
  clock.advance(25);
  queue.pump();
  expect(scope.resolve(angle)).toBeGreaterThan(0);
  expect(scope.resolve(angle)).toBeLessThan(9);
  clock.advance(200);
  queue.pump();
  expect(scope.resolve(angle)).toBeGreaterThan(81);
  expect(scope.resolve(angle)).toBeLessThan(90);
  clock.advance(25);
  queue.pump();
  expect(scope.resolve(angle)).toBe(90);
});

test("clear empties the waves and stops the storm", () => {
  const { scope, clock, queue } = game();
  scope.run(setStorm, { input: true });
  clock.advance(400);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(1);

  scope.run(clear);
  expect(scope.resolve(waves)).toHaveLength(0);
  clock.advance(1200);
  queue.pump();
  expect(scope.resolve(waves)).toHaveLength(0);
  expect(scope.resolve(stormOn)).toBe(false);
});

test("closing the scope cancels the frame loop and stops the writes", async () => {
  const { scope, clock, queue } = game();
  const painted = scope.controller(board);
  scope.run(press, { input: { x: 1, y: 1 } });
  clock.advance(300);
  queue.pump();
  expect(painted.get()[4].z).toBeGreaterThan(0);
  expect(queue.pending()).toBe(1);

  const closed = await scope.close();
  expect(closed.teardownErrors).toBeUndefined();
  expect(queue.pending()).toBe(0);

  const after = painted.get();
  queue.pump();
  expect(painted.get()).toBe(after);
});

test("a press without two numbers is refused with BadPress", () => {
  const { scope } = game();
  refused("BadPress", () => scope.run(press, { rawInput: { x: 1 } }));
});

test("a physics setting without a number is refused with BadPhysics", () => {
  const { scope } = game();
  refused("BadPhysics", () => scope.run(setPhysics, { rawInput: { speed: "fast" } }));
});

test("a storm switch without a boolean is refused with BadStorm", () => {
  const { scope } = game();
  refused("BadStorm", () => scope.run(setStorm, { rawInput: "on" }));
});

test("a turn without -1 or 1 is refused with BadTurn", () => {
  const { scope } = game();
  refused("BadTurn", () => scope.run(turn, { rawInput: 90 }));
});
