# 16: Opt-in React span emission

**Status: REVERTED post-v1.** Built (markers via a new core `scope.event()`), then removed: the markers
only re-labeled work core already spans and captured no React-only facts (component identity, suspend/
commit), so they were near-redundant. The useful version needs an observation redesign (pending spans
are invisible today — core records a span only on close) — left for a dedicated design pass. See
`../PROGRESS.md`.

**What to build (original):** hooks emit their own observation marker spans for component-level activity (a component read resource X, ran op Y), via a new core `scope.event(name, attributes)`. **Off by default** (enabled via `<ScopeProvider emit>`; inherited by `<SessionProvider>`). Behavior-neutral: results are identical on or off (ADR 0030, mirrors core's behavior-neutral observation).

Scope note: markers are **root** `manual` spans tagged with the work's label (a distinct span per call), not nested _under_ the resolved work's span — the adapter emits after `resolve()` and has no handle to the work's span, and exposing core span ids to nest was judged out of scope for v1 emission.

**Blocked by:** 15

**Status: REVERTED** (see the header + `../PROGRESS.md`). The acceptance criteria below are **historical**
— the feature was built to them, then removed.

- [x] ~~with emission off, no React-added marker spans appear~~ (historical)
- [x] ~~with emission on, a `react.resource`/`react.resolve` marker appears, tagged with the work's label~~ (historical)
- [x] ~~rendered results identical on/off; `scope.event` never escapes a throwing clock/export, no-op when off/closed~~ (historical)
