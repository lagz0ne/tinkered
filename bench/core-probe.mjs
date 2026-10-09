// Standalone core probe: ONE scenario per process (min ns/iter + bytes/iter), pinned to one core.
// usage: taskset -c 7 node --expose-gc bench/core-probe.mjs <cold|create|warm|get1|lifecycle|inferdi_cold|op|opsink|oplog|opobs|opres|hooked|asyncsub|run|cold2|s1_getctl|s2_data|s3_doubled|s4_warm_ctl|inline|tagged|session>
// CORE_DIST=<path to a core dist/index.mjs> measures that build with this probe (bench/ab.sh runs
// one probe against both trees); unset, it measures this tree's build.
// Every scenario is timed in mitata's batch mode: 4096 calls per sample. Left to itself, mitata
// picks batch mode only when the first call takes <= 500 us and a later warm-up call <= 65.5 us
// (mitata 1.0.34 src/lib.mjs lines 133, 135, 177, 185); else it times one call per sample, which
// adds the timer's cost to every sample and leaves out the calls' GC share. A cold first call (V8
// compiling the path), or a GC landing in it, crosses that line at random, so one tree could land
// in either mode. So the probe calls mitata's measure() with both limits lifted (the same call
// bench()/run() make, with run()'s heap reader), and first runs the scenario WARM_CALLS times so V8
// has settled before the timed loop starts. The METRIC line says which mode mitata used.
import { measure } from "mitata";
import { Container } from "@inferdi/inferdi";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getHeapStatistics } from "node:v8";

const WARM_CALLS = 10_000;
const coreDist = process.env.CORE_DIST;

const { createScope, data, resource, operation, tag, extension } = await import(
  coreDist ? pathToFileURL(resolve(coreDist)).href : "../packages/core/dist/index.mjs"
);

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
const sinkScope = createScope({ observe: { log: () => {} } });
const sinkC = sinkScope.controller(op);

const loggingOp = operation({
  label: "op",
  depends: { n: cfg },
  run: ({ n }, { log }) => {
    log("body");
    return n + 1;
  },
});

const loggingC = sinkScope.controller(loggingOp);
const observedC = createScope({ observe: { export: () => {} } }).controller(op);
const runHook = extension({ label: "probe run hook", hooks: { run: (event) => event.next() } });
const hookedScope = createScope({ extensions: [runHook] });
await hookedScope.ready;

const opRes = operation({ label: "opRes", depends: { store }, run: ({ store }) => store.base });
const opResC = opScope.controller(opRes);
opResC.run();

const depCtlOp = operation({
  label: "depCtl",
  depends: { count: cfg.controller },
  run: ({ count }) => count.get(),
});

const depCtlC = opScope.controller(depCtlOp);
depCtlC.run();
const asyncSub = operation({ label: "asyncSub", run: async () => 1 });

const asyncOuter = operation({
  label: "asyncOuter",
  depends: { sub: asyncSub },
  run: async ({ sub }) => await sub.run(),
});

const asyncSubC = opScope.controller(asyncOuter);
const inlineCfg = { depends: { n: cfg }, run: ({ n }) => n + 1 };
const inlineScope = createScope();
const zone = tag({ label: "zone", default: "base" });
const taggedOp = operation({ label: "taggedOp", depends: { n: cfg }, run: ({ n }) => n + 1 });
const taggedScope = createScope();

const taggedDeferOp = operation({
  label: "taggedDeferOp",
  depends: { n: cfg },
  run: ({ n }, ctx) => {
    ctx.defer(() => {});
    return n + 1;
  },
});

const taggedResource = resource({
  label: "taggedResource",
  target: "session",
  depends: { n: cfg },
  factory: ({ n }) => n + 1,
});

const taggedResOp = operation({
  label: "taggedResOp",
  depends: { value: taggedResource },
  run: ({ value }) => value,
});

const sessionScope = createScope();
const writeScope = createScope();
const writeC = writeScope.controller(cfg);
writeC.watch(() => undefined);
let writeValue = 0;

const writeHook = extension({
  label: "probe write hook",
  hooks: { write: (event) => event.next() },
});

const hookedWriteScope = createScope({ extensions: [writeHook] });
await hookedWriteScope.ready;
const hookedWriteC = hookedWriteScope.controller(cfg);
hookedWriteC.watch(() => undefined);
let hookedWriteValue = 0;
const unwatchedScope = createScope();
const unwatchedC = unwatchedScope.controller(cfg);
unwatchedC.watch(() => undefined);
const otherCell = data({ label: "other", initial: 0 });
for (let i = 0; i < 100; i++) unwatchedScope.createSession().controller(otherCell);
let unwatchedValue = 0;
const watchCloseScope = createScope();

const fns = {
  s1_getctl: () => createScope().controller(store),
  s2_data: () => createScope().controller(cfg).get(),
  s3_doubled: () => createScope().controller(doubled).resolve(),
  s4_warm_ctl: () => warmScope.controller(store),
  op: () => opC.run(),
  opsink: () => sinkC.run(),
  oplog: () => loggingC.run(),
  opobs: () => observedC.run(),
  opres: () => opResC.run(),
  depctl: () => depCtlC.run(),
  hooked: () => hookedScope.run(op),
  write: () => writeC.set(++writeValue),
  writehook: () => hookedWriteC.set(++hookedWriteValue),
  writeunwatched: () => unwatchedC.set(++unwatchedValue),
  watchclose: () => {
    const child = watchCloseScope.createSession();
    child.controller(cfg).watch(() => undefined);
    return child.close({ graceful: true });
  },
  asyncsub: () => asyncSubC.run(),
  run: () => opScope.run(op),
  inline: () => inlineScope.run(inlineCfg),
  tagged: () => taggedScope.run(taggedOp, { tags: [zone("us")] }),
  taggeddefer: () => taggedScope.run(taggedDeferOp, { tags: [zone("us")] }),
  taggedres: () => taggedScope.run(taggedResOp, { tags: [zone("us")] }),
  session: () => sessionScope.session(() => 1),
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
const fn = fns[key];
for (let i = 0; i < WARM_CALLS; i++) await fn();

const b = await measure(fn, {
  heap: () => {
    const m = getHeapStatistics();
    return m.used_heap_size + m.malloced_memory;
  },
  warmup_threshold: Infinity,
  batch_threshold: Infinity,
});

// Batch mode counts 4096 ticks per sample, one-call mode one.
const mode = b.ticks > b.samples.length ? "batch" : "one";

console.log(
  `METRIC ${key}_ns=${b.min.toFixed(1)} ${key}_b=${b.heap?.min ?? "-"} avg=${b.avg.toFixed(1)} mode=${mode}`,
);
