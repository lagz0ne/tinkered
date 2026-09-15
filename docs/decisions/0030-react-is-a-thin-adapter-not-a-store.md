# 0030 `@tinker/react` is a thin adapter over core, not a store

Date: 2026-09-15. Status: accepted.

## Context

`@tinker/react` is a new standalone package binding `@tinker/core` to React. The obvious
temptation is to build a React-native store (a Zustand/Recoil-like atom layer, or a Redux-style
reducer + cache). But core already owns everything a store owns: reactive values (`data` cells with
`watch`/`get`), lifetime (`scope`/`session`/`close`), dependency wiring, presets, and observability.
A second store on top would duplicate state, invite tearing between the two copies, and re-solve
problems core already settled.

Core's `DataController` is already exactly React's external-store shape: `watch(listener) -> unsubscribe`
is `subscribe`, `get()` is `getSnapshot`. So the React layer needs no store of its own.

## Decision

**The package is an adapter, not a store.** It adds no state, no cache, no reducer, no query-key. It
decomposes into three established React precedents and borrows their vocabulary:

- **Reactive reads** — Zustand/Jotai pattern: `useSyncExternalStore` over `DataController.watch`/`get`.
  Core is the external store. Selectors use the official `use-sync-external-store` with-selector shim.
- **Scope provision** — react-redux `<Provider store>` / Context DI: the scope `Handle` rides on React
  Context; the nearest `Handle` wins (see [0031](0031-session-lifetime-binds-to-react-subtree.md)).
- **Async** — React Query / `use()` + Suspense boundary (see
  [0032](0032-resources-suspend-operations-are-imperative.md)).

Where we are **simpler** than those libraries: there is one source of truth (the scope), so no
store-sync, no cache invalidation, no `queryKey`. Hooks only subscribe and provide.

## Consequences

- The public seam stays tiny: providers + hooks, no store constructor. Presets/tags/observe are passed
  straight to `createScope` (no test-only API — [0015](0015-preset-is-a-test-only-replacement.md) is
  reused as-is via the provider's `create` mode).
- Tearing is delegated to `useSyncExternalStore`'s guarantees; batching to React 18+ automatic
  batching. No batching layer in v1 (YAGNI); a `batch()` escape hatch is added only if profiling proves
  redundant renders.
- The package depends on core's public seam (`src/index.ts`) only, with `react` as a `peerDependency`
  (`>= 18.3`, developed/tested against 19).
