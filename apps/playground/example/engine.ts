import { operation, resource } from "@tinker/core";
import { board, grid, IDLE, physics, sameShade, waves, type Shade, type Wave } from "./state";

/** A press is an OPERATION: typed input, declared deps, runs on every call. Testable as
 * `scope.run(press, { input: { x, y } })` then reading the `waves` cell. The id is derived from the
 * list and the timestamp from the ambient clock — no counters, no globals. The parser is the door:
 * it admits the one shape a press has; anything else becomes core's DataValidationFailed. */
export const press = operation({
  label: "press",
  input: (raw) => {
    const p = raw as { x?: unknown; y?: unknown };
    if (typeof p?.x !== "number" || typeof p?.y !== "number")
      throw new Error("a press is { x, y }");
    return { x: p.x, y: p.y };
  },
  depends: { waves: waves.controller },
  run: ({ waves }, { input, clock }) => {
    const hue = Math.floor(Math.random() * 360);
    const start = clock.currentTimeMillis();
    waves.update((list) => [
      ...list,
      { id: (list.at(-1)?.id ?? 0) + 1, x: input.x, y: input.y, hue, start },
    ]);
    return hue;
  },
});

/** Clearing the board is an operation too — no input, one declared dep. From React it is
 * `useRun(clear)`; from a test it is `scope.run(clear)`. Same code path either way. */
export const clear = operation({
  label: "clear",
  depends: { waves: waves.controller },
  run: ({ waves }) => waves.set([]),
});

/** The look of one tile is a PURE function of (waves, now, physics). No hidden state: hand it a
 * fixed `now` and a wave list and you can assert colours in a test. A front is strongest right on
 * its ring and fainter the further the tile is from the press; where two fronts meet, their hues are
 * blended (circular mean, weighted by intensity) and the shade deepened so the zone reads as its own
 * colour, not either wave's. */
export function shadeAt(
  x: number,
  y: number,
  list: Wave[],
  now: number,
  p: { speed: number; ring: number; reach: number },
): Shade {
  const hits: { w: Wave; i: number; angle: number }[] = [];
  for (const w of list) {
    const d = Math.hypot(x - w.x, y - w.y);
    const r = ((now - w.start) / 1000) * p.speed;
    const front = Math.exp(-(((d - r) / p.ring) ** 2));
    const fade = Math.max(0, 1 - d / p.reach);
    const i = front * fade;
    if (i > 0.04) hits.push({ w, i, angle: Math.atan2(y - w.y, x - w.x) });
  }
  const [top, second] = hits.sort((a, b) => b.i - a.i);
  if (top === undefined) return IDLE;
  const converge = second !== undefined && second.i > top.i * 0.3;

  let h = top.w.hue;
  let s = 62;
  let l = 90 - 32 * top.i;
  if (converge) {
    let sx = 0;
    let sy = 0;
    for (const { w, i } of hits) {
      sx += Math.cos((w.hue * Math.PI) / 180) * i;
      sy += Math.sin((w.hue * Math.PI) / 180) * i;
    }
    h = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
    s = 80;
    l = 64 - 16 * top.i;
  }
  return {
    h: Math.round(h),
    s,
    l: Math.round(l),
    a: Math.round((top.angle * 180) / Math.PI / 10) * 10,
    i: Math.round(top.i * 20) / 20,
    c: converge,
  };
}

/** The engine is a RESOURCE: built once per scope, its deps declared, its cleanup a `defer` the
 * scope runs on close. Each frame it prunes dead waves, recomputes the board, and writes it ONCE —
 * and only if some tile's look changed. Idle costs nothing. */
export const ticker = resource({
  label: "ticker",
  depends: {
    grid: grid.required,
    physics: physics.required,
    waves: waves.controller,
    board: board.controller,
  },
  factory: ({ grid, physics, waves, board }, { defer, clock }) => {
    const { cols, rows } = grid;
    let frame = 0;
    const step = () => {
      const now = clock.currentTimeMillis();
      const all = waves.get();
      const live = all.filter((w) => now - w.start < physics.life);
      if (live.length !== all.length) waves.set(live);

      const prev = board.get();
      let changed = prev.length !== cols * rows;
      const next: Shade[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const shade = live.length ? shadeAt(x, y, live, now, physics) : IDLE;
          if (!changed && !sameShade(prev[next.length], shade)) changed = true;
          next.push(shade);
        }
      }
      if (changed) board.set(next);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    defer(() => cancelAnimationFrame(frame));
    return { cols, rows };
  },
});
