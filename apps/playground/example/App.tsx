import { useData, useResource, useRun } from "@tinker/react";
import { memo } from "react";
import type { CSSProperties, ReactElement } from "react";
import { clear, setPhysics, setStorm, ticker, turn } from "./engine";
import { angle, physics, pickVisibleWalls, stormOn, targetAngle, waves } from "./state";
import { Tile } from "./Tile";

/** The heading belongs to the rotating parent so tiles and wave direction turn together. */
const HEADING = -45;

/** acos(1 / sqrt(3)) gives the ground axes their 30-degree slopes without perspective. */
const TILT = 54.7356;

function Live(): ReactElement {
  const n = useData(waves, (list) => list.length);
  const storm = useData(stormOn);
  return (
    <div className="live" aria-label={`${storm ? "Storm on" : "Storm off"}, ${n} waves travelling`}>
      <span className={storm ? "weather weather-active" : "weather"}>
        <span className="status-light" aria-hidden="true" />
        {storm ? "Storm on" : "Storm off"}
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
  const a = useData(angle);
  const destination = useData(targetAngle);
  const walls = pickVisibleWalls(HEADING + a);
  const style: CSSProperties & { "--still-heading": string } = {
    transform: `rotateX(${TILT}deg) rotateZ(${HEADING + a}deg)`,
    "--still-heading": `rotateX(${TILT}deg) rotateZ(${HEADING + destination}deg)`,
  };
  return (
    <div className="tilt" style={style} data-walls={walls}>
      {children}
    </div>
  );
});

