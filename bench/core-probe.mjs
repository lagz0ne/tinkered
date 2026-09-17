// Standalone core probe: ONE scenario per process (min ns/iter + bytes/iter), pinned to one core.
// usage: taskset -c 7 node --expose-gc bench/core-probe.mjs <cold|create|warm|get1|lifecycle|inferdi_cold|op|run|cold2|s1_getctl|s2_data|s3_doubled|s4_warm_ctl>
import { bench, run } from "mitata";
import { Container } from "@inferdi/inferdi";
const { createScope, data, resource, operation } = await import("../packages/core/dist/index.mjs");
const cfg = data({ label: "cfg", initial: 21 });
const doubled = resource({ label: "doubled", depends: { n: cfg }, factory: ({ n }) => n * 2 });
const store = resource({
  label: "store",
  depends: { d: doubled },
  factory: ({ d }) => ({ base: d, size: () => 0 }),
});
const coldRoot = new Container()
  .registerValue("cfg", 21)
  .registerFactory("doubled", (r) => r.get("cfg") * 2, ["cfg"], "scoped")
  .registerFactory(
    "store",
    (r) => ({ base: r.get("doubled"), size: () => 0 }),
    ["doubled"],
    "scoped",
  );
const warmScope = createScope();
warmScope.controller(store).resolve();
const g1 = createScope().controller(cfg);
g1.get();
const twoArg = resource({ label: "twoArg", depends: { n: cfg }, factory: ({ n }, _ctx) => n * 2 });
const op = operation({ label: "op", depends: { n: cfg }, run: ({ n }) => n + 1 });
const opScope = createScope();
const opC = opScope.controller(op);
opC.run();
const inlineCfg = { depends: { n: cfg }, run: ({ n }) => n + 1 };
const inlineScope = createScope();
const fns = {
  s1_getctl: () => createScope().controller(store),
  s2_data: () => createScope().controller(cfg).get(),
  s3_doubled: () => createScope().controller(doubled).resolve(),
  s4_warm_ctl: () => warmScope.controller(store),
  op: () => opC.run(),
  run: () => opScope.run(op),
  inline: () => inlineScope.run(inlineCfg),
  cold2: () => createScope().controller(twoArg).resolve(),
  cold: () => createScope().controller(store).resolve().base,
  create: () => createScope(),
  warm: () => warmScope.controller(store).resolve().base,
  get1: () => g1.get(),
  lifecycle: () => {
    const s = createScope();
    s.controller(store).resolve();
    return s.close();
  },
  inferdi_cold: () => coldRoot.createScope().get("store").base,
};
const key = process.argv[2];
bench(key, fns[key]);
const r = await run({ print: () => {} });
const b = r.benchmarks[0].runs[0].stats;
console.log(
  `METRIC ${key}_ns=${b.min.toFixed(1)} ${key}_b=${b.heap?.min ?? "-"} avg=${b.avg.toFixed(1)}`,
);
