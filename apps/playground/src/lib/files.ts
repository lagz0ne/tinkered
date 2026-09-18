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

// One scope holds every cell. The leaf LIST is a cell; each leaf's VALUE is its own cell — so
// bumping one leaf notifies only that leaf's subscriber, never the list or the other leaves.
export const scope = createScope();

export const leaves = data({ label: "leaves", initial: [] }); // number[] of ids
export const upsCell = data({ label: "ups", initial: 0 }); // updates / second
export const rpsCell = data({ label: "rps", initial: 0 }); // React renders / second
export const countCell = data({ label: "count", initial: 0 }); // live leaf count

const leavesCtl = scope.controller(leaves);
const stat = {
  ups: scope.controller(upsCell),
  rps: scope.controller(rpsCell),
  count: scope.controller(countCell),
};

const cells = new Map(); // id -> value cell
const ctls = new Map(); // id -> cached controller (what useController hands you)
let nextId = 1;

export function leafCell(id) {
  return cells.get(id);
}

export function addLeaf() {
  const id = nextId++;
  const cell = data({ label: "leaf" + id, initial: (id * 7) % 100 });
  cells.set(id, cell);
  ctls.set(id, scope.controller(cell));
  leavesCtl.update((ids) => [...ids, id]);
  return id;
}

export function removeLeaf(id) {
  // Only drop it from the list; keep the cell around so a stale render can never read undefined.
  leavesCtl.update((ids) => ids.filter((x) => x !== id));
}

export function bump(id) {
  const ctl = ctls.get(id);
  if (ctl) ctl.update((v) => (v + 1) % 100);
}

export function ids() {
  return leavesCtl.get();
}

export function setStats(ups, rps) {
  stat.ups.set(ups);
  stat.rps.set(rps);
  stat.count.set(leavesCtl.get().length);
}

// A global tally of React renders so the engine can report renders / second.
let rendered = 0;
export function tallyRender() {
  rendered += 1;
}
export function renderTotal() {
  return rendered;
}

// Seed an initial field of leaves.
for (let i = 0; i < 80; i++) addLeaf();
`,
  },
  {
    name: "engine.ts",
    content: `import { addLeaf, bump, ids, removeLeaf, renderTotal, setStats } from "./store";

// A driver that hammers the store: many value updates per frame, plus leaves appearing and
// disappearing at the same time. Nothing here touches React directly — it just mutates cells.
let running = false;
let frame = 0;
let sampler = 0;
let intensity = 40; // value bumps per animation frame (~2400/s at 60fps)
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
  // Concurrent structural churn: leaves born and removed while values fly.
  if (Math.random() < 0.4 && list.length < 240) addLeaf();
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
    setStats(Math.round(updates / dt), Math.round((r - prevRenders) / dt));
    prev = now;
    prevRenders = r;
    updates = 0;
  }, 400);
}

export function stop() {
  running = false;
  cancelAnimationFrame(frame);
  clearInterval(sampler);
  setStats(0, 0);
}

export function isRunning() {
  return running;
}
`,
  },
  {
    name: "Leaf.tsx",
    content: `import { useData } from "@tinker/react";
import { memo, useEffect, useRef } from "react";
import { leafCell, tallyRender } from "./store";

// Flash the tile every time React re-renders it, and tally the render for the stats.
function useRenderFlash() {
  tallyRender();
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.animate(
      [
        { boxShadow: "inset 0 0 0 2px #16a34a", transform: "scale(1.08)" },
        { boxShadow: "inset 0 0 0 2px rgba(22,163,74,0)", transform: "scale(1)" },
      ],
      { duration: 420, easing: "ease-out" },
    );
  });
  return ref;
}

// memo: when the grid re-renders (a leaf was added/removed) the untouched tiles are SKIPPED — only
// the mounted/unmounted one changes. A value bump still re-renders its tile through useData's
// subscription, independent of the parent. So a flash always means "this cell actually changed".
export const Leaf = memo(function Leaf({ id }) {
  const ref = useRenderFlash();
  const value = useData(leafCell(id)); // subscribes to THIS leaf only
  const hue = (value * 14) % 360;
  const bg = "hsl(" + hue + " 85% 91%)";
  return (
    <div ref={ref} className="tile" style={{ background: bg }}>
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
import { countCell, leaves, rpsCell, upsCell } from "./store";

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
          Hundreds of leaves, each its own cell. Press <b>Start</b>: values update thousands of times
          a second while leaves are added and removed at the same time. Each tile flashes when React
          re-renders it — only the tiles whose cell actually changed light up. The grid itself
          re-renders only when a leaf appears or disappears.
        </p>
      </header>
      <div className="controls">
        <button className="btn" onClick={toggle}>
          {on ? "Stop" : "Start"}
        </button>
        <label className="rate">
          intensity
          <input type="range" min="5" max="120" defaultValue="40" onChange={(e) => setIntensity(+e.target.value)} />
        </label>
        <Stat cell={countCell} label="leaves" />
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
  .sub { color: #52525b; margin: 0 0 16px; max-width: 70ch; }
  .controls { display: flex; align-items: center; gap: 18px; margin-bottom: 16px; flex-wrap: wrap; }
  .btn { font: inherit; font-weight: 600; padding: 8px 20px; border: 1px solid #18181b; border-radius: 10px; background: #18181b; color: #fff; cursor: pointer; }
  .btn:hover { background: #27272a; }
  .rate { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #71717a; }
  .stat { display: flex; flex-direction: column; align-items: center; min-width: 64px; }
  .stat b { font-size: 1.15rem; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; color: #a1a1aa; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 4px; }
  .tile { height: 38px; display: grid; place-items: center; border-radius: 8px; font-size: 11px; font-variant-numeric: tabular-nums; color: #3f3f46; border: 1px solid rgba(0,0,0,0.05); will-change: transform; }
\`;
`,
  },
];
