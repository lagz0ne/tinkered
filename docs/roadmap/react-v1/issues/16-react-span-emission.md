# 16: Opt-in React span emission

**What to build:** hooks emit their own observation marker spans for component-level activity (a component read resource X, ran op Y), via a new core `scope.event(name, attributes)`. **Off by default** (enabled via `<ScopeProvider emit>`; inherited by `<SessionProvider>`). Behavior-neutral: results are identical on or off (ADR 0030, mirrors core's behavior-neutral observation).

Scope note: markers are **root** `manual` spans tagged with the work's label (a distinct span per call), not nested _under_ the resolved work's span — the adapter emits after `resolve()` and has no handle to the work's span, and exposing core span ids to nest was judged out of scope for v1 emission.

**Blocked by:** 15

**Status:** ready-for-agent

- [ ] with emission off, no React-added marker spans appear
- [ ] with emission on, a `react.resource`/`react.resolve` marker appears, tagged with the work's label
- [ ] rendered results (values) are identical on and off (behavior-neutral); `scope.event` never escapes a throwing clock/export and is a no-op when off or closed
