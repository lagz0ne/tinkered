# 12: Single-node release

**What to build:** `release()` on a node — data reset (to inherited/initial) and resource cleanup with a fresh generation, so a late success/failure from the released generation cannot affect its replacement. (ADR 0014; frontend affordance)

**Blocked by:** 09, 10

**Status:** ready-for-agent

- [ ] releasing a resource runs cleanup and drops it; a re-resolve rebuilds a new instance
- [ ] a late completion from the released generation is ignored (handshake gate)
- [ ] releasing a data cell resets it and notifies watchers
