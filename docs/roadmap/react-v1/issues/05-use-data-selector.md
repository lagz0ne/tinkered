# 05: `useData` selector + `isEqual`

**What to build:** `useData(cell, selector, isEqual?)` subscribes to a derived slice via the official `use-sync-external-store` with-selector shim; re-renders only when the selected slice changes.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] changing an unrelated field of the cell does **not** re-render a slice subscriber
- [ ] changing the selected slice **does** re-render
- [ ] a custom `isEqual` suppresses re-render for values it treats as equal
