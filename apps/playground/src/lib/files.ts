/** One editor tab = one file in the virtual project. */
export type PlaygroundFile = { name: string; content: string };

/** The bundler entry. The preview runs this file; other files are reached via relative imports. */
export const ENTRY = "main.tsx";

export const DEFAULT_FILES: readonly PlaygroundFile[] = [
  {
    name: "main.tsx",
    content: `import { createScope } from "@tinker/core";
import { createRoot } from "react-dom/client";
import { ScopeProvider, useResource } from "@tinker/react";
import { App } from "./App";
import { ticker } from "./engine";

// The provider OWNS the scope: it creates it here and closes it on unmount. Closing runs every
// resource's defer — the engine below stops itself — so there is nothing to clean up by hand.
function Engine() {
  useResource(ticker); // building the resource starts the wave engine
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <ScopeProvider create={() => createScope()}>
    <Engine />
  </ScopeProvider>,
);
`,
  },
  {
    name: "state.ts",
    content: `import { data, tag } from "@tinker/core";

// The whole model. Nothing here is mutable at module level: tags are ambient config a scope can
// rebind (a test binds a 3×3 grid), cells hold state that a scope owns and closes.

// Ambient config, read through the scope by whatever depends on it.
export const grid = tag({ label: "grid", default: { cols: 12, rows: 7 } });
export const physics = tag({
  label: "physics",
  default: { speed: 5.5, ring: 1.4, reach: 9, life: 2600 }, // tiles/s, front width, fade radius, ms
});

// A pressed tile becomes a wave: where, when, and the pastel hue it was dealt.
export type Wave = { id: number; x: number; y: number; hue: number; start: number };
export const waves = data({ label: "waves", initial: [] as Wave[] });

// What one tile looks like right now. Quantized so "same look" is a cheap field compare.
export type Shade = {
  h: number; // hue
  s: number; // saturation
  l: number; // lightness
  a: number; // arrow angle, degrees, the way the wave is travelling
  i: number; // intensity 0..1 — how strongly a front is passing through
  c: boolean; // convergence: two fronts meeting here
};
export const IDLE: Shade = { h: 0, s: 0, l: 96, a: 0, i: 0, c: false };

export function sameShade(p: Shade, q: Shade): boolean {
  return p.h === q.h && p.s === q.s && p.l === q.l && p.a === q.a && p.i === q.i && p.c === q.c;
}

// The board: one Shade per tile, row-major. ONE cell, written at most once per frame; every tile
// reads its own slice through a selector, so only tiles whose look changed re-render.
export const board = data({ label: "board", initial: [] as Shade[] });
`,
  },
  {
    name: "engine.ts",
    content: `import { operation, resource } from "@tinker/core";
import { board, grid, IDLE, physics, sameShade, waves, type Shade, type Wave } from "./state";

// A press is an OPERATION: typed input, declared deps, runs on every call. Testable as
// \`scope.run(press, { input: { x, y } })\` then reading the \`waves\` cell. The id is derived from the
// list, the timestamp from the ambient clock — no counters, no globals. The parser is the door:
// it admits the one shape a press has; anything else becomes core's DataValidationFailed.
export const press = operation({
  label: "press",
  input: (raw) => {
    const p = raw as { x?: unknown; y?: unknown };
    if (typeof p?.x !== "number" || typeof p?.y !== "number") throw new Error("a press is { x, y }");
    return { x: p.x, y: p.y };
  },
  depends: { waves: waves.controller },
  run: ({ waves }, { input, clock }) => {
    const hue = Math.floor(Math.random() * 360); // a fresh pastel per press
    const start = clock.currentTimeMillis();
    waves.update((list) => [
      ...list,
      { id: (list[list.length - 1]?.id ?? 0) + 1, x: input.x, y: input.y, hue, start },
    ]);
    return hue;
  },
});

// Clearing the board is an operation too — no input, one declared dep. From React it is
// \`useRun(clear)\`; from a test it is \`scope.run(clear)\`. Same code path either way.
export const clear = operation({
  label: "clear",
  depends: { waves: waves.controller },
  run: ({ waves }) => waves.set([]),
});

// The look of one tile is a PURE function of (waves, now, physics). No hidden state: hand it a
// fixed \`now\` and a wave list and you can assert colours in a test.
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
    const r = ((now - w.start) / 1000) * p.speed; // where the front is now
    const front = Math.exp(-(((d - r) / p.ring) ** 2)); // strongest right on the front
    const fade = Math.max(0, 1 - d / p.reach); // fainter the further from the press
    const i = front * fade;
    if (i > 0.04) hits.push({ w, i, angle: Math.atan2(y - w.y, x - w.x) });
  }
  if (hits.length === 0) return IDLE;
  hits.sort((a, b) => b.i - a.i);
  const top = hits[0];
  const converge = hits.length > 1 && hits[1].i > top.i * 0.3; // two fronts meeting

  let h = top.w.hue;
  let s = 62;
  let l = 90 - 32 * top.i; // pastel, deeper where the front is
  if (converge) {
    // Blend every front's hue (circular mean, weighted by intensity) and deepen the shade so the
    // meeting zone reads as its own colour, not either wave's.
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
    a: Math.round(((top.angle * 180) / Math.PI) / 10) * 10,
    i: Math.round(top.i * 20) / 20,
    c: converge,
  };
}

// The engine is a RESOURCE: built once per scope, its deps declared, its cleanup a \`defer\` that
// the scope runs on close. Each frame it prunes dead waves, recomputes the board, and writes it
// ONCE — and only if some tile's look changed. Idle costs nothing.
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
      const next: Shade[] = new Array(cols * rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const k = y * cols + x;
          const shade = live.length ? shadeAt(x, y, live, now, physics) : IDLE;
          next[k] = shade;
          if (!changed && !sameShade(prev[k], shade)) changed = true;
        }
      }
      if (changed) board.set(next);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    defer(() => cancelAnimationFrame(frame)); // scope closes → engine stops
    return { cols, rows };
  },
});
`,
  },
  {
    name: "Tile.tsx",
    content: `import { useData, useRun } from "@tinker/react";
import { memo } from "react";
import { press } from "./engine";
import { board, IDLE, sameShade } from "./state";

// A tile subscribes to ITS slice of the board — the selector picks it, \`sameShade\` decides whether
// the look changed — so a frame that repaints twenty tiles re-renders twenty tiles. Pressing runs
// the \`press\` operation through useRun, the same op a test would call on the scope.
export const Tile = memo(function Tile({ x, y, k }: { x: number; y: number; k: number }) {
  const shade = useData(board, (b) => b[k] ?? IDLE, sameShade);
  const run = useRun(press);

  const bg = "hsl(" + shade.h + " " + shade.s + "% " + shade.l + "%)";
  // The complement of the background: opposite hue, and lightness mirrored so a pale tile gets a
  // dark arrow and a deep one a lighter arrow — readable at every point of the fade.
  const arrow =
    "hsl(" + ((shade.h + 180) % 360) + " 72% " + Math.max(16, Math.min(46, 100 - shade.l)) + "%)";
  return (
    <button
      type="button"
      className={"tile" + (shade.c ? " converge" : "")}
      style={{ background: bg }}
      onPointerDown={() => run.run({ input: { x, y } })}
      aria-label={"tile " + x + "," + y}
    >
      {shade.i > 0.1 && (
        <span
          className="arrow"
          style={{
            color: arrow,
            transform: "rotate(" + shade.a + "deg)",
            opacity: Math.min(1, shade.i * 1.6),
          }}
        >
          ➜
        </span>
      )}
    </button>
  );
});
`,
  },
  {
    name: "App.tsx",
    content: `import { useData, useResource, useRun } from "@tinker/react";
import { clear, ticker } from "./engine";
import { waves } from "./state";
import { Tile } from "./Tile";

function Live() {
  const n = useData(waves, (list) => list.length); // re-renders only when the COUNT changes
  const run = useRun(clear);
  return (
    <span className="live">
      {n} wave{n === 1 ? "" : "s"} travelling
      {n > 0 && (
        <button type="button" className="clear" onClick={() => run.run()}>
          clear
        </button>
      )}
    </span>
  );
}

function Board() {
  const { cols, rows } = useResource(ticker); // the built resource: grid size from the tag
  const tiles = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) tiles.push(<Tile key={y * cols + x} x={x} y={y} k={y * cols + x} />);
  }
  return (
    <div className="board" style={{ gridTemplateColumns: "repeat(" + cols + ", 1fr)" }}>
      {tiles}
    </div>
  );
}

export function App() {
  return (
    <div className="wrap">
      <style>{css}</style>
      <header>
        <h1>Ripples</h1>
        <p className="sub">
          <b>Press a tile.</b> A wave spreads out from it, paler the further it travels; the arrows
          point the way it is going, in the complement of each tile's colour. Press several — where
          fronts meet, the tiles take a deeper, blended shade of their own.
        </p>
        <Live />
      </header>
      <Board />
    </div>
  );
}

const css = \`
  .wrap { max-width: 900px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; letter-spacing: -0.02em; }
  .sub { color: #52525b; margin: 0 0 6px; max-width: 70ch; }
  .live { display: inline-flex; align-items: center; gap: 10px; font-size: 12px; color: #a1a1aa; margin-bottom: 14px; font-variant-numeric: tabular-nums; }
  .clear { font: inherit; font-size: 11px; padding: 2px 8px; border: 1px solid #e4e4e7; border-radius: 999px; background: #fff; color: #52525b; cursor: pointer; }
  .clear:hover { background: #f4f4f5; }
  .board { display: grid; gap: 5px; touch-action: manipulation; }
  .tile { position: relative; aspect-ratio: 1; border: 0; border-radius: 9px; padding: 0; cursor: pointer;
    background: #f4f4f5; transition: background 90ms linear; display: grid; place-items: center; -webkit-tap-highlight-color: transparent; }
  .tile:active { transform: scale(0.94); }
  .tile.converge { box-shadow: inset 0 0 0 2px rgba(255,255,255,0.55), 0 0 0 1px rgba(0,0,0,0.06); }
  .arrow { font-size: 18px; line-height: 1; transition: transform 90ms linear, opacity 90ms linear; pointer-events: none; }
  @media (max-width: 520px) { .board { gap: 3px; } .tile { border-radius: 6px; } .arrow { font-size: 14px; } }
\`;
`,
  },
];
