// Live-heap-per-request budget (ADR 0016): a few KB per request, near hand-wired DI.
// Authoritative run is via `bench` in a sandbox; this is runnable standalone with --expose-gc.
// A "request" = a fresh scope that resolves an op (with a data dep) and builds a resource, kept live.
const { createScope, data, operation, resource, tag } =
  await import("../packages/core/src/index.ts");
if (!globalThis.gc) {
  console.error("run with --expose-gc");
  process.exit(1);
}

// Module-level definitions (created once, as in real apps); scopes are per-request.
const n = data({ label: "n", initial: 0 });
const doubled = operation({ label: "doubled", depends: { n }, run: ({ n }) => n * 2 });
const store = resource({ label: "store", factory: () => ({ rows: [] }) });

const request = () => {
  const scope = createScope();
  scope.controller(n).set(1);
  scope.controller(doubled).run();
  scope.controller(store).resolve();
  return scope;
};

const N = 20000;
const live = new Array(N);
globalThis.gc();
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < N; i++) live[i] = request();
globalThis.gc();
const after = process.memoryUsage().heapUsed;
const perReq = (after - before) / N;
if (live[0] === undefined) throw new Error("unreachable"); // keep `live` retained

const BUDGET = 4096; // a few KB
console.log(`live heap per request: ${perReq.toFixed(0)} B   (budget <= ${BUDGET} B)`);

// Second figure (informative only, no gate yet): a request that also does one tagged
// run. Kept open while the run settles, like a per-flow binding held for the request.
const zone = tag({ label: "zone", default: "base" });
const liveTagged = new Array(N);
globalThis.gc();
const beforeTagged = process.memoryUsage().heapUsed;
for (let i = 0; i < N; i++) {
  const scope = createScope();
  scope.controller(n).set(1);
  liveTagged[i] = {
    scope,
    flight: scope.run(doubled, { tags: [zone("us")] }),
  };
}
globalThis.gc();
const afterTagged = process.memoryUsage().heapUsed;
const perReqTagged = (afterTagged - beforeTagged) / N;
if (liveTagged[0] === undefined) throw new Error("unreachable"); // keep retained
console.log(`METRIC heap_tagged_per_req=${perReqTagged.toFixed(0)}`);

process.exit(perReq <= BUDGET ? 0 : 1);
