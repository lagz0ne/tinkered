import { data, tag } from "@tinkered/core";

// The ocean's state. Every value lives in a cell the scope owns; the size and the frames are the
// capsule's config, which main.tsx, the seam, passes.

/** The board's size, in tiles. */
export const cols = tag<number>({ label: "ocean.cols" });
export const rows = tag<number>({ label: "ocean.rows" });

/** Where frames come from: the browser's `window`, or a test's hand-driven queue. */
export type Frames = Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;
export const frames = tag<Frames>({ label: "ocean.frames" });

/** Reduced motion: the water stays flat and a turn jumps. The seam reads the visitor's setting. */
export const still = tag({ label: "ocean.still", default: false });

/**
 * Wave physics, live.
 * - `speed`: tiles per second the front travels.
 * - `ring`: the front's width, in tiles; a crest leads, a trough and smaller ripples follow.
 * - `reach`: the distance, in tiles, where a wave has faded out.
 * - `life`: a wave's life, in ms.
 * - `height`: how high a crest lifts a tile.
 * - `bounce`: how much of a wave the board's edges send back, 0..1.
 * - `gap`: the ms between storm presses.
 */
export type Physics = {
  speed: number;
  ring: number;
  reach: number;
  life: number;
  height: number;
  bounce: number;
  gap: number;
};

export const physics = data<Physics>({
  label: "ocean.physics",
  initial: { speed: 8, ring: 1.6, reach: 30, life: 3600, height: 1, bounce: 0.55, gap: 400 },
});

/** A pressed tile becomes a wave: where, when, the hue it was dealt, and its power, 0..1. */
export type Wave = { id: number; x: number; y: number; hue: number; power: number; start: number };
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
 * One tile's look: hue, saturation, lightness, and its height against calm water (`z`; a trough
 * is below 0). `key` names the look, so an unchanged tile keeps its object.
 */
export type Shade = { key: string; h: number; s: number; l: number; z: number };

export const idle: Shade = { key: "idle", h: 0, s: 0, l: 90, z: 0 };

/** One shade per tile, row by row; the ticker writes it at most once a frame. */
export const board = data<Shade[]>({ label: "ocean.board", initial: [] });

/** The canvas the board is drawn on; null until the page shows it. */
export const screen = data<HTMLCanvasElement | null>({ label: "ocean.screen", initial: null });

/** True when the picture is out of date: the next frame draws it. A calm sea draws nothing. */
export const stale = data({ label: "ocean.stale", initial: true });

/** The keyboard's tile, shown while the board has focus. */
export const cursor = data({ label: "ocean.cursor", initial: { x: 0, y: 0, on: false } });

/** The pointer's last press: a drag makes a wave on each new tile, not too often, in one hue. */
export const hand = data({ label: "ocean.hand", initial: { x: -1, y: -1, at: 0, hue: 0 } });
