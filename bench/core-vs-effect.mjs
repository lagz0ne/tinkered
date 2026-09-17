// Head-to-head microbenchmarks: @tinker/core (built dist) vs Effect (3.x).
//
// "Proper" wall-clock via mitata: warms up, defeats dead-code elimination, and reports robust
// stats. We key decisions off MIN ns/iter — on a busy shared host the minimum is the sample least
// polluted by interference, i.e. the closest estimate of true cost. mitata also reports allocation
// bytes/iter (needs --expose-gc), emitted as a near-deterministic secondary signal.
//
// Emits `METRIC name=value` lines (last block) for the autoresearch loop:
//   <scenario>_tinker  = tinker min ns/iter (lower is better)   <-- optimization target
//   <scenario>_effect  = effect min ns/iter (the bar to beat)
//   <scenario>_speedup = effect/tinker (>1 means tinker is faster)  <-- headline
//
// Run: node --expose-gc bench/core-vs-effect.mjs
import { bench, group, run, summary } from "mitata";
import { Context, Effect, Layer, ManagedRuntime, Ref } from "effect";

const { createScope, data, operation, resource } = await import("../packages/core/dist/index.mjs");

// ---------------------------------------------------------------------------
// Scenario `di`: cold resolve of a 3-node dependency graph (config -> doubled -> store).
// tinker: fresh scope resolves the leaf resource. effect: build+provide the Layer, run, finalize.
// Both construct the whole graph per iteration (no cross-iteration memoization) — a fair cold DI.
// ---------------------------------------------------------------------------
const cfg = data({ label: "cfg", initial: 21 });
const doubled = operation({ label: "doubled", depends: { n: cfg }, run: ({ n }) => n * 2 });
const store = resource({
  label: "store",
  depends: { d: doubled },
  factory: ({ d }) => ({ base: d, size: () => 0 }),
});
const tinkerDi = () => createScope().controller(store).resolve().base;

class Cfg extends Context.Tag("Cfg")() {}
class Doubled extends Context.Tag("Doubled")() {}
class Store extends Context.Tag("Store")() {}
const CfgLive = Layer.succeed(Cfg, { n: 21 });
const DoubledLive = Layer.effect(
  Doubled,
  Effect.map(Cfg, (c) => ({ value: c.n * 2 })),
);
const StoreLive = Layer.effect(
  Store,
  Effect.map(Doubled, (d) => ({ base: d.value })),
);
const AppLive = StoreLive.pipe(Layer.provide(DoubledLive), Layer.provide(CfgLive));
const diProgram = Effect.map(Store, (s) => s.base);
const effectDi = () => Effect.runSync(Effect.provide(diProgram, AppLive));

// Scenario `di_warm`: read an already-resolved singleton, each side on its warm/fast path.
// tinker: same scope, resource primed once -> a memoized cache hit. effect: a prebuilt
// ManagedRuntime (layer built + memoized once) -> runSync just re-runs the program. This is the
// comparison Effect is actually designed for (build the runtime once, reuse it per request).
const warmScope = createScope();
warmScope.controller(store).resolve();
const tinkerDiWarm = () => warmScope.controller(store).resolve().base;

const warmRuntime = ManagedRuntime.make(AppLive);
warmRuntime.runSync(diProgram);
const effectDiWarm = () => warmRuntime.runSync(diProgram);

// ---------------------------------------------------------------------------
// Scenario `rw`: hot state write+read on a shared instance (set a new value, read it back).
// tinker: data controller set/get. effect: Ref set/get (two runSync — Effect's wrap-everything tax).
// ---------------------------------------------------------------------------
const cell = data({ label: "cell", initial: 0 });
const rwCtl = createScope().controller(cell);
let ki = 0;
const tinkerRw = () => {
  rwCtl.set(++ki);
  return rwCtl.get();
};

const ref = Effect.runSync(Ref.make(0));
let ke = 0;
const effectRw = () => {
  Effect.runSync(Ref.set(ref, ++ke));
  return Effect.runSync(Ref.get(ref));
};

// ---------------------------------------------------------------------------
// Scenario `derive`: write a source, then read a derived (doubled) value off it.
// tinker: set cfg, run the `doubled` operation. effect: set ref, run a mapped read.
// ---------------------------------------------------------------------------
const dScope = createScope();
const dCfg = dScope.controller(cfg);
const dDoubled = dScope.controller(doubled);
let kd = 0;
const tinkerDerive = () => {
  dCfg.set(++kd);
  return dDoubled.run();
};

const dref = Effect.runSync(Ref.make(0));
const deriveProgram = Effect.map(Ref.get(dref), (n) => n * 2);
let kde = 0;
const effectDerive = () => {
  Effect.runSync(Ref.set(dref, ++kde));
  return Effect.runSync(deriveProgram);
};

// ---------------------------------------------------------------------------
const scenarios = [
  { key: "di", tinker: tinkerDi, effect: effectDi },
  { key: "di_warm", tinker: tinkerDiWarm, effect: effectDiWarm },
  { key: "rw", tinker: tinkerRw, effect: effectRw },
  { key: "derive", tinker: tinkerDerive, effect: effectDerive },
];

for (const s of scenarios) {
  group(s.key, () => {
    summary(() => {
      bench(`${s.key}_tinker`, s.tinker);
      bench(`${s.key}_effect`, s.effect);
    });
  });
}

const res = await run();

// --- METRIC block: min ns/iter per bench + per-scenario speedup (effect/tinker) ---
const minOf = (alias) => {
  const b = res.benchmarks.find((x) => x.alias === alias);
  const stats = b?.runs?.[0]?.stats;
  return stats ? stats.min : Number.NaN;
};
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(4) : "NaN");

console.log("\n--- metrics (min ns/iter; lower is better) ---");
for (const s of scenarios) {
  const t = minOf(`${s.key}_tinker`);
  const e = minOf(`${s.key}_effect`);
  console.log(`METRIC ${s.key}_tinker=${fmt(t)}`);
  console.log(`METRIC ${s.key}_effect=${fmt(e)}`);
  console.log(`METRIC ${s.key}_speedup=${fmt(e / t)}`);
}
