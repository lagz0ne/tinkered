# 06: Sessions + inheritance + copy-on-write

**What to build:** `createSession`; data and tags read through the parent chain; a parent write is seen by a child **until** the child shadows it; a child write shadows locally (parent unchanged); nested watchers fire; warm reads are O(1) via an effective-cell cache that invalidates correctly when a nearer shadow appears. (ADR 0018 bubbling; ADR 0016 O(1) read built in here, not retrofitted)

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] child inherits parent data + tags
- [ ] parent write visible pre-shadow; separate post-shadow
- [ ] warm read does not re-walk the ancestor chain (read-cache probe / bench lane)
- [ ] creating a nearer shadow invalidates the cached effective cell for descendants
