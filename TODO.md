# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.
Core ticket detail + reset recipes: `docs/roadmap/core-v1/PROGRESS.md`.
React ticket detail + reset recipes: `docs/roadmap/react-v1/PROGRESS.md`.

## Now — react v1 (`@tinker/react`)

A thin React adapter over `@tinker/core` (ADR 0030–0033). Land in order; each ticket is a
tracer bullet with one decisive browser-mode behavior test. Gate each with
`scripts/ticket-react.sh <NN> "<title>"` (tags `react/r<NN>`). Detail:
`docs/roadmap/react-v1/issues/NN-*.md`.

- [x] **r01 — Browser harness + async fixture.** DONE (tag `react/r01`, commit `fdf1ac4`): a Suspense
      tree resolves in real chromium when the deferred fixture settles — no timers; `vp check` +
      workspace tests green.
- [x] **r02 — `<ScopeProvider>` + `useScope`.** DONE (tag `react/r02`, commit `0a36e80`): reads the
      Handle; `create=` closes once on unmount; no-provider raises `NoProvider`. Under astra review.
- [x] **r03 — `useData` reactive read.** DONE (tag `react/r03`, commit `532e5eb`): external set re-renders;
      object snapshot keeps identity across a parent re-render; clean unmount. Reviewed (astra).
- [x] **r04 — `useController` write.** DONE (tag `react/r04`, commit `a7c0954`): controller write re-renders a
      reader; write-only component's render count unchanged after an external set. Under astra review.
- [x] **r05 — `useData` selector + `isEqual`.** DONE (tag `react/r05`, commit `3920c7f`): unrelated field
      change → no re-render; slice change → re-render; custom `isEqual` suppresses a new-but-equal slice. Under review.
- [x] **r06 — `useResource` sync value.** DONE (tag `react/r06`, commit `2b4a326`): renders a sync resource
      value with no Suspense boundary (no suspend); returns core's exact cached instance. Under review.
- [x] **r07 — `useResource` async + Suspense.** DONE (tag `react/r07`, commit `70bd131`): fallback→value on
      settle; a re-render while pending keeps the factory build count at 1 and Suspense still resolves (ADR 0032). Under review.
- [x] **r08 — `useResource` failed build → boundary.** DONE (tag `react/r08`, commit `99e6b86`, SHIP): rejected
      build surfaces to the error boundary; core makes a rejected build **sticky** at the owner (kept edges → cascade;
      cleared on release/close) so a Suspense retry doesn't loop; react delegates; gate rebuilds core dist first.
- [x] **r09 — `useResolve` success.** DONE (tag `react/r09`, commit `4c58513`, SHIP): idle→pending→success;
      run-sequenced (only the latest publishes — deterministic out-of-order regression); `resolve` returns awaitable `Promise<void>`.
- [x] **r10 — `useResolve` error + `reset`.** DONE (tag `react/r10`, commit `4fdac97`, SHIP): rejection stays local
      (no boundary throw); reset from success AND error clears full state; reset-during-pending drops the late result.
- [x] **r11 — `<SessionProvider>` lifecycle.** DONE (tag `react/r11`, commit `6bf0856`, SHIP): unmount force-closes
      (defer→cancelled); write shadowed; a changed parent never exposes the old session (paired parent+session guard).
- [x] **r12 — `target:"session"` sharing.** DONE (tag `react/r12`, commit `3f56214`, SHIP): one instance per
      provider (two readers under one provider share; siblings distinct); scope-target shared across siblings.
- [x] **r13 — StrictMode double-mount.** DONE (tag `react/r13`, commit `74a2a57`, SHIP): under `<StrictMode>` two
      sessions created, discarded one closed (creates-closes==1), live session read with no Disposed.
- [x] **r14 — `useRelease` + retry.** DONE (tag `react/r14`, commit `43042ce`, SHIP): retry (release + boundary reset)
      rebuilds a failed resource green; releasing a cell reverts it + notifies readers.
- [x] **r15 — `useSpans` read.** DONE (tag `react/r15`, commit `55efa3c`, SHIP): snapshot read of span history — op +
      resource spans surface when observation on; empty when off. (Not push-reactive: core has no span subscription.)
- [~] **r16 — Opt-in React span emission — REVERTED post-v1** (commit `85f2ae8`). Was built (markers via a new core
  `scope.event()`) then removed: near-redundant with core's own work spans, and captured no React-only facts. The
  useful version (observe a resolve's PENDING stage / per-component lifecycle) needs an observation redesign — see
  `docs/roadmap/react-v1/PROGRESS.md`. Only r08's core change (sticky rejected build) remains; core re-validated.
- [x] **r17 — v1 validation milestone.** DONE: react size 3.3 KB gzip (cap 10) ✓; cast-free README + `examples/basic.tsx` ✓;
      full seam green in browser (40 tests) ✓; core re-validated — mutation 77.47% (≥60), size 15.4 KB (cap 30), all
      `validate.mjs` lanes PASS. **@tinker/react v1 complete — all 17 tickets astra-reviewed to SHIP.**

## Shipped — core v1 (complete)

All tickets tagged; reset to any tag if a slice needs redoing. Detail in
`docs/roadmap/core-v1/PROGRESS.md`; budgets in `budgets.md`; teardown history in `teardown-redesign.md`.

- **t01–t18** — packaged scope, data (read/write/watch), operations, tags, sessions, structured close,
  sync/async resources + targets, outcome hooks + `session(fn)`, single-node + cascade release,
  observation, presets, static meta.
- **lt1–lt4** — teardown/lifetime redesign: converged `ctx.defer(end)` + `ctx.signal` (ADR 0024),
  reverse-registration LIFO close (ADR 0026), `close()` returns a `Result` never throws (ADR 0027),
  and the pivot — **`close()` is a shutdown MODE, not a wished outcome** (ADR 0028): forced (default)
  aborts + rolls resources back, graceful commits; reality-only reducer; the wish/severity machinery
  deleted. Accepted v1 limitations in ADR 0029.
- **t19 — v1 validation.** Release gate `pnpm validate` (`scripts/validate.mjs`); a regression fails
  it. All lanes green: size 15.1 KB, promises 0 sync / 5 async, heap 3.9 KB/req, mutation 77.45%,
  complexity 8, CRAP 8.73, cast-free examples, pure universal bundle, deep chains 10k+ safe.
  Wall-clock timing lanes (`bench/*.mjs`) run via `bench` in a sandbox.

## Housekeeping

- `scratch/` (the pre-package prototype) has been deleted. A few older ADRs (0009–0015) still mention
  `scratch/tinker.ts` in their Consequences as historical record of the prototype the decision came
  from — left intact as provenance; the real implementation is `packages/core/src/index.ts`.
