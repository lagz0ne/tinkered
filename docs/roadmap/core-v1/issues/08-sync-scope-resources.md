# 08: Sync scope resources + cleanup

**What to build:** `resource({ label, depends, factory })` (default `target:"scope"`) with a sync factory — cached identity (one build), owner-bound deps, per-instance `cleanup` on close, and a `get()`-before-resolve `NotResolved` error. A cached sync resolve returns the value **without** allocating a promise (fast path, ADR 0016).

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] two resolves return the same instance; factory ran once
- [ ] cleanup runs on close
- [ ] `get()` before resolve → `NotResolved`
- [ ] cached sync resolve = 0 promises (bench lane)
