// Real-React head-to-head across store libraries: @tinker/react vs Zustand, Jotai, Legend State v2,
// Legend State v3 (beta), Preact Signals. N components each subscribed to ONE slice; update one slice.
// Metrics per lib: re-render count (ideal 1), update latency (min ns), mount+unmount of N (min ns).
// Emits `METRIC <metric>_<lib>=<value>`. Run: node --expose-gc bench/react-stores.mjs
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement: h, Fragment } = await import("react");
const { createRoot } = await import("react-dom/client");
const { bench, group, run, summary } = await import("mitata");

const N = 50;
const libs = {};

// --- tinker ---
{
  const { ScopeProvider, useData } = await import("../packages/react/dist/index.mjs");
  const { createScope, data } = await import("../packages/core/dist/index.mjs");
  const cells = Array.from({ length: N }, (_, i) => data({ label: `c${i}`, initial: 0 }));
  const scope = createScope();
  let renders = 0;
  const Cell = ({ i }) => {
    useData(cells[i]);
    renders++;
    return null;
  };
  libs.tinker = {
    App: () => h(ScopeProvider, { scope, children: cells.map((_, i) => h(Cell, { key: i, i })) }),
    update: (i, v) => scope.controller(cells[i]).set(v),
    renders: () => renders,
    reset: () => (renders = 0),
  };
}

// --- zustand ---
{
  const { create } = await import("zustand");
  const useZ = create(() => Object.fromEntries(Array.from({ length: N }, (_, i) => [`k${i}`, 0])));
  let renders = 0;
  const Cell = ({ i }) => {
    useZ((s) => s[`k${i}`]);
    renders++;
    return null;
  };
  libs.zustand = {
    App: () =>
      h(
        Fragment,
        null,
        Array.from({ length: N }, (_, i) => h(Cell, { key: i, i })),
      ),
    update: (i, v) => useZ.setState({ [`k${i}`]: v }),
    renders: () => renders,
    reset: () => (renders = 0),
  };
}

// --- jotai (default store, no Provider) ---
{
  const { atom, getDefaultStore } = await import("jotai/vanilla");
  const { useAtomValue } = await import("jotai/react");
  const atoms = Array.from({ length: N }, () => atom(0));
  const store = getDefaultStore();
  let renders = 0;
  const Cell = ({ i }) => {
    useAtomValue(atoms[i]);
    renders++;
    return null;
  };
  libs.jotai = {
    App: () =>
      h(
        Fragment,
        null,
        atoms.map((_, i) => h(Cell, { key: i, i })),
      ),
    update: (i, v) => store.set(atoms[i], v),
    renders: () => renders,
    reset: () => (renders = 0),
  };
}

// --- legend state v2 ---
{
  const { observable } = await import("legend2");
  const { useSelector } = await import("legend2/react");
  const state = observable(Object.fromEntries(Array.from({ length: N }, (_, i) => [`k${i}`, 0])));
  let renders = 0;
  const Cell = ({ i }) => {
    useSelector(state[`k${i}`]);
    renders++;
    return null;
  };
  libs.legend2 = {
    App: () =>
      h(
        Fragment,
        null,
        Array.from({ length: N }, (_, i) => h(Cell, { key: i, i })),
      ),
    update: (i, v) => state[`k${i}`].set(v),
    renders: () => renders,
    reset: () => (renders = 0),
  };
}

// --- legend state v3 (beta) ---
{
  const { observable } = await import("legend3");
  const { use$ } = await import("legend3/react");
  const state = observable(Object.fromEntries(Array.from({ length: N }, (_, i) => [`k${i}`, 0])));
  let renders = 0;
  const Cell = ({ i }) => {
    use$(state[`k${i}`]);
    renders++;
    return null;
  };
  libs.legend3 = {
    App: () =>
      h(
        Fragment,
        null,
        Array.from({ length: N }, (_, i) => h(Cell, { key: i, i })),
      ),
    update: (i, v) => state[`k${i}`].set(v),
    renders: () => renders,
    reset: () => (renders = 0),
  };
}

// --- preact signals (runtime integration: useSignals() per component) ---
{
  const { signal } = await import("@preact/signals-react");
  const { useSignals } = await import("@preact/signals-react/runtime");
  const sigs = Array.from({ length: N }, () => signal(0));
  let renders = 0;
  const Cell = ({ i }) => {
    useSignals();
    if (isNaN(sigs[i].value)) renders--;
    renders++;
    return null;
  };
  libs.signals = {
    App: () =>
      h(
        Fragment,
        null,
        sigs.map((_, i) => h(Cell, { key: i, i })),
      ),
    update: (i, v) => {
      sigs[i].value = v;
    },
    renders: () => renders,
    reset: () => (renders = 0),
  };
}

const mount = async (App) => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(h(App)));
  return root;
};

// (a) re-render count: update ONE slice on a mounted tree, count renders (ideal 1). Then unmount.
const renders = {};
for (const [name, lib] of Object.entries(libs)) {
  const root = await mount(lib.App);
  lib.reset();
  await act(async () => lib.update(0, 1));
  renders[name] = lib.renders();
  root.unmount();
}

// (b) update latency on live trees (own trees for this group).
const live = {};
const counters = {};
for (const [name, lib] of Object.entries(libs)) {
  live[name] = await mount(lib.App);
  counters[name] = 1;
}
group("update", () => {
  summary(() => {
    for (const [name, lib] of Object.entries(libs)) {
      bench(`update_${name}`, async () => {
        const k = ++counters[name];
        await act(async () => lib.update(k % N, k));
      });
    }
  });
});

// (c) mount cost: mount N subscribed components, then unmount.
group("mount", () => {
  summary(() => {
    for (const [name, lib] of Object.entries(libs)) {
      bench(`mount_${name}`, async () => {
        const r = await mount(lib.App);
        await act(async () => r.unmount());
      });
    }
  });
});

const res = await run();
for (const root of Object.values(live)) root.unmount();

const minOf = (a) => res.benchmarks.find((b) => b.alias === a)?.runs?.[0]?.stats?.min ?? NaN;
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : "NaN");
console.log("\n--- metrics (update/mount = min ns/iter; renders = count, ideal 1) ---");
for (const name of Object.keys(libs)) console.log(`METRIC renders_${name}=${renders[name]}`);
for (const name of Object.keys(libs))
  console.log(`METRIC update_${name}=${fmt(minOf(`update_${name}`))}`);
for (const name of Object.keys(libs))
  console.log(`METRIC mount_${name}=${fmt(minOf(`mount_${name}`))}`);
