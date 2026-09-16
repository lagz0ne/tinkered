# Learnings: @tinker/core DI performance vs InferDI

Session `2026-09-16-core-vs-inferdi`. Benchmark `bench/core-vs-inferdi.mjs` (mitata, min ns/iter,
`taskset -c 7`, core built to dist). InferDI `@inferdi/inferdi@6.1.0`, default (checks-on) mode.

## Benchmark fairness gotcha (important)

An **operation** dependency in tinker is delivered as a **controller** (you call `.resolve()`), NOT its
computed value. So `resource({ depends: { d: someOperation }, factory: ({ d }) => d })` gives `d` = a
controller, and the operation's work is skipped. To compare against a DI container's factory graph, make
intermediate nodes **resources** (`depends: { n: cfg }, factory: ({ n }) => n * 2`) — a resource dep
resolves to its value. The first benchmark used an operation and hid the real cold-resolve cost.

## True standing (corrected baseline)

| scenario                                    | tinker          | inferdi | gap             |
| ------------------------------------------- | --------------- | ------- | --------------- |
| di (cold per-request resolve, 2-node graph) | ~6500 ns        | ~195 ns | **~34x behind** |
| di_warm (cached singleton resolve)          | ~21 ns (was 33) | ~9 ns   | ~2.3x behind    |
| get1 (single value read)                    | ~11 ns          | ~9.6 ns | ~1.2x behind    |

## What's cheap / what's not (profiled)

- Observation is OFF by default (`historyMax=0` → `obs.observing=false`); `openSpan`/`obsCtx`/`logFor`
  return `undefined`/shared `OFF_*` constants with no allocation. NOT a hot-path cost.
- `new AbortController()` and `.signal` access are ~free in modern V8 (lazy signal). NOT a cost.
- **`createScope()` ≈ 480 ns**, dominated by `makeLayer` eagerly allocating ~10 Maps + 2 Sets
  (10 `new Map()` ≈ 264 ns alone). This ALONE is 2.5x InferDI's entire cold resolve.
- Each `buildResource` ≈ 500 ns: a fresh `ctx` object (defer/signal/obs/log), `Object.defineProperty`
  per lazy resource dep, and churn across generations/building/resources/dependents Maps. Plus GC
  pressure from all the per-resolve allocation (high variance on cold di).

## Wins so far

- **Controller cache per layer** (run 2, commit 466b808): the public `getController` path always passes
  an undefined observation span, so the (layer, node) controller is stable — memoize it instead of
  allocating fresh closures each call. Warm resolve 33 → 21 ns (−37%). Tiny intrinsic cold regression
  (extra per-layer field+Map). Behavior unchanged (189 core tests green).

## Next levers (cold path, biggest gap)

1. Lazy-allocate the commonly-empty Layer collections (borrowers/builds/watchers/pending/tags/presets/
   children/secondary/defers) — read as empty when null, allocate on first write. Targets the ~264 ns
   Map-allocation cost. Large diff; split carefully. Watch the heap budget (ADR 0016, ≤4 KB/req).
2. Avoid `Object.defineProperty` for lazy deps on the hot path (a plain object + closure is far cheaper
   than a defined accessor); keep enumerability semantics.
3. Reuse/skip the per-build `ctx` allocation when the factory doesn't read defer/signal/obs/log
   (hard to know statically; consider a lazily-populated ctx).

## Results (runs 2–12, all committed, 189 tests green throughout)

Techniques that landed, most impactful last:

- controller cache per layer; lazy build-Maps; **single node-map** `Map<node, NodeState>` (stable-shape
  class — merges ~9 parallel Maps, sets up "trace to close"); lazy presets/tags/watchers.
- **lazy ctx**: a factory with arity < 2 gets a shared `EMPTY_CTX` — no per-build ctx object/closure.
- **2-layer warm cache**: the (already-cached) controller captures the node record, so a warm resolve is
  a field read, not `owner.nodes.get`.
- **lazy AbortController**: cancel state (a flag + reason) decoupled from the signal; the signal is
  materialized only on `ctx.signal` read, so a forced close skips `abort()` event dispatch when no
  factory ever asked for it (−25% lifecycle).
- **lazy deps via Proxy** (not `Object.defineProperty`): get trap ~54 ns vs ~360 ns; preserves the
  `Object.values(deps)` enumeration contract via ownKeys + an enumerable descriptor (cold −35%).
- **O(1) idle fast-close**: an idle scope's `close` skips the async teardown protocol; guarded by a
  global `buildDepth` counter so a close called from inside a running body's sync prefix (work not yet in
  `pending`) still takes the deferred path.

Final standing (clean standalone) vs InferDI: cold make+resolve **915 ns** vs 200 (~4.6x, was ~8x);
warm resolve **15 ns** vs 9 (~1.7x); single read **9.2 ns** vs 9.6 (tied); full request lifecycle
create+resolve+close **3525 → 1208 ns (−66%)**. Remaining cold gap is largely structural (tinker builds
per-resource teardown/observation/cascade machinery InferDI does not).

Deferred: caching operation resolve (idea B) — operations aren't pure (can write cells / take input), so
it needs an opt-in `memo`/`computed` node + an ADR, not auto-caching.

## Note

`bench/core-vs-effect.mjs` has the same operation-vs-resource fairness quirk, but tinker beat Effect so
decisively (cold dominated by Effect's fiber-runtime build, ~265 µs) that the conclusion holds. Fix it
for tidiness if that session is revisited. See [[core-beats-effect-baseline]].

## Run 13 (2026-09-16, after clock v1 landed): object literals with a getter are a ~2.5 µs trap

Clock commit `c2467e1` replaced the shared `EMPTY_CTX` with a per-layer literal `{ ..., get signal() {...} }`
and cold make+resolve silently went **943 → 3706 ns** (bisected across the clock commits with the
standalone probe). Cause: V8 builds an object literal that contains an accessor through slow runtime
calls (`DefineAccessorProperty`) on every creation instead of cloning a boilerplate. The same pattern had
been in `buildCtx` (arity ≥ 2 factories) and the op ctx since the lazy-AbortController change, taxing
paths the bench did not cover.

Fix: three small classes with a prototype `get signal()` (`EmptyCtx`, `ResourceCtx`, `OperationCtx`);
`defer` stays an arrow **field** because bodies destructure `{ defer }` (a method would lose `this`).
Standalone probe (`.autoresearch/probe.mjs`, one scenario per process, `taskset -c 7`):

| scenario                              | before  | after   |
| ------------------------------------- | ------- | ------- |
| cold make+resolve (arity-1 factories) | 3353 ns | 935 ns  |
| cold make+resolve, arity-2 factory    | 3169 ns | 467 ns  |
| op run (warm scope)                   | 532 ns  | 136 ns  |
| create+resolve+close lifecycle        | 4090 ns | 1285 ns |

Rule: **never write `get x()` inside an object literal on a hot path**; use a class (prototype accessor)
or a plain field. Landed in `9e86001` (swept into the t22 commit by a concurrent session).
