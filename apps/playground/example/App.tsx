import { useData, useResource, useRun } from "@tinker/react";
import { memo } from "react";
import type { ReactElement } from "react";
import { clear, setPhysics, setStorm, ticker, turn } from "./engine";
import { angle, physics, stormOn, waves } from "./state";
import { Tile } from "./Tile";

/** A fixed offset so the board opens on a lively isometric angle; the engine's `angle` spins it
 * from there. Applied in exactly one place — the rotating parent — so tiles and their wave
 * direction travel with the board. */
const HEADING = -32;
const TILT = 58;

/** Re-renders only when the COUNT of waves changes. */
function Live(): ReactElement {
  const n = useData(waves, (list) => list.length);
  return (
    <span className="live">
      {n} wave{n === 1 ? "" : "s"} travelling
    </span>
  );
}

/** Reads the engine's animated heading and turns the whole board. Only this component re-renders
 * per frame; `Board` arrives as a stable element so its memoized tiles never revisit. */
const Rotor = memo(function Rotor({ children }: { children: ReactElement }): ReactElement {
  const a = useData(angle);
  return (
    <div className="tilt" style={{ transform: `rotateX(${TILT}deg) rotateZ(${HEADING + a}deg)` }}>
      {children}
    </div>
  );
});

/** Building the `ticker` resource is what starts the engine; its value is the grid size. */
const Board = memo(function Board(): ReactElement {
  const { cols, rows } = useResource(ticker);
  const tiles: ReactElement[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      tiles.push(<Tile key={y * cols + x} x={x} y={y} k={y * cols + x} />);
    }
  }
  return (
    <div className="board" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      <div className="floor" aria-hidden="true" />
      {tiles}
    </div>
  );
});

/** The 3D stage: a tilted turntable over a deep-ocean backdrop. A storm dims and stirs the sky. */
function Scene(): ReactElement {
  const storm = useData(stormOn);
  return (
    <div className={storm ? "scene storm" : "scene"}>
      <Rotor>
        <Board />
      </Rotor>
    </div>
  );
}

/** Storm and board controls. Every control goes through an operation (`useRun`); slider values
 * read straight from the `physics` cell, so the engine stays the only owner of state. */
function Controls(): ReactElement {
  const p = useData(physics);
  const storm = useData(stormOn);
  const tune = useRun(setPhysics);
  const flipStorm = useRun(setStorm);
  const spin = useRun(turn);
  const wipe = useRun(clear);
  return (
    <section className="panel" aria-label="storm controls">
      <div className="row">
        <button type="button" className="btn" onClick={() => spin.run({ input: -1 })}>
          ↺ Turn left
        </button>
        <button type="button" className="btn" onClick={() => spin.run({ input: 1 })}>
          Turn right ↻
        </button>
        <button
          type="button"
          className={storm ? "btn storm-on" : "btn"}
          aria-pressed={storm}
          onClick={() => flipStorm.run({ input: !storm })}
        >
          {storm ? "Stop storm" : "Start storm"}
        </button>
        <button type="button" className="btn ghost" onClick={() => wipe.run()}>
          Clear
        </button>
      </div>
      <div className="sliders">
        <label className="ctl">
          <span className="lab">
            Wave height <b>{p.height.toFixed(1)}</b>
          </span>
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.1}
            value={p.height}
            onChange={(e) => tune.run({ input: { height: Number(e.target.value) } })}
          />
        </label>
        <label className="ctl">
          <span className="lab">
            Wave speed <b>{p.speed.toFixed(1)}</b>
          </span>
          <input
            type="range"
            min={1}
            max={12}
            step={0.1}
            value={p.speed}
            onChange={(e) => tune.run({ input: { speed: Number(e.target.value) } })}
          />
        </label>
        <label className="ctl">
          <span className="lab">
            Storm gap <b>Every {(p.stormRate / 1000).toFixed(1)} s</b>
          </span>
          <input
            type="range"
            min={100}
            max={1500}
            step={50}
            value={p.stormRate}
            aria-label="Storm interval"
            onChange={(e) => tune.run({ input: { stormRate: Number(e.target.value) } })}
          />
        </label>
      </div>
    </section>
  );
}

export function App(): ReactElement {
  return (
    <div className="wrap">
      <style>{css}</style>
      <header>
        <h1>Tile storm</h1>
        <p className="sub">
          Press a tile to raise a tsunami wave — turn the board, tune the sea, ride the storm.
        </p>
        <Live />
      </header>
      <Scene />
      <Controls />
    </div>
  );
}

