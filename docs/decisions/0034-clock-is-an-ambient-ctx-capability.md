# 0034 Clock is an ambient ctx capability (Effect default-service model)

Date: 2026-09-16. Status: accepted.

## Context

We are starting the first production-ready integrations on core. The candidates
split by **ownership** into three tiers:

- **ambient capability** — a cross-cutting runtime service carried on `ctx`
  (`signal`, `defer`, `obs`, `log`), configured at the scope, never wired via
  `depends`.
- **dedicated capability** — a resource you `depends` on (httpClient, db): it has
  its own build/lifecycle.
- **driver** — owns a scope and maps work to sessions (hono, express, app, tui).

Time is the first thing we make first-class, and it is an **ambient** one. Every
unit may need "what time is it" or "wait a bit", and the whole point is to make
time-dependent code testable WITHOUT mocking `Date.now` or timers. Wiring a
`clock` resource through `depends` on nearly every unit is noise, and a per-unit
dependency is the wrong grain for a universal capability.

## Decision — follow Effect's default-service Clock

- Clock is **ambient**: carried on `ctx` next to `signal`, `defer`, `obs`, `log`
  (`Operation.Ctx` at `index.ts:113`, `Resource.Ctx` at `index.ts:140`). It is
  NOT a resource and is never wired with `depends`. This mirrors Effect, where
  `Clock` is a **default service** always present in the runtime, swapped by a
  `TestClock`.
- Surface = Effect's Clock — three reads/one wait:
  - `currentTimeMillis(): number`
  - `currentTimeNanos(): bigint`
  - `sleep(ms: number, signal?: AbortSignal): Promise<void>`
- **Cancellation is explicit.** Effect interrupts `sleep` invisibly through the
  fiber; core cancels through `ctx.signal`, so `sleep` takes the signal as an
  explicit arg: `clock.sleep(ms, ctx.signal)`. This keeps the allocation-free
  arity-skip ctx fast path intact — a bound-to-ctx auto-cancel would force a
  per-unit ctx allocation (ADR 0016). Where we are simpler than the precedent:
  one explicit arg instead of implicit fiber interruption.
- Configured once at the seam: `Scope.Options.clock?: Clock` (`index.ts:264`).
  Default is `systemClock` (`Date.now` / `setTimeout`). A session **inherits its
  parent's clock**, exactly like `obs` today (`index.ts:1703`,
  `obs: parent ? parent.obs : makeObs(options?.observe)`).
- Test seam: `makeTestClock({ now })` returns a `Clock` plus `advance(ms)` /
  `setTime(ms)`. `createScope({ clock: testClock })`, then `testClock.advance(1000)`
  resolves due virtual sleeps. No `Date.now` mock, no fake timers, no `preset`.

```ts
run: (_deps, { clock, signal }) => {
  const t0 = clock.currentTimeMillis();
  await clock.sleep(1000, signal);
};

createScope({ clock: makeTestClock({ now: 0 }) }); // default is systemClock
```

## Consequences

- Adds one field to `ctx` and one option to the scope. A factory that declares no
  ctx param takes a **per-layer** empty ctx (`emptyCtxFor`, allocated at most once
  per layer) that carries the layer's clock and signal — so an injected clock is
  honored even on that fast path, with no per-build allocation. (The prior single
  global empty ctx read real time; a factory that defaults its first param has
  `fn.length < 2` yet still uses `ctx`, so it must see the layer's clock.)
- Observation already has an internal timestamp source (`Obs.clock`,
  `index.ts:794`, default `Date.now`, set via `observe.clock`). v1 keeps the two
  separate; the natural follow-up is to derive `Obs.clock` from the ambient clock
  so `TestClock` also freezes span timestamps. Deferred (YAGNI) — recorded here so
  we do not fork two clocks by accident.
- `currentTimeNanos` derives from `performance.timeOrigin + performance.now()`
  (universal), split into whole-ms + fractional-ns `BigInt` so it never exceeds
  `Number` precision; the test clock's virtual time uses the same conversion. It
  stays inside the universal-bundle budget (`validate.mjs`).
- An aborted `sleep` rejects with the signal's reason; under a forced close the
  in-flight run then settles `cancelled` (ADR 0028) — proven by a t22 test.
- The dedicated capabilities/drivers (httpClient, hono, express, app, tui) are
  unaffected — they stay their own packages/resources.

## Alternatives rejected

- **Clock as a resource + preset** — correct but noisy: nearly every unit would
  `depends` on it, and that is not the grain of a universal capability. Effect's
  own history (Clock as a default service) is the precedent we follow.
- **Auto-cancel `sleep(ms)` bound to the unit's signal** — nicer to type but
  breaks the `EMPTY_CTX` fast path (per-unit ctx allocation). Rejected for the
  perf budget (ADR 0016).
