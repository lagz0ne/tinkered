# 02: `<ScopeProvider>` + `useScope` (both modes)

**What to build:** `<ScopeProvider>` puts a scope `Handle` on React Context; `useScope()` reads the nearest one. Two modes (ADR 0031): `scope={handle}` uses an app-owned scope, `create={() => createScope(opts)}` creates/owns/closes it on unmount. Presets/tags/observe pass straight through `createScope` (no test-only API — ADR 0015 reused).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] a component under `<ScopeProvider scope=>` reads the Handle via `useScope` and calls `getController(cell).get()`
- [ ] `create=` mode fires teardown (an `onClose`/`defer`) exactly once on unmount
- [ ] using a hook with no provider raises a registry error (ADR 0004), not an undefined read
