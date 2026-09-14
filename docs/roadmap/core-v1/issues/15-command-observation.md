# 15: Command / manual observation + hooks

**What to build:** operation-resolve spans and manual `ctx.obs.span`/`ctx.obs.event`/`ctx.log`, with explicitly threaded parents (no ALS), injected timestamps, isolated (throwing) sinks, and independent switches for export / retained-history / logging with bounded-or-off history. Observation off costs one boolean and allocates no units. (ADR 0009)

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] two interleaved gated commands produce a correct parent-linked span tree
- [ ] observation off → no units, no allocation (asserted)
- [ ] a throwing exporter does not fail application work
- [ ] export / history / logging toggle independently; history bounded or off
