// In-browser port of bench/react-stores.mjs. N components each subscribe to ONE slice; we update a
// single slice and measure: re-render count (ideal 1 — the fine-grained story), update latency, and
// mount cost. Real React + real react-dom, so numbers are relative to THIS browser, not the Node bench.
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { createScope, data } from "@tinker/core";
import { ScopeProvider, useData } from "@tinker/react";
import { useAtomValue } from "jotai/react";
import { atom, getDefaultStore } from "jotai/vanilla";
import { observable as observable2 } from "legend2";
import { useSelector } from "legend2/react";
import { observable as observable3 } from "legend3";
import { use$ } from "legend3/react";
import { createContext, createElement as h, useContext, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";

// `act` is a dev-only export (absent in production React), so we drive renders with `flushSync`,
// which forces React to flush any work scheduled by a store update before it returns.
export const N = 50;
/** Kept live so component reads of a slice are never dead-code-eliminated. */
let sink: unknown;

export type Lib = {
  name: string;
  fine: boolean; // fine-grained (ideal), or a naive baseline for contrast
  App: () => ReactNode;
  update: (i: number, v: number) => void;
  renders: () => number;
  reset: () => void;
};

export type Metrics = { rerenders: number; updateUs: number; mountUs: number };
export type LibResult = { name: string; fine: boolean; metrics: Metrics };

const keyed = <T>(make: (i: number) => T): T[] => Array.from({ length: N }, (_, i) => make(i));

export function buildLibs(): Lib[] {
  const libs: Lib[] = [];

  // --- tinker ---
  {
    const cells = keyed((i) => data({ label: `c${i}`, initial: 0 }));
    const scope = createScope();
    const controllers = cells.map((c) => scope.controller(c)); // resolved once, like useController
    let renders = 0;
    const Cell = ({ i }: { i: number }) => {
      sink = useData(cells[i]);
      renders++;
      return null;
    };
    libs.push({
      name: "@tinker/react",
      fine: true,
      App: () => h(ScopeProvider, { scope, children: keyed((i) => h(Cell, { key: i, i })) }),
      update: (i, v) => controllers[i].set(v),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- zustand (slice selector) ---
  {
    const useZ = create(
      () => Object.fromEntries(keyed((i) => [`k${i}`, 0])) as Record<string, number>,
    );
    let renders = 0;
    const Cell = ({ i }: { i: number }) => {
      sink = useZ((s) => s[`k${i}`]);
      renders++;
      return null;
    };
    libs.push({
      name: "Zustand",
      fine: true,
      App: () =>
        h(
          "div",
          null,
          keyed((i) => h(Cell, { key: i, i })),
        ),
      update: (i, v) => useZ.setState({ [`k${i}`]: v }),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- jotai (atom per slice) ---
  {
    const atoms = keyed(() => atom(0));
    const store = getDefaultStore();
    let renders = 0;
    const Cell = ({ i }: { i: number }) => {
      sink = useAtomValue(atoms[i]);
      renders++;
      return null;
    };
    libs.push({
      name: "Jotai",
      fine: true,
      App: () =>
        h(
          "div",
          null,
          keyed((i) => h(Cell, { key: i, i })),
        ),
      update: (i, v) => store.set(atoms[i], v),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- legend state v2 ---
  {
    const state = observable2(
      Object.fromEntries(keyed((i) => [`k${i}`, 0])) as Record<string, number>,
    );
    let renders = 0;
    const Cell = ({ i }: { i: number }) => {
      sink = useSelector(state[`k${i}`]);
      renders++;
      return null;
    };
    libs.push({
      name: "Legend v2",
      fine: true,
      App: () =>
        h(
          "div",
          null,
          keyed((i) => h(Cell, { key: i, i })),
        ),
      update: (i, v) => state[`k${i}`].set(v),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- legend state v3 (beta) ---
  {
    const state = observable3(
      Object.fromEntries(keyed((i) => [`k${i}`, 0])) as Record<string, number>,
    );
    let renders = 0;
    const Cell = ({ i }: { i: number }) => {
      sink = use$(state[`k${i}`]);
      renders++;
      return null;
    };
    libs.push({
      name: "Legend v3",
      fine: true,
      App: () =>
        h(
          "div",
          null,
          keyed((i) => h(Cell, { key: i, i })),
        ),
      update: (i, v) => state[`k${i}`].set(v),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- preact signals (runtime integration) ---
  {
    const sigs = keyed(() => signal(0));
    let renders = 0;
    const Cell = ({ i }: { i: number }) => {
      useSignals();
      sink = sigs[i].value;
      renders++;
      return null;
    };
    libs.push({
      name: "Preact Signals",
      fine: true,
      App: () =>
        h(
          "div",
          null,
          keyed((i) => h(Cell, { key: i, i })),
        ),
      update: (i, v) => {
        sigs[i].value = v;
      },
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- React Context (naive baseline: one value object → every consumer re-renders) ---
  {
    const Ctx = createContext<number[]>([]);
    let renders = 0;
    let current = keyed(() => 0);
    let setArr: ((next: number[]) => void) | null = null;
    const Cell = ({ i }: { i: number }) => {
      sink = useContext(Ctx)[i];
      renders++;
      return null;
    };
    const App = () => {
      const [arr, set] = useState(current);
      setArr = set;
      current = arr;
      return h(
        Ctx.Provider,
        { value: arr },
        keyed((i) => h(Cell, { key: i, i })),
      );
    };
    libs.push({
      name: "React Context",
      fine: false,
      App,
      update: (i, v) => {
        const next = [...current];
        next[i] = v;
        current = next;
        setArr?.(next);
      },
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  return libs;
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

function mount(App: () => ReactNode): Root {
  const root = createRoot(document.createElement("div"));
  flushSync(() => root.render(h(App)));
  return root;
}

/** Measure one library. Timings are batched so the browser clock's coarse resolution averages out. */
export async function measure(lib: Lib): Promise<Metrics> {
  // (a) re-render count on a single-slice update (ideal 1).
  const r0 = mount(lib.App);
  lib.reset();
  flushSync(() => lib.update(0, 1));
  const rerenders = lib.renders();
  r0.unmount();

  // (b) update latency on a live tree.
  const live = mount(lib.App);
  let k = 1;
  for (let w = 0; w < 20; w++) flushSync(() => lib.update(++k % N, k));
  let bestUpdate = Infinity;
  const B = 100;
  for (let rep = 0; rep < 3; rep++) {
    const t0 = performance.now();
    for (let i = 0; i < B; i++) flushSync(() => lib.update(++k % N, k));
    bestUpdate = Math.min(bestUpdate, (performance.now() - t0) / B);
    await nextTick();
  }
  live.unmount();

  // (c) mount cost of N subscribed components.
  let bestMount = Infinity;
  const MB = 15;
  for (let rep = 0; rep < 3; rep++) {
    const roots: Root[] = [];
    const t0 = performance.now();
    for (let i = 0; i < MB; i++) roots.push(mount(lib.App));
    bestMount = Math.min(bestMount, (performance.now() - t0) / MB);
    for (const root of roots) root.unmount();
    await nextTick();
  }

  void sink;
  return { rerenders, updateUs: bestUpdate * 1000, mountUs: bestMount * 1000 };
}
