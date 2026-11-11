import { data, tag } from "@tinker/core";

// The ocean's state. Every value lives in a cell the scope owns; the size and the frames are the
// capsule's config, which main.tsx, the seam, passes.

/** The board's size, in tiles. */
export const cols = tag<number>({ label: "ocean.cols" });
export const rows = tag<number>({ label: "ocean.rows" });

/** Where frames come from: the browser's `window`, or a test's hand-driven queue. */
export type Frames = Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;
export const frames = tag<Frames>({ label: "ocean.frames" });

/**
 * Wave physics, live: tiles per second (`speed`), the front's width (`ring`), the fade radius
 * (`reach`), a wave's life in ms, how high a front lifts a tile (`height`), and the ms between
 * storm presses (`gap`).
 */
export type Physics = {
  speed: number;
  ring: number;
  reach: number;
  life: number;
  height: number;
  gap: number;
};

export const physics = data<Physics>({
  label: "ocean.physics",
  initial: { speed: 5.5, ring: 1.4, reach: 9, life: 2600, height: 1, gap: 400 },
});

/** A pressed tile becomes a wave: where, when, and the hue it was dealt. */
export type Wave = { id: number; x: number; y: number; hue: number; start: number };
export const waves = data<Wave[]>({ label: "ocean.waves", initial: [] });

/** The storm presses a random tile every `gap` ms while it is on; `last` is its last press. */
export const storm = data({ label: "ocean.storm", initial: { on: false, last: 0 } });

/** The board's turn, in degrees: where it is now, and the move it is in (`from`, `to`, `start`). */
export const heading = data({
  label: "ocean.heading",
  initial: { angle: 0, from: 0, to: 0, start: 0 },
});

/** The two tile walls that face the viewer at the current turn: "s w", "n e", and so on. */
export const walls = data({ label: "ocean.walls", initial: "s w" });

/**
 * One tile's look: hue, saturation, lightness, the arrow's angle, intensity 0..1, height 0..3,
 * and whether two fronts meet here. `key` names the look, so an unchanged tile keeps its object.
 */
export type Shade = {
  key: string;
  h: number;
  s: number;
  l: number;
  a: number;
  i: number;
  z: number;
  c: boolean;
};

export const idle: Shade = { key: "idle", h: 0, s: 0, l: 96, a: 0, i: 0, z: 0, c: false };

/** One shade per tile, row by row; the ticker writes it at most once a frame. */
export const board = data<Shade[]>({ label: "ocean.board", initial: [] });
