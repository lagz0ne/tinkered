# 0024 One lifetime API: `ctx.signal` + `ctx.defer`

Date: 2026-09-14. Status: accepted. Supersedes the hook API of 0017 (outcome hooks); refines 0009/0013
(resource ctx); implements 0021 (streaming via `ctx.signal`).

## Context

A resource ctx had two end-hooks — `cleanup(fn)` (release, runs on every close/release) and
`onOutcome(fn)` (commit/rollback, runs on settle with the outcome) — and streaming needed a third,
`signal`, for cancelling in-flight async. Three hooks with subtle when-to-use and timing rules is
real cognitive load. But `cleanup` and `onOutcome` were always the same event — "this is ending" —
split only by whether the callback reads the result; and a cancel is just another way it ends.

## Decision

Every unit ctx (operation and resource) exposes one lifetime pair:

```ts
ctx.signal: AbortSignal
ctx.defer(fn: (end: Scope.End) => void | PromiseLike<void>): void
```

- **`ctx.defer(end => …)` is the single end-hook.** It runs once when the entity's lifetime ends,
  for any reason, and receives why:

  ```ts
  Scope.End =
    | { status: "success" }              // ended cleanly
    | { status: "failed"; error?: unknown } // a failure settled the lifetime
    | { status: "cancelled" }            // closed as a cancellation
    | { status: "released" }             // this resource was reset/rebuilt (not a whole-scope close)
  ```

  It replaces both `cleanup` (a `defer` that ignores `end`) and `onOutcome` (a `defer` that branches
  on `end.status`). One handler does commit/rollback _then_ release, top to bottom — no cross-hook
  ordering to remember:

  ```ts
  factory: ({ pool }, { defer }) => {
    const conn = pool.acquire();
    defer((end) => {
      if (end.status === "success") conn.commit();
      else if (end.status === "failed") conn.rollback();
      conn.release();
    });
    return conn;
  };
  ```

  `defer` is **engine-run**, preserving structured close: children-first, LIFO within a layer,
  awaited, and errors aggregated into `TeardownFailed`. (This is why teardown is NOT put on
  `AbortSignal` listeners, which are unordered, un-awaited, and swallow errors.)

- **`ctx.signal` is the cancel channel**, derived from the same lifetime. It aborts when the owning
  scope/session begins to close (or is cancelled), so in-flight async can stop; hand it straight to
  `fetch`/an LLM SDK. It chains: work under a layer shares the layer's signal, so cancelling a parent
  cancels its subflows and resources.

- **Lifetime by unit kind** (uniform model, natural end-time): an operation's `defer` runs when its
  run settles (success/failed/cancelled); a resource's `defer` runs when its owning layer closes
  (success/failed/cancelled) or when the resource is individually released (`released`).

- **Cancel is clean, not a failure.** Closing as a cancellation aborts `signal` and settles the
  lifetime as `{ status: "cancelled" }`; `defer` sees `cancelled`, so a half-done effect is not
  committed. `Scope.Outcome` (the `close(outcome?)` argument and a layer's settle) becomes
  `success | failed | cancelled`; `Scope.End` adds `released` for the per-resource release path.

## Consequences

- Two lifetime members instead of three hooks; the mental model is "hand off cancellation
  (`signal`) / do something at the end (`defer`)". `cleanup` and `onOutcome` are removed.
- Streaming needs **no new primitive**: a producer is an async operation that write-depends a `data`
  cell, writes it over time, and honors `ctx.signal`; consumers `watch` the cell; done = the resolve
  promise. Cancel is by **closing the producer's owning scope/session** (which aborts its `signal`).
  Releasing a downstream cell only resets that cell — it does not cancel upstream producers (they
  have their own lifetime); a still-running producer may write the reset cell until its scope closes.
- The close/outcome/release machinery (t07–t14) is rewritten: the layer's `cleanups` + `onOutcomes`
  lists collapse to one `defers` list drained once with the settled `End`; each layer owns an
  `AbortController` aborted at close start; `release` runs a resource's `defer`s with `released`.
- Cross-entity ordering changes from a global two-phase (all outcomes, then all cleanups) to
  per-entity `defer` in dependency/LIFO order — each entity sequences its own commit-then-release.
- Breaking ctx change; acceptable pre-v1 (t19 not landed). All `cleanup`/`onOutcome` call sites and
  tests migrate to `defer`.
