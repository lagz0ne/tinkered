import { operation } from "@tinker/core";
import { z } from "zod";

import { facing, press } from "./engine";
import { board, cols, cursor, hand, heading, idle, rows, screen, stale, still } from "./state";
import type { Shade } from "./state";

// The picture. The board is a field of columns seen from above at an angle (an isometric view,
// no perspective), drawn on one canvas: far columns first, so near ones cover them (the painter's
// algorithm). The same view maps a pointer back to its tile.

/** The view's tilt: acos(1 / sqrt(3)) gives the ground axes their 30-degree slopes. */
const TILT = Math.acos(1 / Math.sqrt(3));

/** The heading at rest: a corner of the board points at the viewer. */
const HEADING = -45;

/** A column's depth below calm water, and the height one unit of wave adds: in tile widths. */
const DEPTH = 0.6;
const LIFT = 0.85;

/** The four walls: the two corners each one joins (nw, ne, se, sw), and how dark it is. */
const WALLS = [
  { name: "n", a: 0, b: 1, dark: 0.8 },
  { name: "e", a: 1, b: 2, dark: 0.62 },
  { name: "s", a: 2, b: 3, dark: 0.8 },
  { name: "w", a: 3, b: 0, dark: 0.62 },
] as const;

/** Where the board's corner is on the canvas, each axis's step in pixels, and a tile's size. */
type View = { ox: number; oy: number; xx: number; xy: number; yx: number; yy: number; up: number };

/** The view of a `w` by `h` box at a turn: the whole board fits at every heading. */
export const view = operation({
  label: "ocean.view",
  input: (raw) => raw as { w: number; h: number; angle: number },
  depends: { cols: cols.required, rows: rows.required },
  run: ({ cols, rows }, { input: { w, h, angle } }): View => {
    const span = Math.hypot(cols, rows);
    const flat = Math.cos(TILT);
    const rise = Math.sin(TILT);
    const size = Math.min(w / span, h / (span * flat + 2.6 * rise)) * 0.98;
    const turn = ((HEADING + angle) * Math.PI) / 180;
    const xx = Math.cos(turn) * size;
    const xy = Math.sin(turn) * flat * size;
    const yx = -Math.sin(turn) * size;
    const yy = Math.cos(turn) * flat * size;

    const ox = w / 2 - (cols / 2) * xx - (rows / 2) * yx;
    const oy = h / 2 + 0.5 * rise * size - (cols / 2) * xy - (rows / 2) * yy;
    return { ox, oy, xx, xy, yx, yy, up: rise * size };
  },
});

/** Sizes the canvas to its box, in device pixels. Answers whether a draw is due. */
export const fit = operation({
  label: "ocean.fit",
  depends: { screen: screen.controller, stale: stale.controller },
  run: ({ screen, stale }) => {
    const el = screen.get();
    if (!el) return false;

    const ratio = el.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const w = Math.round(el.clientWidth * ratio);
    const h = Math.round(el.clientHeight * ratio);
    if (el.width === w && el.height === h) return stale.get();

    el.width = w;
    el.height = h;
    return true;
  },
});

/** One column: the walls of it that face the viewer, then its top; the cursor's tile gets a ring. */
export const column = operation({
  label: "ocean.column",
  input: (raw) =>
    raw as {
      ctx: CanvasRenderingContext2D;
      v: View;
      at: { x: number; y: number };
      shade: Shade;
      lift: number;
      seen: string;
      mark: { x: number; y: number; on: boolean };
    },
  run: (_, { input: { ctx, v, at, shade, lift, seen, mark } }) => {
    const calm = shade === idle;
    const ink = calm ? "45 6%" : `${shade.h} ${shade.s}%`;
    const lit = calm ? 90 - ((at.x + at.y) % 2) * 3 : shade.l;
    const top = shade.z * lift;

    // The tile's corners on the water: nw, ne, se, sw, with a hair's gap to its neighbours.
    const px = [at.x + 0.03, at.x + 0.97, at.x + 0.97, at.x + 0.03];
    const py = [at.y + 0.03, at.y + 0.03, at.y + 0.97, at.y + 0.97];
    const sx = px.map((p, i) => v.ox + p * v.xx + py[i]! * v.yx);
    const sy = px.map((p, i) => v.oy + p * v.xy + py[i]! * v.yy - top);
    const floor = top + DEPTH * v.up;

    for (const wall of WALLS.filter((w) => seen.includes(w.name))) {
      ctx.fillStyle = `hsl(${ink} ${lit * wall.dark}%)`;
      ctx.beginPath();
      ctx.moveTo(sx[wall.a]!, sy[wall.a]!);
      ctx.lineTo(sx[wall.b]!, sy[wall.b]!);

      ctx.lineTo(sx[wall.b]!, sy[wall.b]! + floor);
      ctx.lineTo(sx[wall.a]!, sy[wall.a]! + floor);
      ctx.fill();
    }

    ctx.fillStyle = `hsl(${ink} ${lit}%)`;
    ctx.beginPath();
    ctx.moveTo(sx[0]!, sy[0]!);
    for (const i of [1, 2, 3]) ctx.lineTo(sx[i]!, sy[i]!);

    ctx.closePath();
    ctx.fill();
    if (mark.on && mark.x === at.x && mark.y === at.y) ctx.stroke();
  },
});

