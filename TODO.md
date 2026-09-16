# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.

## Now — clock v1 (first ambient capability on `@tinker/core`)

An ambient `Clock` on every `ctx`, Effect's default-service model, swapped by a `TestClock`
(ADR 0034). Core change (`packages/core/src/index.ts`); land in order; gate each with
`scripts/ticket.sh <NN> "<title>"` (tag `core/t<NN>`) then astra-review to SHIP.
Detail + reset recipes: `docs/roadmap/clock-v1/PROGRESS.md`.

- [x] **t20 — Ambient clock plumbing + reads + TestClock.** DONE (tag `core/t20`, commit `6c3610f`;
      under astra review). Gate green: `vp check` 0 errors, 194 core + 38 react tests pass, size 17.7 KB
      gzip (cap 30). Added `Clock` type, `systemClock`,
      `Scope.Options.clock?`, a layer `clock` inherited from the parent (like `obs`), and thread
      `clock` into op + resource ctx + `EMPTY_CTX`; add `makeTestClock({ now })` (`currentTimeMillis`,
      `currentTimeNanos`, `advance`, `setTime`).
      **Verify:** op reads `clock.currentTimeMillis()` → returns `1000` under
      `createScope({ clock: makeTestClock({ now: 1000 }) })` (no `Date` mock); default ≈ `Date.now`;
      session inherits parent clock (like `obs`, no override); nanos consistent with millis.
      `vp check` + `vp run -r test` + `core#size` green.
- [ ] **t21 — `sleep` on TestClock (virtual time).** `sleep(ms)` schedules against virtual now;
      `advance(ms)` resolves due sleeps; signal aborts a pending sleep.
      **Verify:** `await clock.sleep(1000, signal)` unsettled before `advance`; `advance(1000)` resolves
      it; abort before `advance` rejects with the signal reason and drops the wake. Deterministic (no timers).
- [ ] **t22 — `sleep` on systemClock (real time) + cancellation.** Real `setTimeout` honoring signal.
      **Verify:** aborting the signal rejects promptly (no full-duration wait); a forced `close()` while an
      op awaits a long `sleep` aborts it, the run settles `cancelled` (defer sees `cancelled`), `close()`
      resolves a `cancelled` `Result` (ADR 0028).
- [ ] **t23 — Validation milestone (SHIP).** **Verify:** `pnpm validate` all lanes green (size cap,
      mutation ≥60 run isolated, cast-free examples, pure universal bundle); README +
      `packages/core/examples/basic.ts` show the clock cast-free.

## Shipped — archived

Both v1 milestones are complete. Full ticket detail, budgets, and reset recipes live in the
durable trackers (this list is just the pointer):

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
