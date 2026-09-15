# 12: `target:"session"` per-provider sharing

**What to build:** core routes resources by `target` through the nearest Handle (ADR 0031): a `target:"session"` resource is one instance per `<SessionProvider>`; a `target:"scope"` resource is shared app-wide even when first touched inside a session.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] a `target:"session"` resource yields one instance per provider; two sibling sessions get distinct instances
- [ ] a `target:"scope"` resource yields the same instance across sibling sessions
