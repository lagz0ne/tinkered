import { operation, resource } from "@tinker/core";
import { z } from "zod";

import { board, cols, frames, heading, idle, physics, rows, storm, walls, waves } from "./state";
import type { Physics, Shade, Wave } from "./state";

// The ocean's moves. Each is an operation: its input parsed at the door, its cells declared, its
// time and chance from the scope (`clock`, `random`), so a test drives every one by hand.

/** A tile press: tile coordinates, not pixels. A wave starts there. Returns the hue it dealt. */
export const press = operation({
  label: "ocean.press",
  input: z.object({ x: z.number().finite(), y: z.number().finite() }),
  depends: { waves: waves.controller },
  run: ({ waves }, { input, clock, random }) => {
    const hue = Math.floor(random.next() * 360);
    const start = clock.currentTimeMillis();
    waves.update((list) => [...list, { id: (list.at(-1)?.id ?? 0) + 1, ...input, hue, start }]);
    return hue;
  },
});

/** Every wave goes, and the storm stops. */
export const clear = operation({
  label: "ocean.clear",
  depends: { waves: waves.controller, storm: storm.controller },
  run: ({ waves, storm }) => {
    waves.set([]);
    storm.update((s) => ({ ...s, on: false }));
  },
});

const setting = z.number().finite();

/** Changes part of the physics while the waves move: the next frame reads it. */
export const tune = operation({
  label: "ocean.tune",
  input: z
    .object({ speed: setting, ring: setting, reach: setting, life: setting, height: setting })
    .extend({ gap: setting })
    .partial(),
  depends: { physics: physics.controller },
  run: ({ physics }, { input }) => physics.update((p) => ({ ...p, ...input })),
});

/** The storm switch. */
export const setStorm = operation({
  label: "ocean.storm.set",
  input: z.boolean(),
  depends: { storm: storm.controller },
  run: ({ storm }, { input }) => storm.update((s) => ({ ...s, on: input })),
});

/** A quarter turn, clockwise (1) or back (-1). The ticker moves the board there. */
export const turn = operation({
  label: "ocean.turn",
  input: z.union([z.literal(1), z.literal(-1)]),
  depends: { heading: heading.controller },
  run: ({ heading }, { input, clock }) => {
    const h = heading.get();
    heading.set({ ...h, from: h.angle, to: h.to + input * 90, start: clock.currentTimeMillis() });
  },
});

/**
 * The walls that face the viewer at a heading. CSS turns the board on Z, then tilts it on X, so
 * south faces the viewer near 0°, east near 90°; a wall seen edge on is left out.
 */
export const facing = operation({
  label: "ocean.facing",
  input: z.number(),
  run: (_, { input }) => {
    const d = ((input % 360) + 360) % 360;
    const ns = d > 90 && d < 270 ? "n" : d < 90 || d > 270 ? "s" : "";
    const ew = d > 0 && d < 180 ? "e" : d > 180 ? "w" : "";
    return [ns, ew].filter(Boolean).join(" ");
  },
});

/** A front passing one tile: its wave, its strength 0..1, and the way it travels. */
type Hit = { w: Wave; i: number; angle: number };

/** The fronts passing a tile at `now`, strongest first. A front is strongest on its ring and fades
 * away from the press; it eases in over 90 ms and out over the last 250 ms of its life. */
export const fronts = operation({
  label: "ocean.fronts",
  input: (raw) => raw as { x: number; y: number; list: Wave[]; now: number; p: Physics },
  run: (_, { input: { x, y, list, now, p } }): Hit[] => {
    const hits: Hit[] = [];
    for (const w of list) {
      const age = now - w.start;
      const d = Math.hypot(x - w.x, y - w.y);
      const front = Math.exp(-(((d - (age / 1000) * p.speed) / p.ring) ** 2));

      const a = Math.min(1, Math.max(0, age / 90));
      const b = Math.min(1, Math.max(0, (p.life - age) / 250));
      const i = front * Math.max(0, 1 - d / p.reach) * a * a * (3 - 2 * a) * b * b * (3 - 2 * b);
      if (i > 0.04) hits.push({ w, i, angle: Math.atan2(y - w.y, x - w.x) });
    }
    return hits.sort((m, n) => n.i - m.i);
  },
});

/**
 * One tile's look at `now`. Where two fronts meet, their hues blend (a mean on the colour wheel,
 * by strength) and the shade deepens, so the meeting has its own colour.
 */
