# Where `@tinker/react`'s update microseconds go (2026-09-19)

Question: the playground bench (every competitor at its source-audited best) put one slice update at
~9.0 µs for `@tinker/react` vs ~5.1 µs for bare per-component `useState`. Can we close that?

## Method

Layer probes added as temporary rows to `apps/playground/src/bench/runners.ts` (N=50 components each
on one slice, `flushSync` per update, median of 31 interleaved batched samples, IQR shown). Each row
adds exactly one layer to the previous. Two runs; the deltas below are stable to ~0.1 µs.

| layer                                                    | µs  | delta |
| -------------------------------------------------------- | --- | ----- |
| bare `useState`                                          | 5.1 | —     |
| + React `useSyncExternalStore` over a trivial store      | 6.5 | +1.3  |
| + tinker core write→notify (`controller.set` → watchers) | 6.8 | +0.25 |
| + `ScopeProvider` fibers in the tree                     | 7.4 | +0.6  |
| + the component's `useContext` read of the scope         | 8.6 | +1.2  |
| + `useData`'s `useMemo(…, [scope, cell])`                | 9.0 | +0.3  |

Preact Signals sits on the uSES floor (6.9): no provider, no context read. Jotai avoids uSES
(`useReducer` + `store.sub`) and is **not faster** (8.5) — dropping uSES buys nothing.

## What that means

- **Core is not the cost.** The whole write→notify path is 0.25 µs. Do not chase `writeCell`,
  `flushCell`, or the watcher set for this.
- **The gap is React-side and structural.** uSES (+1.3) and reading the scope from context (+1.2)
  are the price of the scoped-provider model; they are the design, not overhead.
- **Recoverable: the `useMemo`.** Core already memoizes one controller per (scope, cell), so the
  no-selector store can be shared per controller in a `WeakMap` — no hook slot, no deps array per
  render. With a selector the store must stay per component (its `select`/`equal`/memoized slice are
  that component's), held in a `useRef` (one slot, no deps array). `useController` loses its
  `useMemo` for the same reason.

## Change and numbers

`packages/react/src/index.ts`: `useData` no-selector path → shared `rawStore(controller)`; selector
path → `useRef`-held `SelectingStore`; `useController` → `useScope().controller(cell)`.

| bench row (update, median) | before         | after          |
| -------------------------- | -------------- | -------------- |
| `@tinker/react`            | 9.0–9.1        | 8.75 (±2–5%)   |
| Jotai / Preact (unchanged) | 8.1–8.5 / 6.75 | 7.9–8.1 / 6.75 |

~0.3 µs (~3.5%), as the probe predicted. Realistic floor for this architecture ≈ 8.5 µs (Jotai
parity). Reaching `useState` would mean giving up uSES _and_ the provider; the data says the first
half of that trade would not even pay.

Gates: `vp check` clean, 48/48 react tests (vitest browser mode), style census OK, mutation lane in
the commit message. Probe rows were reverted; the shipped bench is unchanged.
