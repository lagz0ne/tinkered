import { useData, useRun } from "@tinker/react";
import { memo } from "react";
import type { ReactElement } from "react";
import { press } from "./engine";
import { board, IDLE, sameShade } from "./state";

/** A tile subscribes to ITS slice of the board — the selector picks it, `sameShade` decides whether
 * the look changed — so a frame that repaints twenty tiles re-renders twenty tiles. Pressing runs the
 * `press` operation through useRun, the same op a test would call on the scope. The arrow is the
 * complement of the background: opposite hue, lightness mirrored so a pale tile gets a dark arrow and
 * a deep one a lighter arrow. */
export const Tile = memo(function Tile({
  x,
  y,
  k,
}: {
  x: number;
  y: number;
  k: number;
}): ReactElement {
  const shade = useData(board, (b) => b[k] ?? IDLE, sameShade);
  const run = useRun(press);

  const bg = `hsl(${shade.h} ${shade.s}% ${shade.l}%)`;
  const arrow = `hsl(${(shade.h + 180) % 360} 72% ${Math.max(16, Math.min(46, 100 - shade.l))}%)`;
  return (
    <button
      type="button"
      className={shade.c ? "tile converge" : "tile"}
      style={{ background: bg }}
      onPointerDown={() => run.run({ input: { x, y } })}
      aria-label={`tile ${x},${y}`}
    >
      {shade.i > 0.1 && (
        <span
          className="arrow"
          style={{
            color: arrow,
            transform: `rotate(${shade.a}deg)`,
            opacity: Math.min(1, shade.i * 1.6),
          }}
        >
          ➜
        </span>
      )}
    </button>
  );
});
