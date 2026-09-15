# 17: v1 validation milestone

**What to build:** the `@tinker/react` bundle has a wired size budget; a `README` with a cast-free 60-second example; the full public seam (`ScopeProvider`, `SessionProvider`, `useScope`, `useData`, `useController`, `useResource`, `useResolve`, `useRelease`, `useSpans`) is exercised through browser behavior tests; all lanes green.

**Blocked by:** 01–16

**Status:** ready-for-agent

- [ ] size budget lane wired and green (ADR 0016 style)
- [ ] a cast-free example type-checks (no `as`, no `!`); README shows install + 60-second example
- [ ] `vp check` + `vp run -r test` (browser mode) green across the package
