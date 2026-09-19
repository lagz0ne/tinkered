import { data, tag } from "@tinker/core";

/** Grid size: ambient config read through the scope; a test binds a 3×3. */
export const grid = tag({ label: "grid", default: { cols: 12, rows: 7 } });

/** Wave physics: tiles per second, the front's width, the fade radius, and a wave's life in ms. */
export const physics = tag({
  label: "physics",
  default: { speed: 5.5, ring: 1.4, reach: 9, life: 2600 },
});

/** A pressed tile becomes a wave: where, when, and the pastel hue it was dealt. */
export type Wave = { id: number; x: number; y: number; hue: number; start: number };

/** Every wave still travelling. A cell the scope owns; nothing at module level is mutable. */
export const waves = data({ label: "waves", initial: [] as Wave[] });

/** What one tile looks like right now: hue, saturation, lightness, the arrow's angle (the way the
 * wave is travelling), intensity 0..1 (how strongly a front is passing through), and whether two
 * fronts are converging here. Quantized so "same look" is a cheap field compare. */
export type Shade = { h: number; s: number; l: number; a: number; i: number; c: boolean };

export const IDLE: Shade = { h: 0, s: 0, l: 96, a: 0, i: 0, c: false };

export function sameShade(p: Shade, q: Shade): boolean {
  return p.h === q.h && p.s === q.s && p.l === q.l && p.a === q.a && p.i === q.i && p.c === q.c;
}

/** The board: one Shade per tile, row-major. ONE cell, written at most once per frame; every tile
 * reads its own slice through a selector, so only tiles whose look changed re-render. */
export const board = data({ label: "board", initial: [] as Shade[] });