/** Building the ticker resource starts the engine; its value is the grid size. */
const Board = memo(function Board(): ReactElement {
  const { cols, rows } = useResource(ticker);
  /** The pair stays the same between angle edges, so a turn does not redraw every tile per frame. */
  const walls = useData(angle, (a) => pickVisibleWalls(HEADING + a));
  const tiles: ReactElement[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      tiles.push(<Tile key={y * cols + x} x={x} y={y} k={y * cols + x} walls={walls} />);
    }
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
  const storm = useData(stormOn);
  const tune = useRun(setPhysics);
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
            className={storm ? "btn storm-btn storm-on" : "btn storm-btn"}
            aria-pressed={storm}
            onClick={() => flipStorm.run({ input: !storm })}
          >
            <svg className="button-icon storm-symbol" viewBox="0 0 24 24" aria-hidden="true">
              {storm ? <path d="M9 6v12m6-12v12" /> : <path d="M13 3 5 13h6l-1 8 9-12h-6l1-6" />}
            </svg>
            <span>{storm ? "Stop storm" : "Start storm"}</span>
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
              aria-label="Wave speed"
              onChange={(e) => tune.run({ input: { speed: Number(e.target.value) } })}
            />
          </label>
          <label className="ctl">
            <span className="lab">
              Storm gap <b>{(p.stormRate / 1000).toFixed(1)} s</b>
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

/** The pointer sees a cropped field. Keyboard focus fits every real tile into view before
 * the browser can leave focus outside the crop. Reduced motion keeps direction and colour. */
const css = `
  * { box-sizing: border-box; }
  :root { color-scheme: dark; --ink: #06141b; --salt: #edf0df; --foam: #9ce5d1; --lime: #d6ef9c;
    --dim: #92aaa8; --rule: #385050; --mono: ui-monospace, "SF Mono", Consolas, monospace; }
  body { margin: 0; background: var(--ink); }
  button, input { font: inherit; }
  button { -webkit-tap-highlight-color: transparent; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--lime); outline-offset: 5px; }
  ::selection { background: var(--lime); color: var(--ink); }
  .wrap { min-height: 100dvh; padding: 0 clamp(20px, 3.4vw, 64px); color: var(--salt);
    font-family: Arial, Helvetica, sans-serif; display: flex; flex-direction: column;
    background: radial-gradient(ellipse at 77% 35%, #103237 0%, #092128 24%, transparent 59%), var(--ink); }
  .study-line { display: flex; justify-content: space-between; gap: 16px; padding: 24px 0 18px;
    border-bottom: 1px solid var(--rule); font: 10px/1.5 var(--mono); text-transform: uppercase;
    letter-spacing: .13em; color: var(--dim); }
  .hero { width: 100%; max-width: 1700px; margin: 0 auto; display: grid;
    grid-template-columns: minmax(0, .76fr) minmax(0, 1.4fr); align-items: center; flex: 1; }
  .intro { position: relative; z-index: 1; padding: 40px 0 48px; }
  .eyebrow { display: flex; align-items: center; gap: 12px; margin: 0 0 25px;
    color: var(--foam); font: 11px/1.5 var(--mono); letter-spacing: .07em; }
  .eyebrow svg { width: 23px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.3; }
  h1 { margin: 0 0 30px -7px; font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(92px, 9.9vw, 174px); font-weight: 400; line-height: .79; letter-spacing: -.072em; }
  h1 em { font-weight: 400; color: var(--foam); }
  .sub { margin: 0; color: #b6c8be; font-size: clamp(15px, 1.2vw, 18px); line-height: 1.6; letter-spacing: -.02em; }
  .live { display: flex; flex-wrap: wrap; align-items: center; column-gap: 18px; row-gap: 7px;
    margin-top: 30px; color: var(--dim); font: 10px/1.5 var(--mono); }
  .weather { display: inline-flex; align-items: center; gap: 7px; }
  .status-light { width: 5px; height: 5px; border: 1px solid #90b2ab; border-radius: 50%; }
  .weather-active { color: var(--lime); }
  .weather-active .status-light { background: var(--lime); border-color: var(--lime); box-shadow: 0 0 10px #d6ef9c66; }
  .wave-count { border-left: 1px solid var(--rule); padding-left: 18px; }
  .wave-count b { color: var(--salt); font-weight: 400; font-variant-numeric: tabular-nums; }
  .scene { position: relative; container-type: inline-size; display: grid; place-items: center;
    min-width: 0; height: clamp(490px, 42vw, 710px); overflow: clip; }
  .field { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none;
    mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent),
      linear-gradient(transparent, #000 12%, #000 83%, transparent); mask-composite: intersect;
    overflow: clip; }
  .tilt, .board { transform-style: preserve-3d; }
  .tilt { flex-shrink: 0; margin-top: 40px; pointer-events: auto; }
  .board { position: relative; display: grid; gap: 2px; width: min(200cqw, 1500px); touch-action: manipulation; }
  .scene:has(.tile:focus-visible) .board { width: min(59cqw, 470px); }
  .scene:has(.tile:focus-visible) .field { mask-image: none; }
  .tile { position: relative; display: block; width: 100%; aspect-ratio: 1; border: 0; padding: 0;
    border-radius: 0; cursor: pointer; transform-style: preserve-3d; }
  .tile.converge > .top { outline-color: #edfff7bb; }
  .tile:hover > .top { outline-color: var(--lime); }
  .tile:focus-visible { outline: 2px solid var(--lime); outline-offset: 3px; }
  .wall { position: absolute; display: block; backface-visibility: hidden; pointer-events: none; }
  .wall.n { left: 0; width: 100%; top: -1px; height: 1px; transform-origin: 50% 100%; }
  .wall.s { left: 0; width: 100%; top: 100%; height: 1px; transform-origin: 50% 0%; }
  .wall.e { top: 0; height: 100%; left: 100%; width: 1px; transform-origin: 0% 50%; }
  .wall.w { top: 0; height: 100%; left: -1px; width: 1px; transform-origin: 100% 50%; }
  .top { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
    outline: 1px solid #bbf4e138; outline-offset: -1px; }
  .arrow { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  .arrow svg { width: 55%; height: 55%; fill: none; stroke-width: 1.4; stroke-linecap: square; stroke-linejoin: miter; }
  .scene-caption { position: absolute; bottom: 13px; left: 0; right: 0; text-align: center;
    color: #a6bfb6; font: 10px/1.5 var(--mono); letter-spacing: .02em; pointer-events: none; }
  .press-mark { display: inline-block; width: 24px; height: 24px; margin-right: 8px;
    vertical-align: middle; fill: none; stroke: var(--lime); stroke-width: 1; }
  .press-mark circle { stroke: #54786e; }
  .panel { display: grid; grid-template-columns: .8fr 1fr 2fr; border-top: 1px solid var(--rule); padding: 24px 0 18px; gap: 28px; }
  .control-group { min-width: 0; }
  .control-group + .control-group { border-left: 1px solid var(--rule); padding-left: 28px; }
  h2 { display: flex; gap: 12px; align-items: center; margin: 0 0 17px; color: var(--salt);
    font: 11px/1.5 var(--mono); font-weight: 400; }
  h2 > span { color: #95b4a4; font-size: 9px; }
  .button-pair { display: flex; align-items: center; gap: 8px; }
  .btn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    min-height: 48px; border: 1px solid #577269; border-radius: 3px; padding: 0 15px;
    background: linear-gradient(#c8efdf06, #c8efdf00); color: var(--salt); font-size: 12px;
    white-space: nowrap; cursor: pointer; box-shadow: inset 0 1px #eaffed09, 0 2px 0 #020b0f66;
    transition: color 160ms, background 160ms, border-color 160ms, box-shadow 160ms, transform 160ms; }
  .btn:hover { background: #9ce5d114; border-color: var(--foam); box-shadow: inset 0 0 0 1px #9ce5d133, 0 2px 0 #020b0f; }
  .btn:active { transform: translateY(1px); background: #9ce5d125; box-shadow: inset 0 2px 4px #0004; }
  .button-icon { width: 19px; height: 19px; flex: none; fill: none; stroke: currentColor;
    stroke-width: 1.4; stroke-linecap: square; stroke-linejoin: miter; transition: transform 180ms; }
  .turn-pair { gap: 0; }
  .turn-btn { flex: 1; gap: 12px; }
  .button-copy { text-align: left; line-height: 1.2; }
  .button-copy small { display: block; margin-top: 4px; color: #92aaa8; font: 8px/1 var(--mono); }
  .turn-btn .button-icon { color: var(--foam); }
  .turn-left { border-radius: 3px 0 0 3px; }
  .turn-right { border-radius: 0 3px 3px 0; margin-left: -1px; }
  .turn-btn:hover { z-index: 1; }
  .turn-left:hover .button-icon { transform: rotate(-30deg); }
  .turn-right:hover .button-icon { transform: rotate(30deg); }
  .storm-btn { flex: 1; background: var(--lime); border-color: var(--lime); color: var(--ink);
    box-shadow: inset 0 0 0 3px #06141b0b, 0 2px 0 #020b0f66; }
  .storm-btn:hover { background: #e8f6c2; border-color: #e8f6c2; box-shadow: inset 0 0 0 3px #06141b18, 0 2px 0 #020b0f; }
  .storm-btn:active { background: #c6e48b; }
  .storm-btn:hover .storm-symbol { transform: translateY(-2px); }
  .button-indicator { width: 4px; height: 4px; margin-left: auto; border: 1px solid currentColor; border-radius: 50%; opacity: .6; }
  .storm-on { background: #9ce5d11a; color: var(--lime); border-color: #9ce5d177; box-shadow: inset 0 0 0 3px #9ce5d10a, 0 2px 0 #020b0f66; }
  .storm-on .button-indicator { background: var(--lime); opacity: 1; box-shadow: 0 0 8px #d6ef9c66; }
  .storm-on:hover { color: var(--ink); }
  .clear-btn { color: #b5c5b9; background: transparent; border-color: #385050; padding: 0 12px; }
  .clear-btn .button-icon { width: 16px; }
  .sliders { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
  .ctl { display: grid; min-width: 0; color: #a5bcb1; font-size: 11px; }
  .lab { display: flex; justify-content: space-between; gap: 7px; }
  .lab b { color: var(--salt); font: 11px/1.5 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ctl input { appearance: none; width: 100%; height: 44px; margin: 0; background: transparent; cursor: pointer; }
  .ctl input::-webkit-slider-runnable-track { height: 2px; background: #547369; }
  .ctl input::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; margin-top: -6px;
    border: 3px solid var(--ink); border-radius: 50%; background: var(--lime); box-shadow: 0 0 0 1px #9ebd8e; }
  .ctl input::-moz-range-track { height: 2px; background: #547369; }
  .ctl input::-moz-range-thumb { width: 8px; height: 8px; border: 3px solid var(--ink);
    border-radius: 50%; background: var(--lime); box-shadow: 0 0 0 1px #9ebd8e; }
  .ctl input:hover::-webkit-slider-thumb { background: var(--lime); box-shadow: 0 0 0 1px var(--lime); }
  .ctl input:hover::-moz-range-thumb { background: var(--lime); box-shadow: 0 0 0 1px var(--lime); }
  .colophon { display: flex; justify-content: space-between; gap: 16px; border-top: 1px solid #38505088;
    padding: 16px 0 20px; color: #89a49b; font: 9px/1.5 var(--mono); }
  .colophon b { color: #cad8c5; font-weight: 400; }
  .colophon svg { display: inline-block; width: 12px; height: 12px; margin-left: 9px; fill: none; stroke: var(--lime); stroke-width: 1; vertical-align: middle; }
  @media (min-width: 1600px) { .panel, .study-line, .colophon { width: 100%; max-width: 1700px; margin-inline: auto; } }
  @media (max-width: 1100px) {
    .panel { grid-template-columns: .8fr 1fr; gap: 22px; }
    .tune-controls { grid-column: 1 / -1; }
    .control-group.tune-controls { border-left: 0; border-top: 1px solid var(--rule); padding: 20px 0 0; }
    .sliders { gap: 36px; }
  }
  @media (max-width: 760px) {
    .study-line { padding-top: 20px; font-size: 9px; letter-spacing: .08em; }
    .study-line > span:last-child { max-width: 19ch; text-align: right; }
    .hero { display: flex; flex-direction: column; align-items: stretch; }
    .intro { padding: 32px 0 0; }
    .eyebrow { margin-bottom: 20px; font-size: 10px; }
    h1 { font-size: clamp(80px, 19vw, 128px); margin-left: -4px; margin-bottom: 22px; }
    .sub { position: absolute; left: 55%; top: 105px; font-size: 13px; }
    .live { margin-top: 24px; }
    .scene { height: clamp(350px, 80vw, 480px); margin-top: 12px; }
    .board { width: 200cqw; gap: 2px; }
    .scene:has(.tile:focus-visible) .board { width: 59cqw; }
    .scene-caption { bottom: 8px; font-size: 9px; }
    .panel { padding-top: 22px; gap: 22px 18px; grid-template-columns: .9fr 1.2fr; }
    .control-group + .control-group { padding-left: 18px; }
    h2 { gap: 7px; font-size: 9px; margin-bottom: 13px; }
    .btn { padding: 0 11px; font-size: 11px; }
    .turn-btn { gap: 5px; padding-inline: 8px; }
    .storm-btn { min-width: 0; flex: 1; }
    .button-icon { width: 17px; height: 17px; }
    .button-indicator { display: none; }
    .clear-btn { width: 44px; padding: 0; }
    .clear-btn > span { display: none; }
    .sliders { gap: 21px; }
    .ctl { font-size: 10px; }
    .lab { flex-direction: column; gap: 4px; }
    .colophon { font-size: 8px; }
  }
  @media (max-width: 380px) {
    .panel { grid-template-columns: 1fr; }
    .control-group + .control-group { border-left: 0; border-top: 1px solid var(--rule); padding: 18px 0 0; }
    .button-pair { max-width: 100%; }
    .turn-btn, .storm-btn { flex: 1; }
    .weather-controls .clear-btn { flex: 1; }
    .sub { position: static; font-size: 13px; margin: 20px 0 0; }
    .sub br { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
    .tilt { transform: var(--still-heading) !important; }
    .tile { transform: translateZ(10px) !important; }
    .wall { display: none; }
  }
`;
