# 0062 Random is an ambient ctx capability (Effect default-service model)

Date: 2026-09-22. Status: proposed.

## Context

Time was the first hidden source of non-determinism we made testable without
mocks (`clock`, ADR 0034). Randomness is the next one. Code that calls
`Math.random()` or `crypto.randomUUID()` gives a different answer every run, so
a test that touches it must stub a global — the exact pain the ambient clock
removed for time.

The other two candidates are settled and are **not** new capabilities:

- **Config / `process.env`** — tags already carry configuration, and we do not
  encourage deep `process.env` reads in unit bodies, so there is no hidden
  global to fake.
- **`new Date()` for "now"** — covered by the clock: read
  `new Date(clock.currentTimeMillis())`, never bare `new Date()`. A lint, not a
  capability. Timezone stays an explicit value you pass when formatting (as in
  Effect's `DateTime`), not an ambient knob.

That leaves randomness. It sorts into the same **ambient capability** tier as
the clock (ADR 0034): a cross-cutting runtime service on `ctx`, configured once
at the scope, inherited by sessions, never wired via `depends`.

## Decision — follow Effect's default-service Random

- Random is **ambient**: carried on `ctx` next to `signal`, `defer`, `obs`,
  `log`, `clock`. It is NOT a resource and is never wired with `depends`. This
  mirrors Effect, where `Random` is a **default service** always present in the
  runtime, swapped by a seeded test instance.
- Surface = the minimal real need — two reads:
  - `next(): number` — a float in `[0, 1)`, like `Math.random`.
  - `uuid(): string` — a v4-style id, like `crypto.randomUUID`.
- **Simpler than the clock.** Both reads are synchronous: there is no wait, so
  no `AbortSignal` arg and no cancellation. The `EMPTY_CTX` fast path (ADR 0016)
  is untouched — the per-layer empty ctx that already carries the layer's clock
  and signal carries `random` the same way, with no per-build allocation.
- Everything else Effect ships (`nextInt`, `nextBoolean`, `nextRange`, `pick`,
  `shuffle`) **derives from `next()`** and is left out until a real caller asks
  (YAGNI, ADR 0007's "simpler than the precedent"). Where we are simpler: two
  members instead of Effect's full `Random` interface.
- Configured once at the seam: `Scope.Options.random?: Random.Handle`, next to
  `clock?`. Default is `systemRandom` (`Math.random` / `crypto.randomUUID`, both
  universal on web and Node). A session **inherits its parent's random**,
  exactly like `clock` today (`randomFor` returns `parent.random` when there is
  a parent).
- Test seam: `makeTestRandom({ seed })` returns a `Random.Handle` backed by a
  small seeded PRNG (mulberry32). The same seed yields the same `next()`
  sequence **and** the same `uuid()` sequence (the uuid bytes are drawn from the
  same generator), so a test reads a fixed, reproducible stream.
  `createScope({ random: makeTestRandom({ seed: 1 }) })`. No `Math.random` mock,
  no `crypto` stub, no `preset`.

```ts
run: (_deps, { random }) => {
  const id = random.uuid();
  if (random.next() < 0.1) retry();
};

createScope({ random: makeTestRandom({ seed: 1 }) }); // default is systemRandom
```

## Consequences

- Adds one field to `ctx` and one option to the scope, alongside `clock`. No
  new allocation on the empty-ctx fast path (the per-layer empty ctx already
  exists for the clock; it gains one more field).
- Web and server share one code path: `crypto.randomUUID` and
  `crypto.getRandomValues` exist in both modern browsers and Node, so
  `systemRandom` needs no platform branch and stays inside the universal-bundle
  budget (`validate.mjs`).
- The seeded PRNG for `makeTestRandom` is a few lines (a mulberry32 generator);
  its bytes feed both `next()` and `uuid()` so one seed fixes both. The exact
  PRNG output is not a shipped guarantee — tests assert determinism and v4
  shape, never specific bytes (asserting bytes would break on any PRNG swap).
- A follow-up may derive an "ambient id" convention (request ids, entity ids)
  from `random.uuid()` so a test freezes them too. Deferred (YAGNI), recorded so
  we do not grow a second id source by accident.
- The dedicated capabilities/drivers are unaffected.

## Alternatives rejected

- **Random as a resource + preset** — correct but noisy: nearly every unit that
  needs an id would `depends` on it, the wrong grain for a universal capability
  (same reasoning that made the clock ambient, ADR 0034).
- **Full Effect-sized surface now** (`nextInt`, `shuffle`, …) — rejected as
  premature: each member costs tests and mutation coverage for something
  derivable from `next()`. Add on first real demand.
- **A Config ambient capability** — rejected: tags carry configuration and we
  do not read `process.env` deep in bodies, so there is no hidden global to
  swap.