const css = `
  * { box-sizing: border-box; }
  .wrap { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; padding: 18px 12px 28px;
    background: radial-gradient(140% 100% at 50% 0%, #0a2438 0%, #051525 52%, #030b16 100%); }
  h1 { margin: 0; font-size: 1.5rem; letter-spacing: -0.02em; color: #eaf7f4; }
  .sub { margin: 4px 0 2px; max-width: 60ch; text-align: center; font-size: 0.92rem; color: #8fb6cc; }
  .live { font-size: 12px; color: #5f93b3; font-variant-numeric: tabular-nums; margin-bottom: 6px; }

  .scene { position: relative; width: min(92vw, 560px); aspect-ratio: 11 / 10; display: grid; place-items: center;
    padding-top: 12px;
    perspective: 1500px; border-radius: 22px; border: 1px solid rgba(122, 196, 214, 0.16); overflow: hidden;
    background: radial-gradient(120% 95% at 50% 0%, #103152 0%, #081c31 55%, #050f1d 100%); }
  .scene.storm { background: radial-gradient(120% 95% at 50% 0%, #14324c 0%, #0a2036 55%, #061224 100%); }
  .scene.storm::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    background: linear-gradient(180deg, rgba(148, 226, 255, 0.10), transparent 42%);
    animation: squall 2.8s ease-in-out infinite; }
  @keyframes squall { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }

  .tilt { transform-style: preserve-3d; }
  .board { position: relative; display: grid; gap: 3px; width: min(72vw, 400px); transform-style: preserve-3d;
    touch-action: manipulation; }
  .floor { position: absolute; inset: -14px; transform: translateZ(-6px); border-radius: 16px;
    background: linear-gradient(160deg, #0a2a44 0%, #061a2e 60%, #04101f 100%);
    box-shadow: 0 0 60px rgba(46, 196, 220, 0.10), inset 0 0 0 1px rgba(122, 196, 214, 0.12); }

  .tile { position: relative; display: block; width: 100%; aspect-ratio: 1; border: 0; padding: 0;
    border-radius: 6px; cursor: pointer; transform-style: preserve-3d; -webkit-tap-highlight-color: transparent;
    }
  .tile:focus-visible { outline: 2px solid #67e3cd; outline-offset: 2px; }
  .tile.converge { box-shadow: 0 0 0 1px rgba(233, 255, 247, 0.5), 0 0 18px rgba(103, 227, 205, 0.45); }
  .wall { position: absolute; display: block; backface-visibility: hidden; }
  .wall.n { left: 0; width: 100%; top: -1px; height: 1px;
    transform-origin: 50% 100%; }
  .wall.s { left: 0; width: 100%; top: 100%; height: 1px;
    transform-origin: 50% 0%; }
  .wall.e { top: 0; height: 100%; left: 100%; width: 1px;
    transform-origin: 0% 50%; }
  .wall.w { top: 0; height: 100%; left: -1px; width: 1px;
    transform-origin: 100% 50%; }

  .arrow { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
    font-size: clamp(11px, 2.4vw, 18px); line-height: 1; }

  .panel { width: min(92vw, 560px); display: grid; gap: 10px; margin-top: 12px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .btn { min-height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid rgba(122, 196, 214, 0.35);
    background: rgba(13, 42, 64, 0.85); color: #dbf4f4; font: inherit; font-size: 0.9rem; font-weight: 600;
    cursor: pointer; }
  .btn:hover { background: rgba(21, 60, 89, 0.95); }
  .btn:active { transform: translateY(1px); }
  .btn.storm-on { border-color: rgba(255, 158, 116, 0.55); color: #ffd7c4; background: rgba(66, 24, 20, 0.6); }
  .btn.storm-on:hover { background: rgba(88, 32, 26, 0.7); }
  .btn:focus-visible { outline: 2px solid #67e3cd; outline-offset: 2px; }
  .btn.ghost { background: transparent; }
  .btn.ghost:hover { background: rgba(21, 60, 89, 0.5); }

  .sliders { display: grid; gap: 6px 18px; grid-template-columns: 1fr; }
  @media (min-width: 620px) { .sliders { grid-template-columns: repeat(3, 1fr); } }
  .ctl { display: grid; gap: 2px; font-size: 12.5px; color: #8fb6cc; }
  .ctl .lab { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .ctl b { color: #eaf7f4; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  .ctl input { width: 100%; height: 44px; margin: 0; accent-color: #38d9c3; cursor: pointer; }
  .ctl input:focus-visible { outline: 2px solid #67e3cd; outline-offset: 2px; }

  @media (prefers-reduced-motion: reduce) {
    .scene.storm::after { animation: none; }
  }
`;
