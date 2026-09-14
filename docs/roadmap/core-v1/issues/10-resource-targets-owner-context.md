# 10: Resource targets + owner-context

**What to build:** `target:"scope"|"session"` — scope resources shared across sessions (owner = root), session resources per-session (owner = requesting layer); deps, tags, and cleanup bind at and bubble from the owner; a scope resource requiring a session-only tag surfaces as `MissingTag`. (ADRs 0013, 0018)

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] one scope-resource instance shared across two sessions
- [ ] a session-resource builds once per session (two sessions → two instances)
- [ ] a scope resource requiring a session-only required tag → `MissingTag`
- [ ] a resource reads its owner-bound tags/data
