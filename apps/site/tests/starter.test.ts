import { createScope, isError } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";

import { key, look, poke, show, view } from "@/play/starter/draw";
import { clear, facing, land, press, setStorm, tune, turn } from "@/play/starter/engine";
import { ocean } from "@/play/starter/ocean";
import { board, cursor, heading, storm, walls, waves } from "@/play/starter/state";
import type { Frames } from "@/play/starter/state";

// The starter ocean, as the play page compiles it, run here on a 3×3 board: a hand-driven frame
// queue, a test clock, and a random that always says 0.

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

test("a press sinks its tile on the first frame; then a crest moves outward", async () => {
  const { scope, clock, queue, shades } = await game();
  queue.pump();
  expect(shades()[4]!.z).toBe(0);

  expect(scope.run(press, { input: { x: 1, y: 1 } })).toBe(0);
  queue.pump();
  expect(shades()[4]!.z).toBeLessThan(0);
  expect(shades()[1]!.z).toBeLessThan(0);

  clock.advance(150);
  queue.pump();
  expect(shades()[4]!.z).toBeLessThan(0);
  expect(shades()[1]!.z).toBeGreaterThan(0.3);
  expect(queue.pending()).toBe(1);
});

test("two waves add up where they meet", async () => {
  const [one, two] = [await game(), await game()];
  one.scope.run(press, { input: { x: 0, y: 1 } });
  two.scope.run(press, { input: { x: 0, y: 1 } });
  two.scope.run(press, { input: { x: 2, y: 1 } });

  for (const g of [one, two]) {
    g.clock.advance(150);
    g.queue.pump();
  }

  const alone = one.shades()[4]!.z;
  expect(alone).toBeGreaterThan(0.3);
  expect(two.shades()[4]!.z).toBeCloseTo(alone * 2, 1);
});

test("an edge sends a wave back; with no bounce the far side stays lower", async () => {
  const [hard, soft] = [await game(), await game()];
  soft.scope.run(tune, { input: { bounce: 0 } });

  for (const g of [hard, soft]) {
    g.scope.run(press, { input: { x: 0, y: 1 } });
    g.clock.advance(330);
    g.queue.pump();
  }

  expect(soft.shades()[5]!.z).toBeGreaterThan(0);
  expect(hard.shades()[5]!.z).toBeGreaterThan(soft.shades()[5]!.z);
});

test("a wave lives its life, then goes", async () => {
  const { scope, clock, queue, shades, count } = await game();
  scope.run(press, { input: { x: 1, y: 1 } });
  clock.advance(3500);
  queue.pump();
  expect(count()).toBe(1);

  clock.advance(200);
  queue.pump();
  expect(count()).toBe(0);
  expect(shades().every((s) => s.z === 0)).toBe(true);
});

test("a wave that lands late starts at its age; one past its life does not land", async () => {
  const { scope } = await game();

  scope.run(land, { input: { x: 1, y: 1, hue: 7, age: 1000 } });
  scope.run(land, { input: { x: 2, y: 2, hue: 7, age: 3600 } });

  expect(scope.controller(waves).get()).toMatchObject([{ x: 1, y: 1, start: 0 }]);
  await scope.close();
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
  clock.advance(150);
  queue.pump();
  const lifted = shades()[1]!.z;
  expect(lifted).toBeGreaterThan(0.3);

  scope.run(tune, { input: { height: 2 } });
  queue.pump();
  expect(shades()[1]!.z).toBeCloseTo(lifted * 2, 1);
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

/** A canvas that only records: its box, and each call that clears or fills it. */
const paper = () => {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (..._args: unknown[]) =>
          void calls.push(String(name)),
    },
  );
  const el = { clientWidth: 400, clientHeight: 300, width: 0, height: 0, getContext: () => ctx };
  return { el: Object.assign(el, { ownerDocument: {} }) as unknown as HTMLCanvasElement, calls };
};

/** Where a tile's centre is on the 400 by 300 canvas, at a turn. */
const spotOf = (scope: Awaited<ReturnType<typeof game>>["scope"], x: number, y: number) => {
  const v = scope.run(view, {
    input: { w: 400, h: 300, angle: scope.controller(heading).get().angle },
  });
  return {
    px: v.ox + (x + 0.5) * v.xx + (y + 0.5) * v.yx,
    py: v.oy + (x + 0.5) * v.xy + (y + 0.5) * v.yy,
  };
};

