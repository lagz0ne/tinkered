# 0038 `tags` on a call open a child session for that run (ambient, not a shallow overlay)

Date: 2026-09-17. Status: accepted. Amends: 0022 (invocation `tags`). Refines: 0037 (inline run),
0012 (tag lookup), 0013/0018 (owner-context).

## Context

ADR 0022 gave an invocation a `tags` field, implemented as a **shallow overlay**: the bindings
were visible only to that operation's own tag reads (`resolveDep` with an overlay). A subflow
called from the body did not see them, and a resource built during the run never did. That
contradicts what a tag is — **ambient** metadata read through the layer chain (ADR 0012) — and
it silently breaks the natural use: "run this flow with a different logging backend / token /
tenant", where the value must reach the resources that belong to the flow.

A resource cannot honor a per-call overlay: it is built once per owner. A **session** is the
layer a flow owns, and a session-target resource is built per session. So "ambient for this
flow" already has a mechanism; the overlay was a second, weaker one.

## Decision

`tags` on a call means **open a child session bound with those tags, run inside it, close it
when the run settles** — for `scope.run(op, { tags })`, `scope.run(inline, { tags })`, and a
subflow call `deps.op.run({ tags })` alike. It is sugar over the existing primitive:

```ts
scope.run(importJob, { input: file, tags: [logBackend(fileSink)] });
// ≡ scope.session({ tags: [logBackend(fileSink)] }, (s) => s.run(importJob, { input: file }))
```

- **Reach:** the run's own tag reads, every subflow it calls, and every **session-target**
  resource built for the flow see the tags through the layer chain. **Scope-target** resources
  are unchanged — built at the root (ADR 0018), never per call.
- **Lifetime:** the session is the run's: `defer` hooks registered by the run and by its
  session-target resources settle when the run settles (ADR 0026 LIFO); the run's outcome is the
  session's outcome (ADR 0017/0028); a forced close of the parent cascades into it.
- **Cost:** one session create + close per tagged call (≈ 1 µs today). A call without `tags`
  takes the current path plus one `call.tags` check. Measured at landing (core/t26, in-container
  alternating A/B on one pinned core): `op` 78 → 90 ns, `run` 88 → 101 ns — the path does strictly
  less work than before (the old overlay seeding is gone), so the residual is code layout, not
  work; core/t27 owns recovering it and setting floors. A hot loop does not pass tags per call;
  it binds them once on a session.
- **A tagged call is always async.** A session closes asynchronously (`close()` resolves a
  `Result`, ADR 0027), so `run(x, { tags })` returns `Promise<Awaited<T>>` even when the body is
  sync — typed that way on the overload, no sync fast path. Accepted deliberately: a per-flow
  binding is an I/O-shaped use, never a hot sync loop.
- **The shallow overlay is removed** (`TagOverlay` and the overlay parameters on
  `tagFind`/`tagAll`/`tagRequired`/`resolveDep`/`buildDeps`). One meaning of `tags`.

## Consequences

- A tag can be bound at exactly three levels and they compose the same way: scope, session, and
  a tagged call (which is a session). `mergeConfig`-style readers (`.all`, ADR 0035) see all three.
- A session-target resource is **per flow** under a tagged call. To share the enclosing session's
  instance, bind the tag on that session instead of on the call. (Glossary: `tagged call`.)
- ADR 0037's inline run takes the same invocation object as a declared run — `{ input?, tags? }` —
  so the three forms read identically.
- Tests that relied on the overlay being shallow (a subflow NOT seeing the caller's tags) invert.

## Alternatives rejected

- **Keep the shallow overlay** — reads as ambient, is not; a resource in the flow ignores it.
- **Propagate the overlay through subflows and resource builds** — a cached resource would
  freeze the first caller's overlay; dishonest.
- **Drop `tags` from calls, sessions only** — correct and simplest, but the per-flow value
  (a token, a sink) is common enough that the shorthand pays for itself; the shorthand IS the
  session form, so nothing new is introduced.
