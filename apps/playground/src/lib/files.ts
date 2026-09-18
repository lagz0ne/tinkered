/** One editor tab = one file in the virtual project. */
export type PlaygroundFile = { name: string; content: string };

/** The bundler entry. The preview runs this file; other files are reached via relative imports. */
export const ENTRY = "main.tsx";

export const DEFAULT_FILES: readonly PlaygroundFile[] = [
  {
    name: "main.tsx",
    content: `import { ScopeProvider } from "@tinker/react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { scope } from "./store";

// The store owns the scope; the provider shares it with the components.
createRoot(document.getElementById("root")!).render(
  <ScopeProvider scope={scope}>
    <App />
  </ScopeProvider>,
);
`,
  },
  {
    name: "store.ts",
    content: `import { createScope, data } from "@tinker/core";

// One scope, lots of cells. Each leaf has TWO cells: a value (its counter) and a heat (0..1, how
// recently it was touched). A bump raises the value and reheats to 1; a per-frame decay fades heat
// back down. So every tile derives colour from its value AND brightness/scale from its heat, and
// re-renders on either — that's the extra load.
export const scope = createScope();

export const leaves = data({ label: "leaves", initial: [] }); // number[] of ids
export const upsCell = data({ label: "ups", initial: 0 }); // updates / second
export const rpsCell = data({ label: "rps", initial: 0 }); // React renders / second
export const countCell = data({ label: "count", initial: 0 }); // live leaf count
export const hotCell = data({ label: "hot", initial: 0 }); // leaves currently fading

const leavesCtl = scope.controller(leaves);
const upsC = scope.controller(upsCell);
const rpsC = scope.controller(rpsCell);
const countC = scope.controller(countCell);
const hotC = scope.controller(hotCell);

// A derived EFFECT via watch: the leaf count follows the list automatically, no manual bookkeeping.
leavesCtl.watch((list) => countC.set(list.length));

const valueCells = new Map();
const heatCells = new Map();
const valueCtls = new Map();
const heatCtls = new Map();
const hot = new Set(); // ids still fading — the only ones the decay pass touches
let nextId = 1;

export function valueCell(id) {
  return valueCells.get(id);
}
export function heatCell(id) {
  return heatCells.get(id);
}

export function addLeaf() {
  const id = nextId++;
  const v = data({ label: "v" + id, initial: (id * 7) % 100 });
  const h = data({ label: "h" + id, initial: 0 });
  valueCells.set(id, v);
  heatCells.set(id, h);
  valueCtls.set(id, scope.controller(v));
  heatCtls.set(id, scope.controller(h));
  leavesCtl.update((ids) => [...ids, id]);
  return id;
}

export function removeLeaf(id) {
  hot.delete(id);
  leavesCtl.update((ids) => ids.filter((x) => x !== id)); // keep the cells; only the list shrinks
}

export function bump(id) {
  const vc = valueCtls.get(id);
  if (!vc) return;
  vc.update((v) => (v + 1) % 100);
  heatCtls.get(id).set(1); // freshly hot
  hot.add(id);
}

// Fade every hot leaf a little; drop the ones that have gone cold so they stop re-rendering.
export function decay(factor) {
  for (const id of hot) {
    const hc = heatCtls.get(id);
    const next = hc.get() * factor;
    if (next < 0.03) {
      hc.set(0);
      hot.delete(id);
    } else {
      hc.set(next);
    }
  }
  hotC.set(hot.size);
}

export function ids() {
  return leavesCtl.get();
}
export function setRates(ups, rps) {
  upsC.set(ups);
  rpsC.set(rps);
}

let rendered = 0;
export function tallyRender() {
  rendered += 1;
}
export function renderTotal() {
  return rendered;
}

for (let i = 0; i < 80; i++) addLeaf();
`,
  },
  {
    name: "engine.ts",
    content: `import { addLeaf, bump, decay, ids, removeLeaf, renderTotal, setRates } from "./store";

// The driver: many value bumps per frame, a fade pass over the hot leaves, and leaves appearing and
// disappearing — all at once. It only mutates cells; React reacts on its own.
let running = false;
let frame = 0;
let sampler = 0;
let intensity = 22; // value bumps per animation frame (~1300/s at 60fps); crank the slider
let updates = 0;

export function setIntensity(n) {
  intensity = n;
}

function step() {
  if (!running) return;
  const list = ids();
  for (let i = 0; i < intensity; i++) {
    if (list.length) bump(list[(Math.random() * list.length) | 0]);
    updates += 1;
  }
  decay(0.9); // fade the hot leaves one step
  if (Math.random() < 0.4 && list.length < 220) addLeaf();
  if (Math.random() < 0.35 && list.length > 24) removeLeaf(list[(Math.random() * list.length) | 0]);
  frame = requestAnimationFrame(step);
}

export function start() {
  if (running) return;
  running = true;
  let prev = performance.now();
  let prevRenders = renderTotal();
  frame = requestAnimationFrame(step);
  sampler = setInterval(() => {
    const now = performance.now();
    const dt = (now - prev) / 1000;
    const r = renderTotal();
    setRates(Math.round(updates / dt), Math.round((r - prevRenders) / dt));
    prev = now;
    prevRenders = r;
    updates = 0;
  }, 400);
}

export function stop() {
  running = false;
  cancelAnimationFrame(frame);
  clearInterval(sampler);
  setRates(0, 0);
}

export function isRunning() {
  return running;
}
`,
  },
  {
    name: "Leaf.tsx",
    content: `import { useData } from "@tinker/react";
import { memo } from "react";
import { heatCell, tallyRender, valueCell } from "./store";

// Two subscriptions, several derivations: hue comes from the value, brightness + scale + opacity
// come from the heat. A bump repaints the colour and relights the tile; the fade shrinks and dims it
// over the next ~30 frames. memo means the grid re-rendering (add/remove) skips untouched tiles.
export const Leaf = memo(function Leaf({ id }) {
  tallyRender();
  const value = useData(valueCell(id));
  const heat = useData(heatCell(id));

  const hue = (value * 14) % 360;
  const light = 94 - heat * 42; // brighter while hot
  const style = {
    background: "hsl(" + hue + " 88% " + light + "%)",
    transform: "scale(" + (1 + heat * 0.18).toFixed(3) + ")",
    opacity: 0.45 + heat * 0.55,
    zIndex: heat > 0.35 ? 2 : 1,
    boxShadow: heat > 0.5 ? "0 2px 10px rgba(0,0,0,0.15)" : "none",
  };
  return (
    <div className="tile" style={style}>
      {value}
    </div>
  );
});
`,
  },
  {
    name: "App.tsx",
    content: `import { useData } from "@tinker/react";
import { useState } from "react";
import { isRunning, setIntensity, start, stop } from "./engine";
import { Leaf } from "./Leaf";
import { countCell, hotCell, leaves, rpsCell, upsCell } from "./store";

function Stat({ cell, label }) {
  const v = useData(cell);
  return (
    <div className="stat">
      <b>{v}</b>
      <span>{label}</span>
    </div>
  );
}

function Grid() {
  const list = useData(leaves); // re-renders ONLY when leaves are added or removed
  return (
    <div className="grid">
      {list.map((id) => (
        <Leaf key={id} id={id} />
      ))}
    </div>
  );
}

export function App() {
  const [on, setOn] = useState(isRunning());
  const toggle = () => {
    if (on) stop();
    else start();
    setOn(!on);
  };
  return (
    <div className="wrap">
      <style>{css}</style>
      <header>
        <h1>Fine-grained update storm</h1>
        <p className="sub">
          Hundreds of leaves, <b>two cells each</b> — a value and a heat. Press <b>Start</b>: values
          update thousands of times a second while leaves are born and removed. Each bump relights a
          tile, then it <b>fades out</b> over the next half-second (colour from the value, brightness
          and scale derived from the heat). Only the leaves that changed do any work; the grid
          re-renders only when the set of leaves changes.
        </p>
      </header>
      <div className="controls">
        <button className="btn" onClick={toggle}>
          {on ? "Stop" : "Start"}
        </button>
        <label className="rate">
          intensity
          <input type="range" min="5" max="120" defaultValue="22" onChange={(e) => setIntensity(+e.target.value)} />
        </label>
        <Stat cell={countCell} label="leaves" />
        <Stat cell={hotCell} label="fading" />
        <Stat cell={upsCell} label="updates/s" />
        <Stat cell={rpsCell} label="renders/s" />
      </div>
      <Grid />
    </div>
  );
}

const css = \`
  .wrap { max-width: 880px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; letter-spacing: -0.02em; }
  .sub { color: #52525b; margin: 0 0 16px; max-width: 72ch; }
  .controls { display: flex; align-items: center; gap: 18px; margin-bottom: 16px; flex-wrap: wrap; }
  .btn { font: inherit; font-weight: 600; padding: 8px 20px; border: 1px solid #18181b; border-radius: 10px; background: #18181b; color: #fff; cursor: pointer; }
  .btn:hover { background: #27272a; }
  .rate { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #71717a; }
  .stat { display: flex; flex-direction: column; align-items: center; min-width: 62px; }
  .stat b { font-size: 1.15rem; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; color: #a1a1aa; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 4px; }
  .tile { height: 38px; display: grid; place-items: center; border-radius: 8px; font-size: 11px; font-variant-numeric: tabular-nums; color: #3f3f46; border: 1px solid rgba(0,0,0,0.05); will-change: transform, opacity; }
\`;
`,
  },
];
