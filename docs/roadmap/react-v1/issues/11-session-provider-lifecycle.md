# 11: `<SessionProvider>` lifecycle + nearest-Handle

**What to build:** `<SessionProvider>` creates a child session on mount (effect-created, ref-guarded) and forces-close on unmount; a React subtree's mount lifetime IS a core session lifetime (ADR 0031). Hooks under it resolve against the nearest Handle (the session); above it, the root scope.

**Blocked by:** 04, 07

**Status:** ready-for-agent

- [ ] unmounting the provider forces-closes the session: a session resource's `defer` runs with a rollback end (`cancelled`, ADR 0028)
- [ ] a hook under the provider resolves at the session; the same hook above resolves at the root scope
- [ ] a `data` write made under the session is shadowed and does not leak to the parent scope
