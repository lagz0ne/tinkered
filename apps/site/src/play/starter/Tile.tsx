import { useData, useRun } from "@tinker/react";
import { memo } from "react";
import type { ReactElement } from "react";

import { press } from "./engine";
import { board, idle } from "./state";

/** Pixels of slab every tile keeps above the sea floor, and pixels per unit of wave height (`z`). */
const SLAB = 10;
const PER_UNIT = 34;

/** Each wall: how it folds down from the top, and how dark it is against the top. */
const faces = {
  n: { fold: "rotateX(90deg) scaleY", dark: 0.4 },
  s: { fold: "rotateX(-90deg) scaleY", dark: 0.52 },
  w: { fold: "rotateY(-90deg) scaleX", dark: 0.4 },
  e: { fold: "rotateY(90deg) scaleX", dark: 0.52 },
} as const;

/** The arrow shows with the front, in the top's complement, its lightness mirrored. */
function Arrow({ i, a, hue, lit }: { i: number; a: number; hue: number; lit: number }) {
  const on = i > 0.1;
  const stroke = `hsl(${(hue + 180) % 360} 72% ${Math.max(14, Math.min(44, 100 - lit))}%)`;
  return (
    <span
      className="arrow"
      style={{ transform: on ? `rotate(${a}deg)` : "none", opacity: on ? Math.min(1, i * 1.6) : 0 }}
    >
      <svg viewBox="0 0 24 24">
        <path d="M4 12h16m-7-7 7 7-7 7" stroke={on ? stroke : "transparent"} />
      </svg>
    </span>
  );
}

/** A tile subscribes to ITS slice of the board — the selector picks it, and the engine keeps an unchanged
 * look's object — so a frame that repaints twenty tiles re-renders twenty tiles. Pressing runs
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
  const shade = useData(board, (b) => b[k] ?? idle);
  const run = useRun(press);

  // The water: the wave's hue while a front passes, else a deep checker, so calm is not flat.
  const calm = shade.i === 0 && shade.z === 0;
  const hue = calm ? 184 : shade.h;
  const sat = calm ? 32 : shade.s;
  const lit = calm ? 20 + (k % 2) * 3 : shade.l;

  // Rising crests whiten toward seafoam the higher the wave lifts.
  const base = `hsl(${hue} ${sat}% ${lit}%)`;
  const foam = calm ? 0 : Math.round(Math.min(1, shade.z / 2) * 55);
  const top = foam > 0 ? `color-mix(in srgb, ${base} ${100 - foam}%, #e9fff7)` : base;
  const h = SLAB + shade.z * PER_UNIT;

  // The button keeps the top's colour: it covers walls in the field's fade.
  return (
    <button
      type="button"
      className={shade.c ? "tile converge" : "tile"}
      style={{ transform: `translateZ(${h}px)`, background: top }}
      onClick={() => run.run({ input: { x, y } })}
      aria-label={`tile ${x},${y}`}
    >
      <span className="top" style={{ background: top }} aria-hidden="true">
        <Arrow i={shade.i} a={shade.a} hue={hue} lit={lit} />
      </span>
      {(walls.split(" ").filter(Boolean) as (keyof typeof faces)[]).map((w) => (
        <span
          key={w}
          className={`wall ${w}`}
          style={{
            transform: `${faces[w].fold}(${h})`,
            background: `hsl(${hue} ${sat}% ${Math.max(4, Math.round(lit * faces[w].dark))}%)`,
          }}
          aria-hidden="true"
        />
      ))}
    </button>
  );
});
