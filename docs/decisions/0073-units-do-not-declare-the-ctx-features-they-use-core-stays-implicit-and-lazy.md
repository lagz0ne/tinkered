# 0073 Units do not declare the ctx features they use; core stays implicit and lazy

Date: 2026-09-29. Status: accepted. Keeps: 0034 and 0062 (ambient services on every ctx).

## Context

During the perf/tagged-close work the user asked whether an operation or a resource should
declare what it uses, for example `useLifecycle: true` for `defer` and the signal, or
`useAmbient: true` for clock, random, and log.
The hope was twofold: a cheaper hot path, and a graph that shows what each unit needs.

A committee (Astra and Fable, three rounds) found:

- Most per-run work is already paid only on first use: the signal, the defer list, `raise`,
  spans and logs when nothing observes, and clock and random (shared references).
- A declaration can remove only the per-run ctx object: an estimated 10–40 ns on `op`, `run`,
  `inline`, and a tagged call's run. Nothing on `session`, `cold`, `warm`, or `create`.
- Declarations cannot prove a tagged call needs no child session: hooks, observation, a panic,
  a close through a captured handle, or a callback stored in a dependency still need one.
- Their best shape was a `uses: ["defer", "signal"]` list beside `depends`, with a migration of
  every package and a new ADR.

Meanwhile the lazy child session reached `tagged` ≈ 200 ns (from 2130) with no declaration:
core grows the session at the first thing that actually needs it.

The user chose (2026-09-29) to skip explicit declarations.

## Decision

The precedent is Go's `context` and copy-on-write: create the costly part at its first use,
never ask the caller to predict it.

- **No unit declares the ctx features it uses.** Every body gets the full ctx, as today.
- **Core pays on first use.** A costly part is built when a body or a rule first needs it.
- **Core never infers use from a function's shape.** `Function.length` guesses fail on rest
  parameters, defaults, wrappers, and `arguments` (the reverted perf/tagged-close cut 3).
  The existing resource rule (a factory with fewer than two parameters gets an empty ctx,
  ADR 0016, 0034, 0063) stays as it is; no new rule of that kind is added.

## Consequences

- No API change and no migration.
- The graph does not show which units use lifetime tools.
- The per-run ctx object (≈10–40 ns, estimated) stays.
  Building `log` and `obs` tools on first read needs no declaration and is a separate card.

## Options considered

- **A `uses` list** (the committee's shape). Rejected: a migration of every package for an
  unmeasured 10–40 ns, while the lazy session already won the large costs.
- **A `lifecycle` marker in `depends`.** Rejected: it enters the ADR 0044 delivery loop and
  moves every body that calls `defer`.
- **Declared ambient services (`useAmbient`).** Rejected: they cost one shared reference each;
  ZIO 2 and Effect settled on keeping them implicit.

Restart if a graph consumer needs per-unit lifetime facts, or the per-run ctx becomes the main
cost of a hot path.
