# 09: Async resource builds + close

**What to build:** async factories with a single shared in-flight build per owner, the owner tracking factory work, close joining a late completion, and a generation guard so a build that finishes after close/supersede never publishes. (ADR 0014 generation)

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] concurrent resolves share one in-flight build (factory ran once)
- [ ] `close` awaits an in-flight build (handshake gate)
- [ ] a build completing after close does not populate the layer
- [ ] a superseded generation never publishes