export const shadeAt = operation({
  label: "ocean.shade",
  input: (raw) => raw as { x: number; y: number; list: Wave[]; now: number; p: Physics },
  depends: { fronts: fronts.controller },
  run: ({ fronts }, { input }): Shade => {
    const hits = fronts.run({ input });
    const [top, second] = hits;
    if (!top) return idle;

    const meet = !!second && second.i > top.i * 0.3;
    let sx = 0;
    let sy = 0;
    for (const { w, i } of hits) {
      sx += Math.cos((w.hue * Math.PI) / 180) * i;
      sy += Math.sin((w.hue * Math.PI) / 180) * i;
    }

    const blend = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
    const look = {
      h: Math.round(meet ? blend : top.w.hue),
      s: meet ? 80 : 62,
      l: Math.round(meet ? 64 - 16 * top.i : 90 - 32 * top.i),
      a: Math.round((top.angle * 180) / Math.PI / 10) * 10,
      i: Math.round(top.i * 20) / 20,
      z: Math.round(top.i * input.p.height * 100) / 100,
      c: meet,
    };
    return { key: Object.values(look).join(), ...look };
  },
});

/** Drops the waves that outlived `life`. */
export const expire = operation({
  label: "ocean.expire",
  input: z.number(),
  depends: { waves: waves.controller, physics: physics.controller },
  run: ({ waves, physics }, { input: now }) => {
    const all = waves.get();
    const live = all.filter((w) => now - w.start < physics.get().life);
    if (live.length !== all.length) waves.set(live);
  },
});

/** While the storm is on, presses a random tile each `gap` ms. */
export const blow = operation({
  label: "ocean.blow",
  input: z.number(),
  depends: {
    storm: storm.controller,
    physics: physics.controller,
    press: press.controller,
    cols: cols.required,
    rows: rows.required,
  },
  run: ({ storm, physics, press, cols, rows }, { input: now, random }) => {
    const s = storm.get();
    if (!s.on || now - s.last < physics.get().gap) return;

    storm.set({ on: true, last: now });
    const x = Math.floor(random.next() * cols);
    press.run({ input: { x, y: Math.floor(random.next() * rows) } });
  },
});

/** Repaints the board. A tile whose look did not change keeps its object, so it does not render. */
export const paint = operation({
  label: "ocean.paint",
  input: z.number(),
  depends: {
    waves: waves.controller,
    physics: physics.controller,
    board: board.controller,
    shade: shadeAt.controller,
    cols: cols.required,
    rows: rows.required,
  },
  run: ({ waves, physics, board, shade, cols, rows }, { input: now }) => {
    const list = waves.get();
    const p = physics.get();
    const prev = board.get();
    const next: Shade[] = [];
    for (let k = 0; k < cols * rows; k++) {
      const look = shade.run({ input: { x: k % cols, y: Math.floor(k / cols), list, now, p } });
      const old = prev[k];
      next.push(old?.key === look.key ? old : look);
    }

    if (next.some((s, k) => s !== prev[k]) || next.length !== prev.length) board.set(next);
  },
});

/** Eases the board toward its heading's target in 250 ms of scope time, and names its walls. */
export const rotate = operation({
  label: "ocean.rotate",
  input: z.number(),
  depends: { heading: heading.controller, walls: walls.controller, facing: facing.controller },
  run: ({ heading, walls, facing }, { input: now }) => {
    const h = heading.get();
    if (h.angle === h.to) return;

    const t = Math.min(1, Math.max(0, (now - h.start) / 250));
    const angle = h.from + (h.to - h.from) * t * t * (3 - 2 * t);
    heading.set({ ...h, angle });
    walls.set(facing.run({ input: -45 + angle }));
  },
});

/** One frame: expire, blow, paint, rotate, all at one `now`. */
export const step = operation({
  label: "ocean.step",
  depends: {
    expire: expire.controller,
    blow: blow.controller,
    paint: paint.controller,
    rotate: rotate.controller,
  },
  run: ({ expire, blow, paint, rotate }, { clock }) => {
    const now = clock.currentTimeMillis();
    expire.run({ input: now });
    blow.run({ input: now });
    paint.run({ input: now });
    rotate.run({ input: now });
  },
});

/** The frame loop: one step a frame, until the scope closes. Its value is the board's size. */
export const ticker = resource({
  label: "ocean.ticker",
  depends: {
    frames: frames.required,
    step: step.controller,
    cols: cols.required,
    rows: rows.required,
  },
  factory: ({ frames, step, cols, rows }, { defer }) => {
    let id = 0;
    const frame = () => {
      step.run();
      id = frames.requestAnimationFrame(frame);
    };

    id = frames.requestAnimationFrame(frame);
    defer(() => frames.cancelAnimationFrame(id));
    return { cols, rows };
  },
});
