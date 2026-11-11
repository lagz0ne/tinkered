import { operation } from "@tinker/core";
import { z } from "zod";

import { board, cols, heading, idle, physics, rows, stale, storm, walls, waves } from "./state";
import type { Physics, Shade, Wave } from "./state";

// The ocean's moves and its water. Each is an operation: its input parsed at the door, its cells
// declared, its time and chance from the scope (`clock`, `random`), so a test drives every one by
// hand. draw.ts puts the board on the canvas; loop.ts runs one step a frame.

const spot = z.object({ x: z.number().finite(), y: z.number().finite() });

/** A wave's power: a press is 1, the default; a drag leaves weaker ones. */
const power = z.number().min(0).max(1).optional();

/** A wave starts here and now, in the hue it was dealt. A press lands one; so can a server. */
export const land = operation({
  label: "ocean.land",
  input: spot.extend({ hue: z.number().finite(), power }),
  depends: { waves: waves.controller },
  run: ({ waves }, { input, clock }) => {
    const start = clock.currentTimeMillis();
    const wave = { ...input, power: input.power ?? 1, start };
    waves.update((list) => [...list, { ...wave, id: (list.at(-1)?.id ?? 0) + 1 }]);
  },
});

/**
 * A tile press: tile coordinates, not pixels. It lands a wave, in the hue given or one it deals.
 * Returns the hue.
 */
