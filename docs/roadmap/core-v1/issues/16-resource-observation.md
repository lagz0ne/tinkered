# 16: Resource observation

**What to build:** resource-resolve spans that link to the **caller's** span even though the resource's owner differs, balanced async open/close, and preserved value identity (no proxy) so lazy clients keep working. (ADR 0009 behavior-neutral)

**Blocked by:** 09, 10, 15

**Status:** ready-for-agent

- [ ] a shared resource used by two commands links a `used` edge to each caller span
- [ ] the resource value identity is unchanged (no wrapping)
- [ ] async resource spans open and close balanced
