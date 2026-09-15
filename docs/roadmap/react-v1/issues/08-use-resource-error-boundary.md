# 08: `useResource` failed build → error boundary

**What to build:** a rejected async build (or a throwing sync build) surfaces through `useResource` to the nearest React error boundary, not swallowed (ADR 0032).

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] a rejected build renders the nearest error boundary's fallback
- [ ] the thrown value is the resource's real failure (registry error preserved, ADR 0004)
