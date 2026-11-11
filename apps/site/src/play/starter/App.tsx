import { useData, useResource, useRun } from "@tinker/react";
import { memo } from "react";
import type { CSSProperties, ReactElement } from "react";

import { clear, setStorm, ticker, tune, turn } from "./engine";
import { heading, physics, storm, walls, waves } from "./state";
import { css } from "./style";
import { Tile } from "./Tile";

/** The heading belongs to the rotating parent so tiles and wave direction turn together. */
const HEADING = -45;

/** acos(1 / sqrt(3)) gives the ground axes their 30-degree slopes without perspective. */
const TILT = 54.7356;

function Live(): ReactElement {
  const n = useData(waves, (list) => list.length);
  const on = useData(storm, (s) => s.on);
  return (
    <div className="live" aria-label={`${on ? "Storm on" : "Storm off"}, ${n} waves travelling`}>
      <span className={on ? "weather weather-active" : "weather"}>
        <span className="status-light" aria-hidden="true" />
        {on ? "Storm on" : "Storm off"}
      </span>
      <span className="wave-count">
        <b>{String(n).padStart(2, "0")}</b> {n === 1 ? "wave" : "waves"} travelling
      </span>
    </div>
  );
}

/** This parent draws each heading; the board changes only when its wall pair changes.
 * Reduced motion uses the destination heading, keeping turns without the travel between them. */
const Rotor = memo(function Rotor({ children }: { children: ReactElement }): ReactElement {
  const h = useData(heading);
  const seen = useData(walls);
  const style: CSSProperties & { "--still-heading": string } = {
    transform: `rotateX(${TILT}deg) rotateZ(${HEADING + h.angle}deg)`,
    "--still-heading": `rotateX(${TILT}deg) rotateZ(${HEADING + h.to}deg)`,
  };
  return (
    <div className="tilt" style={style} data-walls={seen}>
      {children}
    </div>
  );
});

/** The ticker is the capsule's frame loop; its value is the board's size. The wall pair changes
 * only at a quarter turn's edges, so a turn does not redraw every tile each frame. */
const Board = memo(function Board(): ReactElement {
  const { cols, rows } = useResource(ticker);
  const seen = useData(walls);
  const tiles: ReactElement[] = [];
  for (let k = 0; k < cols * rows; k++) {
    tiles.push(<Tile key={k} x={k % cols} y={Math.floor(k / cols)} k={k} walls={seen} />);
  }
  return (
    <div className="board" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {tiles}
    </div>
  );
});

function Scene(): ReactElement {
  return (
    <section className="scene" aria-label="Interactive ocean board">
      <div className="field">
        <Rotor>
          <Board />
        </Rotor>
      </div>
      <div className="scene-caption">
        <svg className="press-mark" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10.5" />
          <path d="M8 16l8-8m-6 0h6v6" />
        </svg>
        Press any tile. Make a little chaos.
      </div>
    </section>
  );
}

/** Controls read the engine's cells and write through operations; no view state owns the sea. */
function Controls(): ReactElement {
  const p = useData(physics);
  const on = useData(storm, (s) => s.on);
  const tuning = useRun(tune);
  const flipStorm = useRun(setStorm);
  const spin = useRun(turn);
  const wipe = useRun(clear);

  return (
    <section className="panel" aria-label="Storm controls">
      <div className="control-group turn-controls">
        <h2>
          <span>01</span> Turn the sea
        </h2>
        <div className="button-pair turn-pair">
          <button
            type="button"
            className="btn turn-btn turn-left"
            aria-label="Turn left"
            onClick={() => spin.run({ input: -1 })}
          >
            <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 10a7 7 0 1 1 2 8M5 4v6h6" />
            </svg>
            <span className="button-copy">
              Left<small>−90°</small>
            </span>
          </button>
          <button
            type="button"
            className="btn turn-btn turn-right"
            aria-label="Turn right"
            onClick={() => spin.run({ input: 1 })}
          >
            <span className="button-copy">
              Right<small>+90°</small>
            </span>
            <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 10a7 7 0 1 0-2 8m2-14v6h-6" />
            </svg>
          </button>
        </div>
      </div>
      <div className="control-group weather-controls">
        <h2>
          <span>02</span> Change the weather
        </h2>
        <div className="button-pair">
          <button
            type="button"
            className={on ? "btn storm-btn storm-on" : "btn storm-btn"}
            aria-pressed={on}
            onClick={() => flipStorm.run({ input: !on })}
          >
            <svg className="button-icon storm-symbol" viewBox="0 0 24 24" aria-hidden="true">
              {on ? <path d="M9 6v12m6-12v12" /> : <path d="M13 3 5 13h6l-1 8 9-12h-6l1-6" />}
            </svg>
            <span>{on ? "Stop storm" : "Start storm"}</span>
            <span className="button-indicator" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn clear-btn"
            aria-label="Clear"
            onClick={() => wipe.run()}
          >
            <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 8h12M9 8V5h6v3M8 8l1 12h6l1-12M11 11v6m2-6v6" />
            </svg>
            <span>Clear</span>
          </button>
        </div>
      </div>
      <div className="control-group tune-controls">
        <h2>
          <span>03</span> Tune the motion
        </h2>
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
              aria-label="Wave height"
              onChange={(e) => tuning.run({ input: { height: Number(e.target.value) } })}
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
              aria-label="Wave speed"
              onChange={(e) => tuning.run({ input: { speed: Number(e.target.value) } })}
            />
          </label>
          <label className="ctl">
            <span className="lab">
              Storm gap <b>{(p.gap / 1000).toFixed(1)} s</b>
            </span>
            <input
              type="range"
              min={100}
              max={1500}
              step={50}
              value={p.gap}
              aria-label="Storm interval"
              onChange={(e) => tuning.run({ input: { gap: Number(e.target.value) } })}
            />
          </label>
        </div>
      </div>
    </section>
  );
}

export function App(): ReactElement {
  return (
    <main className="wrap">
      <style>{css}</style>
      <div className="study-line">
        <span>001 / Interactive study</span>
        <span>Small actions. Wide ripples.</span>
      </div>
      <div className="hero">
        <header className="intro">
          <p className="eyebrow">
            <svg viewBox="0 0 28 20" aria-hidden="true">
              <path d="M1 6c4-7 9 7 13 0s9 7 13 0M1 14c4-7 9 7 13 0s9 7 13 0" />
            </svg>
            An ocean in miniature
          </p>
          <h1>
            Tile
            <br />
            <em>storm.</em>
          </h1>
          <p className="sub">
            A quiet surface.
            <br /> Until you touch it.
          </p>
          <Live />
        </header>
        <Scene />
      </div>
      <Controls />
      <footer className="colophon">
        <span>Made to be played with.</span>
        <span>
          Built with <b>tinkered</b>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 12l8-8M5 4h7v7" />
          </svg>
        </span>
      </footer>
    </main>
  );
}
