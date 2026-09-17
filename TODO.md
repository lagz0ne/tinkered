# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.

## Now — authoring (first-class integrations, ADR 0034 tiers)

Perf pursuit is closed (see archive). Next: production-ready "tinkered-first" components on the reusable
operation/resource model — glue without side effects, testable without mocks, the scope as the single
configuration point. Start with `grill-with-docs` (ADRs in `docs/decisions/`, terms in `docs/glossary.md`).

First integration shipped: **httpClient** as a frame of core primitives (ADR 0035, archived below;
detail in `docs/roadmap/http-v1/PROGRESS.md`). Next candidates for a dedicated integration: server
integration (Hono, maybe Express); app entrypoint with graceful shutdown; TUI app — each starts with
`grill-with-docs`.

- [x] **core/t25 — tests speak the everyday verbs (SCIP-driven).** _Done: tag `core/t25`. 193 inline
      `controller(x).run(...)` / `controller(x).resolve()` chains in core tests rewritten to `scope.run(x, …)` /
      `scope.resolve(x)`; SCIP after: `Scope.run` 21→102 refs, `Scope.resolve` 8→120, `controller` 290→97
      (the 45 remaining `OperationController.run` are held controllers and subflows). 228 tests green, 0 errors,
      census OK; no behaviour change._

**The list is empty.** Next authoring candidates (each starts with `grill-with-docs`): server
integration (Hono, maybe Express); app entrypoint with graceful shutdown; TUI app. Perf follow-up
when the sandbox `bench` is available: `op` parity (budgets.md "Call paths (t27)").

## Shipped — archived

Both v1 milestones are complete. Full ticket detail, budgets, and reset recipes live in the
durable trackers (this list is just the pointer):

- **http v1 (2026-09-17)** — complete: `@tinker/http` as a frame of core primitives (ADR 0035; tags
  `http/t01`…`http/t05`): shared `backend` tag (default `fetchBackend`), per-client `config` tag read
  per call and merged nearest-wins, session-target `client` resource with `execute(request, ctx)`,
  pure endpoint operations (`x.operation`), `filterStatus` slot + `filterStatus/filterStatusOk/
matchStatus`, one child span per attempt + one log line on transport failure, `retry` slot with a
  fixed transient policy and backoff on `ctx.clock`, `preset` as the test seam. Gate: 13 validate
  lanes green (`pnpm validate` now covers http tests/size/cast-free/pure bundle), size 6203 B of
  10240, mutation 69.87 (break 60), 27 seam tests, every ticket lead-reviewed. Detail:
  `docs/roadmap/http-v1/PROGRESS.md`.
- **verbs + inline + tagged calls (2026-09-17)** — core/t24 (`controller`/`resolve`/`run`, ADR 0036,
  mutation 78.57), core/t26 (inline `scope.run({ depends, run }, call?)`, ADR 0037; `tags` on a call
  open a child session, always async, ADR 0038; mutation 78.39; +9 ns on `op` recorded → core/t27).

- **clock v1** — complete and shipped (t20–t23, tags `core/t20`…`core/t23`, ADR 0034): ambient `Clock`
  on every ctx, `makeTestClock` (now/advance/setTime), virtual + real `sleep` with signal abort, forced
  close cancels an in-flight sleep; validation milestone green (validate lanes, mutation 79.13%, cast-free
  README + example). Detail: `docs/roadmap/clock-v1/PROGRESS.md`.
- **perf batch (2026-09-16)** — ctx classes with prototype `signal`, shared obs/trap objects, one record
  lookup per build, lazy deps without a per-build Map (astra SHIP after 4 rounds); cold make+resolve
  3353 → ~715 ns, op run 532 → ~134 ns. Rules: coding-convention "Performance" + census P01–P04.
  Notes: `research/learnings/2026-09-16-core-vs-inferdi.md`.
- **react/store perf vs the field (2026-09-16)** — six-library bench (`bench/react-stores.mjs`,
  `bench/stores-probe.mjs`); tinker first on mount (535 µs) and update (69.5 µs) vs Zustand, Jotai,
  Legend v2/v3, Preact Signals. Landed: per-cell watchers, 3-hook `useData`, data controller record
  fast path, op run path trims (op 134→79 ns), always-valid effective entry (read 9.8→0.54 ns), one eq
  per layer per flush (1000-way fan-out 30→8.4 µs, Zustand 12). Gate 70c7924: validate PASS, mutation 78.52%.
  Notes: `research/learnings/2026-09-16-react-stores.md`.
- **react options (2026-09-16)** — `useResolve` in react-query mutation shape; `useData({ writable })`
  and `useResource({ suspense: false })` as options, not new hooks (ADR 0032 amended).
- **core v1** — complete: packaged scope, data (read/write/watch), operations, tags, sessions,
  structured close, sync/async resources + targets, outcome hooks + `session(fn)`, release +
  cascade, observation, presets, static meta (t01–t18); teardown/lifetime redesign lt1–lt4
  (`ctx.defer`/`ctx.signal`, reverse-registration LIFO, `close()` returns a `Result` and never
  throws, close is a shutdown MODE — ADRs 0024–0029); v1 validation gate green (t19).
  Detail: `docs/roadmap/core-v1/PROGRESS.md`; budgets `budgets.md`; teardown `teardown-redesign.md`.
- **react v1** — complete: `ScopeProvider`/`SessionProvider`, `useScope`, `useData` (+ selector),
  `useController`, `useResource`, `useResolve`, `useRelease`, `useSpans` (r01–r17, all
  astra-reviewed to SHIP; r16 span emission reverted post-v1). Detail:
  `docs/roadmap/react-v1/PROGRESS.md`.
