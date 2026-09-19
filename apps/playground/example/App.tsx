import { useData, useResource, useRun } from "@tinker/react";
import type { ReactElement } from "react";
import { clear, ticker } from "./engine";
import { waves } from "./state";
import { Tile } from "./Tile";

/** Re-renders only when the COUNT of waves changes, and offers `clear` — an operation. */
function Live(): ReactElement {
  const n = useData(waves, (list) => list.length);
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

/** Building the `ticker` resource is what starts the engine; its value is the grid size. */
function Board(): ReactElement {
  const { cols, rows } = useResource(ticker);
  const tiles: ReactElement[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      tiles.push(<Tile key={y * cols + x} x={x} y={y} k={y * cols + x} />);
    }
  }
  return (
    <div className="board" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {tiles}
    </div>
  );
}

export function App(): ReactElement {
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

const css = `
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
`;
