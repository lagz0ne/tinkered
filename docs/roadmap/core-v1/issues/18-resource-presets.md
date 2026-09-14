# 18: Typed resource presets

**What to build:** a resource `preset` (factory or value) that flows through the normal ownership, caching, generation, and teardown path — a swapped fake behaves like a real resource.

**Blocked by:** 09, 10, 17

**Status:** ready-for-agent

- [ ] a preset resource is delivered to consumers and cleaned up on close like a real one
- [ ] it respects `target`/owner and caching
- [ ] release/generation behave identically to a real resource
