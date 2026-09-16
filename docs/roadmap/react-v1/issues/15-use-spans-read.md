# 15: `useSpans` read

**What to build:** `useSpans()` returns the scope's bounded span history (ADR 0030) — a snapshot read each render (core exposes no span subscription, so it is not push-reactive; the caller arranges its re-renders). Behavior-neutral — reading spans never changes results.

**Blocked by:** 07, 09

**Status:** ready-for-agent

- [ ] spans from a resolved operation and a resolved resource appear in the returned history
- [ ] history is bounded by the scope's `observe.history`; with observation off it is empty and costs nothing