test("a pointer presses the tile under it, at every turn", async () => {
  const { scope, clock, queue } = await game();
  const waveAt = () => scope.controller(waves).get().at(-1);
  scope.run(show, { input: paper().el });

  scope.run(poke, { input: { ...spotOf(scope, 2, 0), drag: false } });
  expect(waveAt()).toMatchObject({ x: 2, y: 0 });

  scope.run(turn, { input: 1 });
  clock.advance(300);
  queue.pump();
  scope.run(poke, { input: { ...spotOf(scope, 0, 1), drag: false } });
  expect(waveAt()).toMatchObject({ x: 0, y: 1 });

  scope.run(poke, { input: { px: -500, py: -500, drag: false } });
  expect(scope.controller(waves).get()).toHaveLength(3);
});

test("a drag presses each new tile it enters, at most one each 70 ms, with weaker waves", async () => {
  const { scope, clock, count } = await game();
  scope.run(show, { input: paper().el });
  scope.run(poke, { input: { ...spotOf(scope, 0, 0), drag: false } });

  scope.run(poke, { input: { ...spotOf(scope, 0, 0), drag: true } });
  scope.run(poke, { input: { ...spotOf(scope, 1, 0), drag: true } });
  expect(count()).toBe(1);

  clock.advance(70);
  scope.run(poke, { input: { ...spotOf(scope, 1, 0), drag: true } });
  clock.advance(500);
  scope.run(poke, { input: { ...spotOf(scope, 1, 0), drag: true } });
  expect(count()).toBe(2);
  expect(
    scope
      .controller(waves)
      .get()
      .map((w) => w.power),
  ).toEqual([1, 0.4]);
});

test("arrow keys move the cursor inside the board; Space presses its tile", async () => {
  const { scope } = await game();
  for (const k of ["ArrowLeft", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowDown", " "]) {
    scope.run(key, { input: k });
  }

  expect(scope.controller(cursor).get()).toMatchObject({ x: 2, y: 1 });
  expect(scope.controller(waves).get()[0]).toMatchObject({ x: 2, y: 1 });

  scope.run(key, { input: "ArrowUp" });
  scope.run(key, { input: "ArrowUp" });
  scope.run(key, { input: "Enter" });
  expect(scope.controller(waves).get()[1]).toMatchObject({ x: 2, y: 0 });
});

test("a calm sea is drawn once; a wave, a turn or the cursor draws it again", async () => {
  const { scope, clock, queue } = await game();
  const { el, calls } = paper();
  const draws = () => calls.filter((c) => c === "clearRect").length;
  scope.run(show, { input: el });

  queue.pump();
  queue.pump();
  expect(draws()).toBe(1);
  expect(calls.filter((c) => c === "fill")).toHaveLength(9 * 3);
  expect([el.width, el.height]).toEqual([400, 300]);

  scope.run(press, { input: { x: 1, y: 1 } });
  queue.pump();
  expect(draws()).toBe(2);

  scope.run(clear);
  queue.pump();
  scope.run(look, { input: true });
  queue.pump();
  expect(draws()).toBe(4);
  expect(calls.filter((c) => c === "stroke")).toHaveLength(1);

  scope.run(turn, { input: 1 });
  clock.advance(125);
  queue.pump();
  expect(draws()).toBe(5);
});

test("reduced motion keeps the water flat: the colour shows, the height does not", async () => {
  const tops: number[] = [];
  const ctx = new Proxy(
    {},
    { get: (_, name) => (_x: number, y: number) => void (name === "moveTo" && tops.push(y)) },
  );
  const el = { clientWidth: 400, clientHeight: 300, width: 0, height: 0, getContext: () => ctx };
  const queue = frameQueue();
  const scope = await createScope({
    clock: makeTestClock({ now: 1000 }),
    random: { next: () => 0, uuid: () => "0" },
    capsules: [ocean({ cols: 3, rows: 3, frames: queue.frames, still: true })],
  }).ready;
  scope.run(show, {
    input: Object.assign(el, { ownerDocument: {} }) as unknown as HTMLCanvasElement,
  });

  queue.pump();
  const calm = [...tops];
  tops.length = 0;
  scope.run(press, { input: { x: 1, y: 1 } });
  queue.pump();

  expect(scope.controller(board).get()[4]!.z).toBeLessThan(0);
  expect(tops).toEqual(calm);
  await scope.close();
});
