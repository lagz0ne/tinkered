# 16: Opt-in React span emission

**What to build:** hooks can tag spans/events for component-level activity (a component suspended on resource X, resolved op Y). **Off by default** (zero overhead); enabled via provider config. Behavior-neutral: results are identical on or off (ADR 0030, mirrors core's behavior-neutral observation).

**Blocked by:** 15

**Status:** ready-for-agent

- [ ] with emission off, no React-added spans appear
- [ ] with emission on, component activity appears as spans/events under the resolved work
- [ ] rendered results are identical on and off (behavior-neutral)
