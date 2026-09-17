// Head-to-head microbenchmarks: @tinker/core store layer vs Zustand (vanilla) 5.x.
//
// Zustand = a vanilla store + a thin useSyncExternalStore hook; @tinker/react's useData wraps
// useSyncExternalStore over @tinker/core's data controller. So the performance-deciding code on both
// sides is the VANILLA store (get / set / subscribe+notify). This benches that apples-to-apples.
// (A separate real-React re-render benchmark covers the hook/reconciler layer.)
//
// "Proper" wall-clock via mitata (min ns/iter, least host-noise); also alloc bytes/iter. Both stores
// hold `{ v: number }` and each update allocates a fresh object, so the work matches.
//
// Emits `METRIC name=value`:  <scenario>_tinker = tinker min ns/iter (lower better)  <-- target
//                             <scenario>_zustand = zustand min ns/iter (the bar)
//                             <scenario>_speedup = zustand/tinker (>1 means tinker faster)
//
// Run: node --expose-gc bench/react-vs-zustand.mjs
import { bench, group, run, summary } from "mitata";
import { createStore } from "zustand/vanilla";

const { createScope, data } = await import("../packages/core/dist/index.mjs");

// --- tinker store (data cell + a scope controller, created once, like a route-level store) ---
const cell = data({ label: "cell", initial: { v: 0 } });
const ctl = createScope().controller(cell);

// --- zustand vanilla store (created once) ---
const store = createStore(() => ({ v: 0 }));

// Prime one subscriber for the notify1 scenario (attached once; the set fans out to it each iter).
let sink = 0;
ctl.watch(() => void sink++);
store.subscribe(() => void sink++);

// Prime N subscribers for the fan-out scenario.
const N = 1000;
const cellN = data({ label: "cellN", initial: { v: 0 } });
const ctlN = createScope().controller(cellN);
const storeN = createStore(() => ({ v: 0 }));
for (let i = 0; i < N; i++) {
  ctlN.watch(() => void sink++);
  storeN.subscribe(() => void sink++);
}

let kw = 0;
let kn = 0;
const scenarios = [
  // write + notify one subscriber (the reactive core)
  {
    key: "notify1",
    tinker: () => ctl.set({ v: ++kw }),
    zustand: () => store.setState({ v: ++kw }),
  },
  // write + fan out to N subscribers
  {
    key: "notifyN",
    tinker: () => ctlN.set({ v: ++kn }),
    zustand: () => storeN.setState({ v: ++kn }),
  },
  // read current state
  { key: "read", tinker: () => ctl.get().v, zustand: () => store.getState().v },
  // subscribe + immediately unsubscribe (listener churn)
  {
    key: "sub_churn",
    tinker: () => ctl.watch(() => void sink++)(),
    zustand: () => store.subscribe(() => void sink++)(),
  },
];

for (const s of scenarios) {
  group(s.key, () => {
    summary(() => {
      bench(`${s.key}_tinker`, s.tinker);
      bench(`${s.key}_zustand`, s.zustand);
    });
  });
}

const res = await run();

const minOf = (alias) => {
  const b = res.benchmarks.find((x) => x.alias === alias);
  return b?.runs?.[0]?.stats?.min ?? Number.NaN;
};
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(4) : "NaN");

console.log("\n--- metrics (min ns/iter; lower is better) ---");
for (const s of scenarios) {
  const t = minOf(`${s.key}_tinker`);
  const z = minOf(`${s.key}_zustand`);
  console.log(`METRIC ${s.key}_tinker=${fmt(t)}`);
  console.log(`METRIC ${s.key}_zustand=${fmt(z)}`);
  console.log(`METRIC ${s.key}_speedup=${fmt(z / t)}`);
}
