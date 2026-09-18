// In-browser port of bench/react-stores.mjs. N components each subscribe to ONE slice; we update a
// single slice and measure: re-render count (ideal 1 — the fine-grained story), update latency, and
// mount cost. Real React + real react-dom, so numbers are relative to THIS browser, not the Node bench.
//
// Every competitor block below was audited against its installed source for its best idiomatic
// setup (see the comment on each). The harness itself was audited for neutrality: equivalent trees,
// interleaved sampling, a control row, and a per-sample guard that no library escapes the timed window.
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { createScope, data } from "@tinker/core";
import { ScopeProvider, useData } from "@tinker/react";
import { useAtomValueRaw } from "jotai/react";
import { atom, createStore } from "jotai/vanilla";
import { observable as observable2 } from "legend2";
import { observer as observer2 } from "legend2/react";
import { observable as observable3 } from "legend3";
import { observer as observer3, use$ } from "legend3/react";
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
  control?: boolean; // the no-store floor; shown in the table, excluded from the takeaway
  App: () => ReactNode;
  update: (i: number, v: number) => void;
  renders: () => number;
  reset: () => void;
};

/** Median and interquartile range, in µs, of one metric's samples. */
export type Stat = { median: number; q1: number; q3: number };
export type Metrics = { rerenders: number; update: Stat; mount: Stat };
export type LibResult = { name: string; fine: boolean; control: boolean; metrics: Metrics };

const keyed = <T>(make: (i: number) => T): T[] => Array.from({ length: N }, (_, i) => make(i));

