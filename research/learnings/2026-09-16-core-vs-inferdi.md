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

## Note

`bench/core-vs-effect.mjs` has the same operation-vs-resource fairness quirk, but tinker beat Effect so
decisively (cold dominated by Effect's fiber-runtime build, ~265 µs) that the conclusion holds. Fix it
for tidiness if that session is revisited. See [[core-beats-effect-baseline]].
