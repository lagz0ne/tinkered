# 14: Release cascade across owners

**What to build:** a released scope resource cascades to its dependent session instances across sessions, with sibling-session isolation, and edges from a closed session are pruned.

**Blocked by:** 13

**Status:** ready-for-agent

- [ ] releasing a scope resource cascades to dependent instances in each session
- [ ] a sibling session that did not depend on it is unaffected
- [ ] a closed session's dependency edges are removed