// Tree equivalence: every App is `div → (the library's own required wrapper, if any) → 50 Cells`.
// A root host element is what every real app has; a provider is that library's real integration
// cost, so it sits inside. Children are built once per lib — a real provider receives `children`
// and never rebuilds them.
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
    const children = keyed((i) => h(Cell, { key: i, i }));
    libs.push({
      name: "@tinker/react",
      fine: true,
      App: () => h("div", null, h(ScopeProvider, { scope, children })),
      update: (i, v) => controllers[i].set(v),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- zustand (slice selector) ---
  // Audited (zustand 5.0.15 source): selectors live outside the component, the docs' idiom. It
  // matters twice — a stable selector keeps useStore's getSnapshot useCallback stable, and React
  // registers one store listener per Cell that calls getSnapshot on EVERY setState, so an inline
  // `(s) => s[`k${i}`]` rebuilt + re-hashed the key 50× per update (~2× slower in a Node probe).
  // The plain partial merge (one Object.assign over the keys) is Zustand's normal write; `replace`
  // or an array-shaped store would dodge it but is not how a Zustand app is written.
  {
    type State = Record<string, number>;
    const keys = keyed((i) => `k${i}`);
    const useZ = create<State>(() => Object.fromEntries(keys.map((k) => [k, 0])));
    const selectors = keyed((i) => {
      const k = keys[i];
      return (s: State) => s[k];
    });
    let renders = 0;
    const Cell = ({ i }: { i: number }) => {
      sink = useZ(selectors[i]);
      renders++;
      return null;
    };
    const children = keyed((i) => h(Cell, { key: i, i }));
    libs.push({
      name: "Zustand",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => useZ.setState({ [keys[i]]: v }),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- jotai (atom per slice) ---
  // Audited (jotai 3.0.0 source): own store + a hoisted `{ store }` options object short-circuits
  // `useStore`'s `getDefaultStore()` lookup with no Provider fiber; `useAtomValueRaw` (public in v3)
  // is `useAtomValue` minus the per-render `options || {}` allocation and promise/`use()` unwrapping
  // a number atom never needs. `store.set` is already the shortest write path Jotai exposes.
  {
    const atoms = keyed(() => atom(0));
    const store = createStore();
    const opts = { store };
    let renders = 0;
    const Cell = ({ i }: { i: number }) => {
      sink = useAtomValueRaw(atoms[i], opts);
      renders++;
      return null;
    };
    const children = keyed((i) => h(Cell, { key: i, i }));
    libs.push({
      name: "Jotai",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => store.set(atoms[i], v),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- legend state v2 ---
  // Audited (@legendapp/state 2.1.15 source). One root primitive observable per slice: a plain class
  // instance with bound get/set — no Proxy trap, and no parent node, so `set` never walks up to
  // notify a root. The old 50-key object paid a template string + Proxy `get` (with `peek`) + a
  // fresh `.set` closure on EVERY render and update, while every other library resolved its handle
  // once — the single biggest handicap in the harness, and it was against Legend. `observer`
  // wraps the render in `useSelector(fn, { skipCheck: true })`, so a change bumps a version and
  // notifies instead of re-running dispose/track/resubscribe twice per update. `renders++` is inside
  // the real render body; `observer`'s memo cannot skip it because the update arrives through
  // useSyncExternalStore, not props. (`enableReactTracking` was rejected: it reads a React 18
  // internal that React 19 no longer exports, so `.get()` in a plain component silently stops
  // tracking.)
  {
    const slices = keyed(() => observable2(0));
    let renders = 0;
    const Cell = observer2(({ i }: { i: number }) => {
      sink = slices[i].get(); // tracked by observer's render-level selector
      renders++;
      return null;
    });
    const children = keyed((i) => h(Cell, { key: i, i }));
    libs.push({
      name: "Legend v2",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => slices[i].set(v),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- legend state v3 (beta) ---
  // Audited (@legendapp/state 3.0.0-beta.48 source). Same shape as v2, bigger payoff: in beta.48
  // `onChange` walks every ancestor on subscribe AND dispose, and `use$` resubscribes on every
  // render and again in its change listener — four parent walks per update on the keyed object.
  // Root primitives have no parent, so those vanish. `observer` + `use$` is the recommended pairing:
  // inside `observer`, `use$(obs)` short-circuits to a tracked get, not a second hook. `Memo`
  // (a separate leaf component that re-renders instead of the Cell) is a different rendering model,
  // not a faster version of this workload — it would read 0 Cell renders / 1 leaf render.
  {
    const slices = keyed(() => observable3(0));
    let renders = 0;
    const Cell = observer3(({ i }: { i: number }) => {
      sink = use$(slices[i]);
      renders++;
      return null;
    });
    const children = keyed((i) => h(Cell, { key: i, i }));
    libs.push({
      name: "Legend v3",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => slices[i].set(v),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- preact signals (runtime integration, managed mode) ---
  // Audited (@preact/signals-react 3.12.0 source): this is byte-for-byte what the official Babel
  // transform emits for a component. Bare `useSignals()` is the UNMANAGED fallback ("for people who
  // can't use a build step"): it adds a dep-less useLayoutEffect on every render of every component
  // and re-arms a Promise microtask per render — overhead the managed form does not pay. Do NOT
  // "upgrade" this to the Babel transform: it only transforms functions containing JSX/createElement,
  // so a `return null` Cell would be silently skipped and report 0 re-renders with no subscription.
  {
    const sigs = keyed(() => signal(0));
    let renders = 0;
    const Cell = ({ i }: { i: number }) => {
      const store = useSignals(1);
      try {
        sink = sigs[i].value;
        renders++;
        return null;
      } finally {
        store.f();
      }
    };
    const children = keyed((i) => h(Cell, { key: i, i }));
    libs.push({
      name: "Preact Signals",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => {
        sigs[i].value = v;
      },
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- React useState (control: per-cell state, no store) ---
  // The floor for "one synchronous re-render under flushSync". Every library's number reads as
  // overhead above this; if any library ever beat it, the harness — not the library — would be
  // what needs explaining. Setters are captured from the most recently mounted tree, so the live
  // tree must be the last root mounted before update sampling (see `prepare`).
  {
    let renders = 0;
    const setters: Array<(v: number) => void> = [];
    const Cell = ({ i }: { i: number }) => {
      const [v, set] = useState(0);
      setters[i] = set;
      sink = v;
      renders++;
      return null;
    };
    const children = keyed((i) => h(Cell, { key: i, i }));
    libs.push({
      name: "React useState (control)",
      fine: true,
      control: true,
      App: () => h("div", null, children),
      update: (i, v) => setters[i](v),
      renders: () => renders,
      reset: () => (renders = 0),
    });
  }

  // --- React Context (naive baseline: one value object → every consumer re-renders) ---
  // Intentionally naive, but not gratuitously slow: children are built once (a real provider
  // receives them from its parent), so an update re-renders the provider and its 50 consumers and
  // nothing else. The 50-number copy stays — `setState(next)` with a fresh array IS the immutable
  // write a naive app makes (~50 ns); mutating state instead would not be naive-honest, it would be
  // wrong. Same "live tree mounted last" invariant as the control row.
  {
    const Ctx = createContext<readonly number[]>([]);
    let renders = 0;
    let current: number[] = keyed(() => 0);
    let setArr: ((next: number[]) => void) | null = null;
    const Cell = ({ i }: { i: number }) => {
      sink = useContext(Ctx)[i];
      renders++;
      return null;
    };
    const children = keyed((i) => h(Cell, { key: i, i }));
    const Store = () => {
      const [arr, set] = useState(current);
      setArr = set;
      return h(Ctx.Provider, { value: arr }, children);
    };
    libs.push({
      name: "React Context",
      fine: false,
      App: () => h("div", null, h(Store)),
      update: (i, v) => {
        const next = current.slice();
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

// ---------------------------------------------------------------------------------------------
// Measurement. Samples are taken in interleaved rounds (see BenchPage) so every library sees the
// same distribution of machine state — turbo decay, heap growth, background-tab noise — instead
// of one library always going first. Each sample times a large batch so it sits far above
// `performance.now()`'s ~100µs clamp; we report the median and IQR across samples.
// ---------------------------------------------------------------------------------------------

export const UPDATE_SAMPLES = 31;
export const UPDATE_BATCH = 800; // updates per sample: the bare-useState control does ~4.7µs/op, so 400 sat under the 2 ms floor
export const MOUNT_SAMPLES = 21;
export const MOUNT_BATCH = 32; // N-component mounts per sample (≥5 ms; 8 quantised mount to 12.5µs steps)
export const DISCARD_ROUNDS = 2; // first rounds of each phase are thrown away
const MIN_SAMPLE_MS = 2; // ≥20× a 100µs clock clamp; below this the number is quantisation, not timing

// LOAD-BEARING: `flushSync` here is what makes the re-render count honest for every library. A sync
// commit flushes passive effects synchronously, so libraries that subscribe in `useEffect` (Jotai
// does, with no catch-up render) are fully subscribed before the first update is measured. Under a
// concurrent render they'd report 0 re-renders and silently miss the update — a broken measurement,
// not a better score.
function mount(App: () => ReactNode): Root {
  const root = createRoot(document.createElement("div"));
  flushSync(() => root.render(h(App)));
  return root;
}

/** Per-library sampling state, kept across interleaved rounds. */
export type Sampler = {
  lib: Lib;
  rerenders: number;
  live: Root | null;
  k: number;
  updates: number[]; // ms per update, one entry per kept sample
  mounts: number[]; // ms per mount, one entry per kept sample
};

/** Exact re-render count for one update, warm both paths, and leave a live tree for update sampling. */
export function prepare(lib: Lib): Sampler {
  const r0 = mount(lib.App);
  lib.reset();
  flushSync(() => lib.update(0, -1));
  const rerenders = lib.renders();
  r0.unmount();
  if (rerenders < 1) throw new Error(`${lib.name}: an update did not render inside flushSync`);
  // Mount warmup BEFORE the live tree: rows that capture setters from the latest mount need the
  // live tree to be the last root mounted before update sampling begins.
  for (let w = 0; w < MOUNT_BATCH; w++) mount(lib.App).unmount();
  const s: Sampler = { lib, rerenders, live: mount(lib.App), k: 1, updates: [], mounts: [] };
  for (let w = 0; w < UPDATE_BATCH; w++) flushSync(() => lib.update(++s.k % N, s.k));
  return s;
}

function assertResolvable(lib: Lib, elapsedMs: number): void {
  if (elapsedMs < MIN_SAMPLE_MS)
    throw new Error(
      `${lib.name}: a ${elapsedMs.toFixed(2)} ms sample is below clock resolution; raise the batch size`,
    );
}

/** One batched update sample (ms per update). Guards that every update rendered inside flushSync. */
export function sampleUpdate(s: Sampler): number {
  const { lib } = s;
  lib.reset();
  const t0 = performance.now();
  for (let i = 0; i < UPDATE_BATCH; i++) flushSync(() => lib.update(++s.k % N, s.k));
  const elapsed = performance.now() - t0;
  if (lib.renders() < UPDATE_BATCH)
    throw new Error(
      `${lib.name}: ${lib.renders()} renders for ${UPDATE_BATCH} updates — not synchronous under flushSync`,
    );
  assertResolvable(lib, elapsed);
  return elapsed / UPDATE_BATCH;
}

/** One batched mount sample (ms per N-component mount). */
export function sampleMount(s: Sampler): number {
  const roots: Root[] = [];
  const t0 = performance.now();
  for (let i = 0; i < MOUNT_BATCH; i++) roots.push(mount(s.lib.App));
  const elapsed = performance.now() - t0;
  for (const root of roots) root.unmount();
  assertResolvable(s.lib, elapsed);
  return elapsed / MOUNT_BATCH;
}

/** Tear down the live tree once update sampling is over (before any mount rounds). */
export function endUpdates(s: Sampler): void {
  s.live?.unmount();
  s.live = null;
}

function quantile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stats(samplesMs: number[]): Stat {
  const s = samplesMs.map((x) => x * 1000).sort((a, b) => a - b);
  return { median: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75) };
}

export function finish(s: Sampler): LibResult {
  void sink;
  return {
    name: s.lib.name,
    fine: s.lib.fine,
    control: s.lib.control === true,
    metrics: { rerenders: s.rerenders, update: stats(s.updates), mount: stats(s.mounts) },
  };
}
