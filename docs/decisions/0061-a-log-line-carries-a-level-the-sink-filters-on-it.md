# 0061 A log line carries a level; the sink filters on it

Date: 2026-09-22. Status: accepted. Refines: 0009 (observation is behavior-neutral),
0034 (log is an ambient ctx capability), 0058 (a step's log line: core owns the shape, a package
owns the words).

## Context

`ctx.log(message, attributes?)` had one rung. Every line — a `db query`, an `http request`, a
`request failed`, a `publish failed` — reached the sink as the same undifferentiated record
`{ time, message, attributes, span }`. That is enough for a tracing backend, which reads spans, not
lines. It is not enough for the other backend a real deployment wants: one that prints info to a
console in one color, drops debug in production, and pages on error. The sink could not tell those
apart, so a swapped backend was "pure logging only" — the level had to be smuggled into `attributes`
by hand at each call site, or lost.

**The analogy** is pino (and syslog before it): a level is a number, higher is more severe, and the
one filter a logger needs is `level >= threshold`. Names (`debug`, `info`, `warn`, `error`) are a
label over the number; the number is the truth a sink compares. We borrow that scale unchanged
(`debug` 20, `info` 30, `warn` 40, `error` 50) rather than invent a string ordering — a string set
forces a bespoke comparison and a new name for every intermediate rung, both of which pino already
settled by making the level an integer. We take four rungs, not pino's six: `trace` and `fatal` earn
their place when a real caller needs one, not before (YAGNI).

## Decision

1. **A log line carries its level.** `Observe.Log` gains `readonly level: Observe.Level` (a number on
   pino's scale). The four named rungs are the exported `LEVELS` constant, shared by the producer
   methods and any sink: `if (entry.level >= LEVELS.warn) ...`.
2. **The capability grows four methods; the bare call stays.** `ctx.log` is now `Observe.Logger` — a
   callable object. `ctx.log(msg, attrs?)` logs at `info` (so every existing call site is unchanged
   and untyped-migration-free); `ctx.log.debug|info|warn|error(msg, attrs?)` pick a rung. Same
   `(message, attributes?)` signature on each, so a producer never learns a new shape.
3. **Core filters by a numeric threshold; the sink does the rest.** `Observe.Config.level?` is the
   drop threshold: a line below it never allocates an entry or reaches `log`. Absent means keep all
   (our observation is opt-in already, so the honest default is "drop nothing"; pino defaults to
   `info` because pino is always on). Beyond the threshold, filtering and coloring are the sink's job
   — core stays behavior-neutral (ADR 0009). The off path is unchanged: no sink, no allocation.
4. **Words stay with the package; the level is the one new axis core owns.** The reference sink
   (`jsonLines`) writes `level` on every line. The clear failures move to `error` — `http request
failed`, `sync wire failed`, `publish failed`, and the unmapped-handler `request failed`. Normal
   events (`db query`, `http request`, `harness turn`, `mcp tool`, …) stay `info`.

## Consequences

- `Observe.Log` is one field wider; sinks that spread `...entry.attributes` are unaffected, and any
  sink that builds a `Log` by hand (only `reportUnmapped`) now sets `level`.
- A backend swap is finally colorful: the sink reads `entry.level`, and `Config.level` drops debug in
  production with no call-site change.
- The bare `ctx.log("db query", { sql })` is byte-for-byte the same call; the migration is additive.

## Alternatives rejected

- **A string level with a hand-written ordering** — reinvents what pino's integer already solves, and
  needs a new name for every rung between two.
- **A level argument, `ctx.log(level, message, attrs)`** — every existing call site changes, and it
  reads unlike every logger the reader knows.
- **Filter only in the sink, no `Config.level`** — the sink still pays to build and receive every
  dropped debug line; a numeric threshold in core is one integer compare and matches pino.
- **Ship six rungs (`trace`…`fatal`) for parity** — two rungs no caller has asked for; add on demand.
