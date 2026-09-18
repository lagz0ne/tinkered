/** One editor tab = one file in the virtual project. */
export type PlaygroundFile = { name: string; content: string };

/** The bundler entry. The preview runs this file; other files are reached via relative imports. */
export const ENTRY = "main.tsx";

export const DEFAULT_FILES: readonly PlaygroundFile[] = [
  {
    name: "main.tsx",
    content: `import { createScope } from "@tinker/core";
import { createRoot } from "react-dom/client";
import { ScopeProvider } from "@tinker/react";
import { App } from "./App";

// One scope holds the app's cells. Components read them through hooks.
createRoot(document.getElementById("root")!).render(
  <ScopeProvider create={() => createScope()}>
    <App />
  </ScopeProvider>,
);
`,
  },
  {
    name: "store.ts",
    content: `import { data } from "@tinker/core";

// Three independent reactive cells. Nothing wires them together —
// each component below subscribes to exactly what it reads.
export const first = data({ label: "first", initial: "Ada" });
export const last = data({ label: "last", initial: "Lovelace" });
export const count = data({ label: "count", initial: 0 });
`,
  },
  {
    name: "Track.tsx",
    content: `import { useEffect, useRef, type ReactNode } from "react";

// Call this INSIDE a component to flash + count its own re-renders. It has to
// live in the component that reads the cell — with fine-grained reactivity only
// that component re-renders, not its parent. Return a ref to put on the card.
export function useRenderFlash() {
  const renders = useRef(0);
  renders.current += 1;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.animate(
      [
        { boxShadow: "inset 0 0 0 2px #22c55e", background: "#f0fdf4" },
        { boxShadow: "inset 0 0 0 2px rgba(34,197,94,0)", background: "#fff" },
      ],
      { duration: 700, easing: "ease-out" },
    );
  });
  return { renders: renders.current, ref };
}

export function Card(props: {
  label: string;
  tracked: ReturnType<typeof useRenderFlash>;
  children: ReactNode;
}) {
  return (
    <div ref={props.tracked.ref} className="card">
      <div className="card-head">
        <span className="tag">{props.label}</span>
        <span className="renders">rendered {props.tracked.renders}×</span>
      </div>
      <div className="card-body">{props.children}</div>
    </div>
  );
}
`,
  },
  {
    name: "App.tsx",
    content: `import { useController, useData } from "@tinker/react";
import { count, first, last } from "./store";
import { Card, useRenderFlash } from "./Track";

function TextInput({ label, cell }: { label: string; cell: typeof first }) {
  const value = useData(cell); // reactive read
  const set = useController(cell); // write handle
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(e) => set.set(e.target.value)} />
    </label>
  );
}

function FullName() {
  const tracked = useRenderFlash();
  const f = useData(first);
  const l = useData(last);
  return <Card label="reads first + last" tracked={tracked}><p className="big">{f} {l}</p></Card>;
}

function Initial() {
  const tracked = useRenderFlash();
  // A SELECTOR: re-renders only when the first LETTER changes, not on every
  // keystroke. Type "Adaa" and this card holds still while Full name flashes.
  const initial = useData(first, (s) => s[0]?.toUpperCase() ?? "?");
  return <Card label="reads first[0] · selector" tracked={tracked}><p className="big">{initial}</p></Card>;
}

function Counter() {
  const tracked = useRenderFlash();
  const n = useData(count);
  const set = useController(count);
  return (
    <Card label="reads count" tracked={tracked}>
      <button className="btn" onClick={() => set.update((x) => x + 1)}>
        count is {n} — click me
      </button>
    </Card>
  );
}

function Static() {
  const tracked = useRenderFlash();
  // Reads no cells, so nothing ever makes it re-render: rendered 1×, forever.
  return <Card label="reads nothing" tracked={tracked}><p className="muted">I read no cells.</p></Card>;
}

export function App() {
  return (
    <div className="wrap">
      <style>{css}</style>
      <header>
        <h1>Fine-grained re-renders</h1>
        <p className="sub">
          Every card flashes green and counts a render each time React re-renders it.
          Change a value below and watch: <b>only</b> the cards that read it update.
        </p>
      </header>

      <div className="inputs">
        <TextInput label="first" cell={first} />
        <TextInput label="last" cell={last} />
      </div>

      <div className="grid">
        <FullName />
        <Initial />
        <Counter />
        <Static />
      </div>
    </div>
  );
}

const css = \`
  .wrap { max-width: 720px; }
  header h1 { font-size: 1.5rem; margin: 0 0 4px; letter-spacing: -0.02em; }
  .sub { color: #52525b; margin: 0 0 20px; max-width: 60ch; }
  .inputs { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #71717a; }
  .field input {
    font: inherit; padding: 8px 10px; border: 1px solid #e4e4e7; border-radius: 8px; min-width: 160px;
  }
  .field input:focus { outline: 2px solid #a1a1aa33; border-color: #a1a1aa; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { border: 1px solid #e4e4e7; border-radius: 12px; padding: 14px; background: #fff; }
  .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .tag { font-size: 11px; font-weight: 600; color: #3f3f46; }
  .renders { font-size: 11px; color: #a1a1aa; font-variant-numeric: tabular-nums; }
  .big { font-size: 1.25rem; font-weight: 600; margin: 4px 0; }
  .muted { color: #a1a1aa; margin: 4px 0; }
  .btn {
    font: inherit; padding: 8px 12px; border: 1px solid #e4e4e7; border-radius: 8px;
    background: #fafafa; cursor: pointer;
  }
  .btn:hover { background: #f4f4f5; }
  @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
\`;
`,
  },
];
