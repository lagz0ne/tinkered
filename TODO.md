# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.

## Now — clock v1 (first ambient capability on `@tinker/core`)

An ambient `Clock` on every `ctx`, Effect's default-service model, swapped by a `TestClock`
(ADR 0034). Core change (`packages/core/src/index.ts`); land in order; gate each with
`scripts/ticket.sh <NN> "<title>"` (tag `core/t<NN>`) then astra-review to SHIP.
Detail + reset recipes: `docs/roadmap/clock-v1/PROGRESS.md`.

- [x] **t20 — Ambient clock plumbing + reads + TestClock.** DONE + **SHIP** (tag `core/t20`, commit
      `0a9a47f`; astra-reviewed, 3 rounds). Gate green: `vp check` 0 errors, 196 core + 38 react tests,
      size 17.6 KB gzip (cap 30). Added `Clock` type, `systemClock`, `makeTestClock` (millis/nanos/
      advance/setTime), `Scope.Options.clock?`, a layer `clock` inherited from the parent (like `obs`),
      threaded `clock` into op + resource ctx + a per-layer empty ctx (`emptyCtxFor`).
      **Verify:** op reads `clock.currentTimeMillis()` → returns `1000` under
      `createScope({ clock: makeTestClock({ now: 1000 }) })` (no `Date` mock); default ≈ `Date.now`;
      session inherits parent clock (like `obs`, no override); nanos consistent with millis.
      `vp check` + `vp run -r test` + `core#size` green.
- [x] **t21 — `sleep` (testClock virtual + systemClock).** DONE + **SHIP** (tag `core/t21`, commit
      `aee9954`; astra-reviewed, 2 rounds). `sleep(ms, signal?)` on `Clock`; testClock schedules virtual
      waiters woken in time order by `advance`/`setTime`, `sleep(0)` resolves immediately, abort drops the
      waiter + cleans its listener; systemClock uses real `setTimeout` with abort cleanup. Fixed census T02
      to allow `.sleep(`. 200 core tests, size 17.9 KB.
- [x] **t22 — `sleep` cancellation via forced close (integration).** DONE (tag `core/t22`, commit
      `6355916`, test-only). A forced `close()` aborts an in-flight `clock.sleep(60_000, signal)`; the
      run's `defer` sees `cancelled` and `close()` resolves a `cancelled` `Result` (ADR 0028). 201 core
      tests green. (systemClock real-timer abort path already tested in t21.) astra review batched with
      tinkered-51's perf refactor — pending their commit-range ping.
- [x] **t23 — Validation milestone (SHIP).** DONE + **SHIP** (tag `core/t23`, commit `425b1cd`; the
      perf batch aee9954..425b1cd astra-reviewed 4 rounds to SHIP). `pnpm validate` all deterministic
      lanes PASS (size 18.4 KB gzip, promises 0/5, deep OK, live heap 2567 B, CRAP, cast-free examples,
      universal bundle); mutation 79.13% run isolated; 207 core + 38 react tests; style census OK.
      README `@tinker/core` clock section + `packages/core/examples/basic.ts` `stamp` op show the clock
      cast-free (snippet executed: 1000 → 1500, sleep woken by `advance`).

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
