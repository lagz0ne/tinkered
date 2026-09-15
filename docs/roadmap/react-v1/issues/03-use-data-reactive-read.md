# 03: `useData` reactive read

**What to build:** `useData(cell)` reads a cell's value via `useSyncExternalStore` over `DataController.watch`/`get` (ADR 0030). It re-renders when the cell changes and never tears.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] an external `set` (via the test's scope handle) re-renders the component with the new value
- [ ] the snapshot is referentially stable when unchanged (no render loop)
- [ ] unmount unsubscribes (a later `set` does not touch the unmounted component)
