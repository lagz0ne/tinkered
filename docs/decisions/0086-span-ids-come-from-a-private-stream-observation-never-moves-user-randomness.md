# 0086 Span ids come from a private stream; observation never moves user randomness

Date: 2026-09-29. Status: accepted. Replaces in part: 0076 §4 ("new ids come from the ambient
`random`"). Keeps: 0009 (observation cannot change results), 0062 (the ambient `random`).
Found by the stack/t04 review.

## Context

ADR 0076 drew span ids from the ambient `random`, so a seeded test would get the same ids every
run. But span ids open before the body runs, from the same stream `ctx.random` reads. With
observation on, a seeded `ctx.random` gave different values than with it off (seed 7: 4 draws
became 18). That breaks ADR 0009: turning observation on must not change a result.

The first cut also cost about 1 µs per observed call (`crypto.randomUUID()` per span, hex built
at open). The user asked for less.

## Decision

1. **Ids draw from a private stream,** never from the stream `ctx.random` reads.
   - `makeTestRandom({ seed })` carries a hidden second generator from the same seed, so seeded ids
     still repeat run to run.
   - Otherwise core seeds its own fast generator on the first observed span. Nothing draws at
     import (Cloudflare Workers refuse random values at global scope).
   - A user's own random is never read for ids.
2. **Hex text is built on first read and cached.** A trace's words are shared by its spans.
3. **A root span's id reuses the low 64 bits of its trace id.** W3C allows it; ids stay unique.
4. Observation off draws nothing and builds nothing.

## Consequences

- `opobs` 184 → 187 ns, "no difference we can see" (N=31); `op`, `opsink`, `oplog` got faster.
- Ids repeat across runs only with `makeTestRandom`; the core README says so.
