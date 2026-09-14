# 12: Single-node release

**What to build:** `release()` on a node — data reset (to inherited/initial) and resource cleanup with a fresh generation, so a late success/failure from the released generation cannot affect its replacement. (ADR 0014; frontend affordance)

**Blocked by:** 09, 10

**Status:** ready-for-agent

- [ ] releasing a resource runs cleanup and drops it; a re-resolve rebuilds a new instance
- [ ] a late completion from the released generation is ignored (handshake gate)
- [ ] releasing a data cell resets it and notifies watchers
- [ ] the superseded-generation guard fires without a close: an in-flight build released mid-flight never publishes, and a newer build supersedes it (this is the criterion deferred from t09, which had no open-layer supersede path — t09 review by astra)
- [ ] `builds` deletion is identity-checked and generations distinguish old vs new builds so a settling old build cannot drop or clobber its replacement (t09 review note)
