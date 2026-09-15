# 04: `useController` write

**What to build:** `useController(cell)` returns the cell's full `DataController` (`get`/`set`/`update`/`watch`) for writes, subscribing to nothing itself (ADR 0030).

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] a button calling `set`/`update` re-renders a separate `useData` reader
- [ ] a write-only component (only `useController`) does **not** re-render when the cell changes