export const press = operation({
  label: "ocean.press",
  input: spot.extend({ hue: z.number().finite().optional(), power }),
  depends: { land: land.controller },
  run: ({ land }, { input, random }) => {
    const hue = input.hue ?? Math.floor(random.next() * 360);
    land.run({ input: { ...input, hue } });
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
    .extend({ bounce: setting, gap: setting })
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
 * The walls that face the viewer at a heading. The view turns the board on Z, then tilts it on X,
 * so south faces the viewer near 0°, east near 90°; a wall seen edge on is left out.
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

/** A point a wave spreads from: the press itself (`core`), or its mirror image behind an edge. */
type Source = { x: number; y: number; hue: number; start: number; gain: number; core: boolean };

/**
 * Where each wave spreads from. An edge sends a wave back as if a second press sat behind it at
 * the mirror point (the method of images), so each wave has four weaker twins.
 */
export const sources = operation({
  label: "ocean.sources",
  input: (raw) => raw as { list: Wave[]; bounce: number; cols: number; rows: number },
  run: (_, { input: { list, bounce, cols, rows } }): Source[] =>
    list.flatMap((w) => {
      const own = { x: w.x, y: w.y, hue: w.hue, start: w.start, gain: w.power, core: true };
      if (bounce <= 0) return [own];

      const twin = { ...own, gain: bounce * w.power, core: false };
      return [
        own,
        { ...twin, x: -1 - w.x },
        { ...twin, x: 2 * cols - 1 - w.x },
        { ...twin, y: -1 - w.y },
        { ...twin, y: 2 * rows - 1 - w.y },
      ];
    }),
});

/** The water at one frame, per tile: height, colour strength, and the hue as a wheel vector. */
type Field = { h: number[]; e: number[]; cx: number[]; cy: number[] };

/**
 * The water's height at `now`: every source's lift, added up, so waves pass through each other
 * and their crests and troughs meet (superposition).
 * - The front is a crest on the ring; a trough and smaller ripples follow it.
 * - A circular wave thins as it spreads: its height falls with the square root of the distance.
 * - The plunge: the pressed tile sinks on the first frame, then the crest throws it up.
 */
export const swell = operation({
  label: "ocean.swell",
  input: (raw) => raw as { from: Source[]; now: number; p: Physics; cols: number; rows: number },
  run: (_, { input: { from, now, p, cols, rows } }): Field => {
    const zero = Array<number>(cols * rows).fill(0);
    const f: Field = { h: [...zero], e: [...zero], cx: [...zero], cy: [...zero] };
    for (const s of from) {
      const age = now - s.start;
      const a = Math.min(1, Math.max(0, age / 160));
      const b = Math.min(1, Math.max(0, (p.life - age) / 400));
      const gain = s.gain * a * a * (3 - 2 * a) * b * b * (3 - 2 * b);
      const sink = s.core ? 0.9 * s.gain * b * Math.exp(-age / 140) : 0;
      const turn = (s.hue * Math.PI) / 180;

      for (let k = 0; k < cols * rows; k++) {
        const d = Math.hypot((k % cols) - s.x, Math.floor(k / cols) - s.y);
        const u = d - (age / 1000) * p.speed;
        const ring = Math.exp(-((u / (p.ring * (u > 0 ? 0.6 : 1.8))) ** 2));
        const amp = ((gain * Math.max(0, 1 - d / p.reach)) / Math.sqrt(1 + d / 6)) * ring;
        const dip = sink * Math.exp(-(d * d) / 0.8);
        const tint = amp + dip;
        if (tint < 0.004) continue;

        f.h[k]! += amp * Math.cos((Math.PI * u) / (p.ring * 1.1)) - dip;
        f.e[k]! += tint;
        f.cx[k]! += Math.cos(turn) * tint;
        f.cy[k]! += Math.sin(turn) * tint;
      }
    }
    return f;
  },
});

/**
 * Each tile's look from the water. A crest or a trough takes the wave's colour; water near its
 * rest level stays pale, so rings stay clear when many waves cross. The light comes low from one side: a slope that faces it
 * shines and one that faces away darkens, so a wave reads as a surface, not as steps. Where
 * waves of two hues meet, the hue is their mean on the colour wheel, by strength.
 */
export const light = operation({
  label: "ocean.light",
  input: (raw) => raw as { f: Field; height: number; cols: number },
  run: (_, { input: { f, height, cols } }): Shade[] =>
    f.h.map((h, k) => {
      const e = Math.min(1, Math.abs(h) * 1.5 + Math.min(1, f.e[k]!) * 0.35);
      if (e < 0.04) return idle;

      const x = k % cols;
      const across = f.h[x < cols - 1 ? k + 1 : k]! - f.h[x > 0 ? k - 1 : k]!;
      const down = (f.h[k + cols] ?? h) - (f.h[k - cols] ?? h);
      const shine = Math.max(-1, Math.min(1, (across + down) * 0.9));
      const look = {
        h: Math.round(((Math.atan2(f.cy[k]!, f.cx[k]!) * 180) / Math.PI + 360) % 360),
        s: Math.round(10 + 80 * e),
        l: Math.round(Math.max(16, Math.min(96, 88 - 36 * e + 18 * shine))),
        z: Math.round(Math.max(-0.6, Math.min(3.4, h * height)) * 100) / 100,
      };
      return { key: Object.values(look).join(), ...look };
    }),
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
    stale: stale.controller,
    sources: sources.controller,
    swell: swell.controller,
    light: light.controller,
    cols: cols.required,
    rows: rows.required,
  },
  run: ({ waves, physics, board, stale, sources, swell, light, cols, rows }, { input: now }) => {
    const p = physics.get();
    const from = sources.run({ input: { list: waves.get(), bounce: p.bounce, cols, rows } });
    const f = swell.run({ input: { from, now, p, cols, rows } });
    const prev = board.get();
    const next = light
      .run({ input: { f, height: p.height, cols } })
      .map((s, k) => (prev[k]?.key === s.key ? prev[k]! : s));

    if (next.length === prev.length && next.every((s, k) => s === prev[k])) return;

    board.set(next);
    stale.set(true);
  },
});

/** Eases the board toward its heading's target in 250 ms of scope time, and names its walls. */
export const rotate = operation({
  label: "ocean.rotate",
  input: z.number(),
  depends: {
    heading: heading.controller,
    walls: walls.controller,
    stale: stale.controller,
    facing: facing.controller,
  },
  run: ({ heading, walls, stale, facing }, { input: now }) => {
    const h = heading.get();
    if (h.angle === h.to) return;

    const t = Math.min(1, Math.max(0, (now - h.start) / 250));
    const angle = h.from + (h.to - h.from) * t * t * (3 - 2 * t);
    heading.set({ ...h, angle });
    walls.set(facing.run({ input: -45 + angle }));
    stale.set(true);
  },
});
