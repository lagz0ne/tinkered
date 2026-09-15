# 0033 React tests run in vitest browser mode

Date: 2026-09-15. Status: accepted. Applies [0003](0003-behavior-tests-only.md) to `@tinker/react`.

## Context

`@tinker/react`'s behavior is React rendering: Suspense boundaries, concurrent commits, StrictMode
double-mount, subscription/teardown timing. Those are exactly the behaviors a DOM shim (`jsdom` /
`happy-dom`) approximates least faithfully — the shim reimplements a subset of the platform and can pass
or fail for reasons a real browser would not. For a state library whose correctness IS its rendering
behavior, testing against an approximation undercuts the behavior-test guarantee (ADR 0003).

## Decision

**React behavior tests run in vitest browser mode** — a real browser via the Playwright provider
(chromium, headless), not a DOM shim. Components render with `vitest-browser-react` (`render` +
locators); interactions use `userEvent` from `@vitest/browser/context`. Tests touch only the package's
`src/index.ts` seam — real providers and hooks, real components, no mocks (ADR 0003).

## Consequences

- A Playwright chromium binary is a required test dependency. It must be installed into the persistent
  user home (not `/usr`) and wired into `vp test` and CI; this is a setup task, not a per-run concern.
- Tests exercise genuine Suspense/concurrent/StrictMode behavior, so a rendering regression fails
  locally the same way it would in a browser.
- Browser-mode runs are heavier than a shim; the package keeps its suite lean and leans on core's own
  (fast, shim-free) suite for non-rendering logic.