/**
 * Draws the board, when the picture is out of date: every column, far ones first. Under reduced
 * motion the water stays flat and shows colour only, and a turn jumps to its end.
 */
export const draw = operation({
  label: "ocean.draw",
  depends: {
    fit: fit.controller,
    view: view.controller,
    facing: facing.controller,
    column: column.controller,
    screen: screen.controller,
    stale: stale.controller,
    board: board.controller,
    heading: heading.controller,
    cursor: cursor.controller,
    cols: cols.required,
    still,
  },
  run: ({ fit, view, facing, column, screen, stale, board, heading, cursor, cols, still }) => {
    const el = screen.get();
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !fit.run()) return;

    stale.set(false);
    const angle = still ? heading.get().to : heading.get().angle;
    const v = view.run({ input: { w: el.width, h: el.height, angle } });
    const seen = facing.run({ input: HEADING + angle });
    const lift = still ? 0 : LIFT * v.up;
    const mark = cursor.get();

    ctx.clearRect(0, 0, el.width, el.height);
    ctx.strokeStyle = "#d0261b";
    ctx.lineWidth = Math.max(2, v.up / 8);
    const far = board
      .get()
      .map((shade, k) => ({ shade, at: { x: k % cols, y: Math.floor(k / cols) } }))
      .sort((m, n) => (m.at.x - n.at.x) * v.xy + (m.at.y - n.at.y) * v.yy);

    for (const tile of far) column.run({ input: { ctx, v, lift, seen, mark, ...tile } });
  },
});

/** The page hands over its canvas, or takes it away (null). */
export const show = operation({
  label: "ocean.show",
  input: (raw) => raw as HTMLCanvasElement | null,
  depends: { screen: screen.controller, stale: stale.controller },
  run: ({ screen, stale }, { input }) => {
    screen.set(input);
    stale.set(true);
  },
});

/**
 * A pointer on the canvas, in CSS pixels: presses the tile under it on calm water, or the nearest
 * one. A drag presses each new tile it enters, at most one each 70 ms: weaker waves, all in the
 * hue of the press that began it, so a drag reads as one stroke.
 */
export const poke = operation({
  label: "ocean.poke",
  input: z.object({ px: z.number(), py: z.number(), drag: z.boolean() }),
  depends: {
    view: view.controller,
    press: press.controller,
    screen: screen.controller,
    heading: heading.controller,
    hand: hand.controller,
    cols: cols.required,
    rows: rows.required,
  },
  run: (deps, { input: { px, py, drag }, clock, random }) => {
    const { view, press, screen, heading, hand, cols, rows } = deps;
    const el = screen.get();
    if (!el) return;

    const { angle } = heading.get();
    const v = view.run({ input: { w: el.clientWidth, h: el.clientHeight, angle } });
    const det = v.xx * v.yy - v.xy * v.yx;
    const dx = px - v.ox;
    const dy = py - v.oy;
    const x = Math.max(0, Math.min(cols - 1, Math.floor((dx * v.yy - dy * v.yx) / det)));
    const y = Math.max(0, Math.min(rows - 1, Math.floor((dy * v.xx - dx * v.xy) / det)));

    const now = clock.currentTimeMillis();
    const last = hand.get();
    if (drag && ((last.x === x && last.y === y) || now - last.at < 70)) return;

    const hue = drag ? last.hue : Math.floor(random.next() * 360);
    hand.set({ x, y, at: now, hue });
    press.run({ input: { x, y, hue, power: drag ? 0.4 : 1 } });
  },
});

/** The cursor shows while the board has focus. */
export const look = operation({
  label: "ocean.look",
  input: z.boolean(),
  depends: { cursor: cursor.controller, stale: stale.controller },
  run: ({ cursor, stale }, { input }) => {
    cursor.update((c) => ({ ...c, on: input }));
    stale.set(true);
  },
});

/** A key on the board: an arrow moves the cursor, Space or Enter presses its tile. */
export const key = operation({
  label: "ocean.key",
  input: z.string(),
  depends: {
    press: press.controller,
    cursor: cursor.controller,
    stale: stale.controller,
    cols: cols.required,
    rows: rows.required,
  },
  run: ({ press, cursor, stale, cols, rows }, { input }) => {
    const c = cursor.get();
    if (input === " " || input === "Enter") press.run({ input: { x: c.x, y: c.y } });

    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const [dx, dy] = steps[input] ?? [0, 0];
    const x = Math.max(0, Math.min(cols - 1, c.x + dx));
    cursor.set({ ...c, x, y: Math.max(0, Math.min(rows - 1, c.y + dy)) });
    stale.set(true);
  },
});
