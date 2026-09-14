# 13: Release cascade within one owner

**What to build:** dependency edges recorded with owner identity so releasing a node cascades to its dependents exactly once, preserves upstream nodes, and never replays commands. Verified with chain and diamond fixtures.

**Blocked by:** 12

**Status:** ready-for-agent

- [ ] release B → its dependent A is released exactly once; upstream deps of A untouched
- [ ] a diamond releases the shared dependent exactly once
- [ ] no command is re-run by a cascade
