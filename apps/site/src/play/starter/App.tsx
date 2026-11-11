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
    <p className="live" aria-label={`${on ? "Storm on" : "Storm off"}, ${n} waves travelling`}>
      <span className={on ? "on" : undefined}>{on ? "Storm on" : "Storm off"}</span>
      <span>
        <b>{String(n).padStart(2, "0")}</b> {n === 1 ? "wave" : "waves"}
      </span>
    </p>
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
      <p className="caption">Press any tile.</p>
    </section>
  );
}

/** One slider: a physics setting, its value, and the op that changes it. */
function Slider(props: {
  label: string;
  value: number;
  shown: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}): ReactElement {
  const { label, value, shown, onChange, ...range } = props;
  return (
    <label className="ctl">
      <span>
        {label} <b>{shown}</b>
      </span>
      <input
        type="range"
        {...range}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
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
      <div className="group">
        <h2>
          <span>01</span> Turn
        </h2>
        <div className="row">
          <button type="button" aria-label="Turn left" onClick={() => spin.run({ input: -1 })}>
            ← Left
          </button>
          <button type="button" aria-label="Turn right" onClick={() => spin.run({ input: 1 })}>
            Right →
          </button>
        </div>
      </div>
      <div className="group">
        <h2>
          <span>02</span> Weather
        </h2>
        <div className="row">
          <button
            type="button"
            className="main"
            aria-pressed={on}
            onClick={() => flipStorm.run({ input: !on })}
          >
            {on ? "Stop storm" : "Start storm"}
          </button>
          <button type="button" onClick={() => wipe.run()}>
            Clear
          </button>
        </div>
      </div>
      <div className="group wide">
        <h2>
          <span>03</span> Motion
        </h2>
        <div className="sliders">
          <Slider
            label="Wave height"
            shown={p.height.toFixed(1)}
            value={p.height}
            min={0.2}
            max={3}
            step={0.1}
            onChange={(height) => tuning.run({ input: { height } })}
          />
          <Slider
            label="Wave speed"
            shown={p.speed.toFixed(1)}
            value={p.speed}
            min={1}
            max={12}
            step={0.1}
            onChange={(speed) => tuning.run({ input: { speed } })}
          />
          <Slider
            label="Storm gap"
            shown={`${(p.gap / 1000).toFixed(1)} s`}
            value={p.gap}
            min={100}
            max={1500}
            step={50}
            onChange={(gap) => tuning.run({ input: { gap } })}
          />
        </div>
      </div>
    </section>
  );
}

export function App(): ReactElement {
  return (
    <main className="wrap">
      <style>{css}</style>
      <header className="head">
        <h1>Tile storm</h1>
        <Live />
      </header>
      <Scene />
      <Controls />
    </main>
  );
}
