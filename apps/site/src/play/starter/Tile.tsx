import { useData, useRun } from "@tinker/react";
import { memo } from "react";
import type { ReactElement } from "react";

import { press } from "./engine";
import { board, idle } from "./state";

/** Pixels of slab every tile keeps above the sea floor, and pixels per unit of wave height (`z`). */
const SLAB = 10;
const PER_UNIT = 34;

/** Each wall: how it folds down from the top, and how much darker than the top it is. */
const faces = {
  n: { fold: "rotateX(90deg) scaleY", dark: 0.72 },
  s: { fold: "rotateX(-90deg) scaleY", dark: 0.82 },
  w: { fold: "rotateY(-90deg) scaleX", dark: 0.72 },
  e: { fold: "rotateY(90deg) scaleX", dark: 0.82 },
} as const;

/** The arrow shows with the front: ink on a light top, white on a dark one. */
function Arrow({ i, a, lit }: { i: number; a: number; lit: number }) {
  const on = i > 0.1;
  const stroke = lit > 60 ? "#111" : "#fff";
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

  // The water: the wave's hue while a front passes, else a paper-grey checker, so calm is not flat.
  const calm = shade.i === 0 && shade.z === 0;
  const hue = calm ? 45 : shade.h;
  const sat = calm ? 6 : shade.s;
  const lit = calm ? 90 - (k % 2) * 3 : shade.l;

  // Rising crests deepen toward ink the higher the wave lifts.
  const base = `hsl(${hue} ${sat}% ${lit}%)`;
  const ink = calm ? 0 : Math.round(Math.min(1, shade.z / 2) * 30);
  const top = ink > 0 ? `color-mix(in srgb, ${base} ${100 - ink}%, #111)` : base;
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
        <Arrow i={shade.i} a={shade.a} lit={lit} />
      </span>
      {(walls.split(" ").filter(Boolean) as (keyof typeof faces)[]).map((w) => (
        <span
          key={w}
          className={`wall ${w}`}
          style={{
            transform: `${faces[w].fold}(${h})`,
            background: `hsl(${hue} ${sat}% ${Math.max(8, Math.round(lit * faces[w].dark))}%)`,
          }}
          aria-hidden="true"
        />
      ))}
    </button>
  );
});
