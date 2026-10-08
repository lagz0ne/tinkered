import { useData, useRun } from "@tinker/react";
import { memo } from "react";
import type { ReactElement } from "react";
import { press } from "./engine";
import { board, IDLE, sameShade, type Shade } from "./state";

/** Pixels of slab every tile keeps above the sea floor, and pixels per unit of wave height (`z`). */
const SLAB = 10;
const PER_UNIT = 34;

/** The water a tile paints with: the engine's hue while a wave passes, otherwise a deep-water
 * checker that varies with the tile's index so the calm sea is not one flat slab. */
function waterOf(
  shade: Shade,
  k: number,
): { calm: boolean; hue: number; sat: number; lit: number } {
  const calm = shade.i === 0 && shade.z === 0;
  return {
    calm,
    hue: calm ? 184 : shade.h,
    sat: calm ? 32 : shade.s,
    lit: calm ? (k % 2 === 0 ? 20 : 23) : shade.l,
  };
}

/** Rising crests whiten toward seafoam the higher the wave lifts. */
function topOf(water: { calm: boolean; hue: number; sat: number; lit: number }, z: number): string {
  const base = `hsl(${water.hue} ${water.sat}% ${water.lit}%)`;
  const foam = water.calm ? 0 : Math.round(Math.min(1, z / 2) * 55);
  return foam > 0 ? `color-mix(in srgb, ${base} ${100 - foam}%, #e9fff7)` : base;
}

/** The direction arrow appears with the front: the complement of the top face, lightness mirrored
 * so a pale tile gets a dark arrow and a deep one a lighter arrow. */
function arrowOf(
  shade: Shade,
  water: { hue: number; lit: number },
): { stroke: string; transform: string; opacity: number } {
  if (shade.i <= 0.1) return { stroke: "transparent", transform: "none", opacity: 0 };
  return {
    stroke: `hsl(${(water.hue + 180) % 360} 72% ${Math.max(14, Math.min(44, 100 - water.lit))}%)`,
    transform: `rotate(${shade.a}deg)`,
    opacity: Math.min(1, shade.i * 1.6),
  };
}

/** A tile subscribes to ITS slice of the board — the selector picks it, `sameShade` decides whether
 * the look changed — so a frame that repaints twenty tiles re-renders twenty tiles. Pressing runs
 * the `press` operation through useRun, on `onClick` so keyboard and native pointer share one
 * activation path. The button lifts a flat top face by the wave height;
 * the walls facing the viewer hang down to the sea floor. */
export const Tile = memo(function Tile({
  x,
  y,
  k,
  walls,
}: {
  x: number;
  y: number;
  k: number;
  walls: string;
}): ReactElement {
  const shade = useData(board, (b) => b[k] ?? IDLE, sameShade);
  const run = useRun(press);
  const water = waterOf(shade, k);
  const h = SLAB + shade.z * PER_UNIT;
  const wall = (part: number) =>
    `hsl(${water.hue} ${water.sat}% ${Math.max(4, Math.round(water.lit * part))}%)`;
  /** Keep the button's original background: it covers walls in the field's fade.
   * The flat top repeats that colour and folds the arrow into its own buffer. */
  const style = { transform: `translateZ(${h}px)`, background: topOf(water, shade.z) };
  const low = wall(0.4);
  const high = wall(0.52);
  const arrow = arrowOf(shade, water);
  return (
    <button
      type="button"
      className={shade.c ? "tile converge" : "tile"}
      style={style}
      onClick={() => run.run({ input: { x, y } })}
      aria-label={`tile ${x},${y}`}
    >
      <span className="top" style={{ background: style.background }} aria-hidden="true">
        <span className="arrow" style={{ transform: arrow.transform, opacity: arrow.opacity }}>
          <svg viewBox="0 0 24 24">
            <path d="M4 12h16m-7-7 7 7-7 7" stroke={arrow.stroke} />
          </svg>
        </span>
      </span>
      {walls.includes("n") && (
        <span
          className="wall n"
          style={{ transform: `rotateX(90deg) scaleY(${h})`, background: low }}
          aria-hidden="true"
        />
      )}
      {walls.includes("s") && (
        <span
          className="wall s"
          style={{ transform: `rotateX(-90deg) scaleY(${h})`, background: high }}
          aria-hidden="true"
        />
      )}
      {walls.includes("w") && (
        <span
          className="wall w"
          style={{ transform: `rotateY(-90deg) scaleX(${h})`, background: low }}
          aria-hidden="true"
        />
      )}
      {walls.includes("e") && (
        <span
          className="wall e"
          style={{ transform: `rotateY(90deg) scaleX(${h})`, background: high }}
          aria-hidden="true"
        />
      )}
    </button>
  );
});
