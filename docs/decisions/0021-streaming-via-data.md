# 0021 Streaming is a producer writing a `data` cell over time

Date: 2026-09-14. Status: accepted (model); detailed design pending. Refines: 0010 (data is the reactive unit).

## Context

We need streaming — the first use case is an **LLM token stream** (a growing answer). Two
shapes were considered: a **pull** primitive (an `AsyncIterable`, `for await`, backpressure,
every discrete chunk) versus **push via `data`** (a producer writes a cell over time,
consumers `watch`). Adding a pull primitive means a new result shape and a third thing
`resolve` can return; push reuses the one reactive unit (`data`) and the existing lifetime
machinery.

## Decision

- **Streaming is push via `data`.** A producer (an operation whose `run` is an async
  generator, or any code) writes a `data` cell as values arrive; consumers `watch` it. No new
  unit, no new pull primitive; the unit count stays 5.
- **It is self-managed.** The cell lives on a scope/session, so `close()`/`release()` stop the
  producer for free. The producer receives an `AbortSignal` (`ctx.signal`); cancellation is a
  clean end, not a failure. The producer runs as owned work (tracked; joined by
  `settled`/`close`).
- **The LLM case is accumulate/latest**, which `data` fits exactly: the cell holds the answer
  "so far", so every watcher — even an async one — sees a consistent latest value and never
  misses a token.
- **Every-discrete-chunk-with-backpressure is out of core.** A single cell holds only the
  latest value, so a "must not drop any chunk, slow consumer" case needs pull; that is a later
  **adapter** (external streams — SSE, `ReadableStream`, DB cursors — are adapter modules that
  push into a `data` cell wired to `ctx.signal`), not core.

## Consequences

- Core adds `ctx.signal: AbortSignal` to operations; streaming needs no API beyond that plus
  the existing `data` + `watch`.
- Reactive UIs render a growing value by watching the cell.
- **Pending detailed design** (a follow-up grill before the ticket): the exact producer
  ergonomics for the LLM case — where the cell comes from (producer-owned vs a passed
  `data.controller`), accumulate-vs-replace semantics, error-vs-cancel on the cell, and how a
  consumer knows the stream ended. Recorded here so the model is fixed; specifics land with the
  streaming ticket.
