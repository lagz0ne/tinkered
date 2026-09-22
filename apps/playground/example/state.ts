import { data, tag } from "@tinker/core";

/** Grid size: ambient config read through the scope; a test binds a 3×3. */
export const grid = tag({ label: "grid", default: { cols: 12, rows: 7 } });

/** Wave physics as a DATA cell so live controls can write it mid-flight: tiles per second
 * (`speed`), the front's width (`ring`), the fade radius (`reach`), a wave's life in ms, how high
 * a front lifts a tile in z units 0..3 (`height`), and the ms between storm presses. */
export type Physics = {
  speed: number;
  ring: number;
  reach: number;
  life: number;
  height: number;
  stormRate: number;
};

export const physics = data<Physics>({
  label: "physics",
  initial: { speed: 5.5, ring: 1.4, reach: 9, life: 2600, height: 1, stormRate: 400 },
});

/** Frame scheduling port: the browser supplies rAF, a test supplies a queue by hand. The default
 * touches browser globals only when `request` is first called, so Node loads this module safely. */
export type Frames = { request(cb: () => void): number; cancel(id: number): void };

export const frames = tag<Frames>({
  label: "frames",
  default: {
    request: (cb) => globalThis.requestAnimationFrame(() => cb()),
    cancel: (id) => globalThis.cancelAnimationFrame(id),
  },
});

/** Randomness port: press hues and storm targets come through this, never a bare Math.random. */
export const random = tag({ label: "random", default: Math.random });

/** A pressed tile becomes a wave: where, when, and the pastel hue it was dealt. */
export type Wave = { id: number; x: number; y: number; hue: number; start: number };

/** Every wave still travelling. A cell the scope owns; nothing at module level is mutable. */
export const waves = data({ label: "waves", initial: [] as Wave[] });

/** Whether the ticker presses a random tile on the storm cadence. */
export const stormOn = data({ label: "stormOn", initial: false });

/** The board's current rotation in degrees, and where it is heading (unbounded — every `turn`
 * adds ±90, so a board spun a hundred times needs no wrap bookkeeping). */
export const angle = data({ label: "angle", initial: 0 });
export const targetAngle = data({ label: "targetAngle", initial: 0 });

/** What one tile looks like right now: hue, saturation, lightness, the arrow's angle (the way the
 * wave is travelling), intensity 0..1 (how strongly a front is passing through), height z (front
 * intensity times `height`, 0..3 — the UI scales z to px), and whether two fronts converge here.
 * Quantized so "same look" is a cheap field compare. */
export type Shade = {
  h: number;
  s: number;
  l: number;
  a: number;
  i: number;
  z: number;
  c: boolean;
};

export const IDLE: Shade = { h: 0, s: 0, l: 96, a: 0, i: 0, z: 0, c: false };

export function sameShade(p: Shade, q: Shade): boolean {
  return (
    p.h === q.h &&
    p.s === q.s &&
    p.l === q.l &&
    p.a === q.a &&
    p.i === q.i &&
    p.z === q.z &&
    p.c === q.c
  );
}

/** The board: one Shade per tile, row-major. ONE cell, written at most once per frame; every tile
 * reads its own slice through a selector, so only tiles whose look changed re-render. */
export const board = data({ label: "board", initial: [] as Shade[] });
