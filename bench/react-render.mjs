// Real-React head-to-head: @tinker/react (useData) vs Zustand (create/useStore), in a headless DOM.
//
// The fair "match/beat Zustand" test: N components each subscribed to ONE slice of a store; update one
// slice; measure (a) re-render COUNT (selectivity — ideal 1, both use useSyncExternalStore selectors),
// (b) update latency, (c) mount cost. Both adapters wrap useSyncExternalStore, so this exercises the
// store + hook + reconciler together.
//
// Emits `METRIC name=value`. Run: node --expose-gc bench/react-render.mjs
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { act, createElement: h, Fragment } = await import("react");
const { createRoot } = await import("react-dom/client");
const { create } = await import("zustand");
const { ScopeProvider, useData } = await import("../packages/react/dist/index.mjs");
const { createScope, data } = await import("../packages/core/dist/index.mjs");
const { bench, group, run, summary } = await import("mitata");

const N = 50;

// --- tinker: N independent cells, each component subscribes to one ---
const cells = Array.from({ length: N }, (_, i) => data({ label: `c${i}`, initial: 0 }));
const scope = createScope();
let tRenders = 0;
function TCell({ i }) {
  useData(cells[i]);
  tRenders++;
  return null;
}
const TApp = () =>
  h(ScopeProvider, { scope, children: cells.map((_, i) => h(TCell, { key: i, i })) });

// --- zustand: one store with N slices, each component selects one ---
const useZ = create(() => {
  const o = {};
  for (let i = 0; i < N; i++) o[`k${i}`] = 0;
  return o;
});
let zRenders = 0;
function ZCell({ i }) {
  useZ((s) => s[`k${i}`]);
  zRenders++;
  return null;
}
const ZApp = () =>
  h(
    Fragment,
    null,
    Array.from({ length: N }, (_, i) => h(ZCell, { key: i, i })),
  );

const mount = async (App) => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(h(App)));
  return root;
};

// --- (a) re-render count: update ONE slice, count how many components re-render (ideal 1) ---
const troot = await mount(TApp);
tRenders = 0;
await act(async () => scope.getController(cells[0]).set(1));
const rendersT = tRenders;

const zroot = await mount(ZApp);
zRenders = 0;
await act(async () => useZ.setState({ k0: 1 }));
const rendersZ = zRenders;

// The (a) trees are done: unmount them BEFORE the timed groups. Left mounted, thousands of (b) updates
// on a live tree skew the later (c) mount timings ~2x (measured 2026-09-16), so each group below
// mounts its own trees and measures only what it names.
troot.unmount();
zroot.unmount();

// --- (b) update latency: round-robin update one slice per iter (own trees, mounted for this group) ---
const tlive = await mount(TApp);
const zlive = await mount(ZApp);
let tk = 1;
let zk = 1;
group("update", () => {
  summary(() => {
    bench("update_tinker", async () => {
      const i = tk % N;
      await act(async () => scope.getController(cells[i]).set(++tk));
    });
    bench("update_zustand", async () => {
      const i = zk % N;
      await act(async () => useZ.setState({ [`k${i}`]: ++zk }));
    });
  });
});

// --- (c) mount cost: mount N subscribed components, then unmount (the (b) trees are gone) ---
group("mount", () => {
  summary(() => {
    bench("mount_tinker", async () => {
      const r = await mount(TApp);
      await act(async () => r.unmount());
    });
    bench("mount_zustand", async () => {
      const r = await mount(ZApp);
      await act(async () => r.unmount());
    });
  });
});

const res = await run();
tlive.unmount();
zlive.unmount();

const minOf = (a) => res.benchmarks.find((b) => b.alias === a)?.runs?.[0]?.stats?.min ?? NaN;
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : "NaN");
console.log("\n--- metrics (update/mount = min ns/iter; renders = count, ideal 1) ---");
console.log(`METRIC renders_tinker=${rendersT}`);
console.log(`METRIC renders_zustand=${rendersZ}`);
console.log(`METRIC update_tinker=${fmt(minOf("update_tinker"))}`);
console.log(`METRIC update_zustand=${fmt(minOf("update_zustand"))}`);
console.log(`METRIC update_speedup=${fmt(minOf("update_zustand") / minOf("update_tinker"))}`);
console.log(`METRIC mount_tinker=${fmt(minOf("mount_tinker"))}`);
console.log(`METRIC mount_zustand=${fmt(minOf("mount_zustand"))}`);
console.log(`METRIC mount_speedup=${fmt(minOf("mount_zustand") / minOf("mount_tinker"))}`);
