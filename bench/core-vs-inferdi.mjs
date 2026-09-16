// Head-to-head microbenchmarks: @tinker/core (built dist) vs InferDI (@inferdi/inferdi 6.x).
//
// InferDI is a real, fast, decorator-free typed DI container (scopes + teardown) — tinker's exact
// domain and a far tougher bar than Effect. Both run with DEFAULT runtime checks on (inferdi's
// advertised numbers are default-mode; `new Container()` is checked). "Proper" wall-clock via mitata;
// decisions key off MIN ns/iter (least host-noise on a busy box).
//
// Emits `METRIC name=value` (min ns/iter):
//   <scenario>_tinker  = tinker min ns/iter (lower is better)        <-- optimization target
//   <scenario>_inferdi = inferdi min ns/iter (the bar to beat)
//   <scenario>_speedup = inferdi/tinker (>1 means tinker is faster)  <-- headline
//
// Run: node --expose-gc bench/core-vs-inferdi.mjs
import { bench, group, run, summary } from "mitata";
import { Container } from "@inferdi/inferdi";

const { createScope, data, resource } = await import("../packages/core/dist/index.mjs");

// Shared graph shape: cfg (value 21) -> doubled (cfg*2) -> store ({ base: doubled }).
// `doubled` is a RESOURCE (built instance), not an operation: an operation dependency is delivered
// as a controller (you call .resolve() yourself), so `store.base` would be a controller and tinker
// would skip the cfg*2 work InferDI actually does. As a resource dep it resolves to the value (42),
// making the graphs equivalent.
// --- tinker definitions (module-level, built once) ---
const cfg = data({ label: "cfg", initial: 21 });
const doubled = resource({ label: "doubled", depends: { n: cfg }, factory: ({ n }) => n * 2 });
const store = resource({
  label: "store",
  depends: { d: doubled },
  factory: ({ d }) => ({ base: d, size: () => 0 }),
});

// --- inferdi roots (built once). cold graph uses `scoped` (fresh per request scope);
//     warm graph uses `singleton` (cached — inferdi's one-`Map.get()` fast path). ---
const coldRoot = new Container()
  .registerValue("cfg", 21)
  .registerFactory("doubled", (r) => r.get("cfg") * 2, ["cfg"], "scoped")
  .registerFactory(
    "store",
    (r) => ({ base: r.get("doubled"), size: () => 0 }),
    ["doubled"],
    "scoped",
  );

const warmRoot = new Container()
  .registerValue("cfg", 21)
  .registerFactory("doubled", (r) => r.get("cfg") * 2, ["cfg"])
  .registerFactory("store", (r) => ({ base: r.get("doubled"), size: () => 0 }), ["doubled"]);
warmRoot.get("store"); // prime the singleton cache

// ---------------------------------------------------------------------------
// `di`: cold per-request resolve of the 3-node graph (fresh instances each request).
// tinker: brand-new scope resolves the leaf. inferdi: child scope off the root resolves scoped leaf.
const tinkerDi = () => createScope().getController(store).resolve().base;
const inferdiDi = () => coldRoot.createScope().get("store").base;

// `di_warm`: resolve an already-constructed singleton graph (a cache hit on both sides).
const warmScope = createScope();
warmScope.getController(store).resolve();
const tinkerDiWarm = () => warmScope.getController(store).resolve().base;
const inferdiDiWarm = () => warmRoot.get("store").base;

// `get1`: read a single already-resolved value (the tightest lookup).
const g1 = createScope().getController(cfg);
g1.get();
const tinkerGet1 = () => g1.get();
const inferdiGet1 = () => warmRoot.get("cfg");

// ---------------------------------------------------------------------------
const scenarios = [
  { key: "di", tinker: tinkerDi, inferdi: inferdiDi },
  { key: "di_warm", tinker: tinkerDiWarm, inferdi: inferdiDiWarm },
  { key: "get1", tinker: tinkerGet1, inferdi: inferdiGet1 },
];

for (const s of scenarios) {
  group(s.key, () => {
    summary(() => {
      bench(`${s.key}_tinker`, s.tinker);
      bench(`${s.key}_inferdi`, s.inferdi);
    });
  });
}

const res = await run();

const minOf = (alias) => {
  const b = res.benchmarks.find((x) => x.alias === alias);
  const stats = b?.runs?.[0]?.stats;
  return stats ? stats.min : Number.NaN;
};
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(4) : "NaN");

console.log("\n--- metrics (min ns/iter; lower is better) ---");
for (const s of scenarios) {
  const t = minOf(`${s.key}_tinker`);
  const e = minOf(`${s.key}_inferdi`);
  console.log(`METRIC ${s.key}_tinker=${fmt(t)}`);
  console.log(`METRIC ${s.key}_inferdi=${fmt(e)}`);
  console.log(`METRIC ${s.key}_speedup=${fmt(e / t)}`);
}
