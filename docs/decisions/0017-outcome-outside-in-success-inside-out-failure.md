# 0017 Outcome: success declared outside-in, failure bubbles inside-out

Date: 2026-09-14. Status: accepted. Refines: 0011.

## Context

ADR 0011 deferred whether `onOutcome` is a commit protocol or a notification,
and how body / hook / cleanup failures combine. A boundary (a request, a session)
must decide when it _succeeded_ and let inside resources commit or roll back.

## Decision

- **Success is declared outside-in.** The boundary owner signals success when its
  own work finishes — a request handler commits once the response is sent.
  `session(opts, fn)` treats `fn` completing normally as success; `close(outcome)`
  lets the caller pass the outcome explicitly. The outside is the only channel
  that declares success.
- **Failure bubbles inside-out.** A thrown `Error` from the body (or owned work)
  settles the outcome as `failed(cause)` and overrides any success.
- **`onOutcome(o)` is a notification, not two-phase commit.** Each resource
  registers it and receives the settled outcome to commit (success) or roll back
  (failed). It never declares success itself.
- **Failure combination.** The inside `cause` is the primary error. `onOutcome`
  and `cleanup` hooks that throw are collected as secondary (aggregated), never
  swallowed, never retried, and never change the settled outcome. Order:
  `onOutcome` (commit/rollback) then `cleanup` (release), both LIFO,
  collect-and-continue.

## Consequences

- request→response maps cleanly: commit on response finish; a thrown error rolls
  back the transaction.
- Ticket "outcome hooks + session(fn)" implements this; the open question from
  ADR 0011 is closed.

## Scope boundary (single-pass close)

`close` is a single children-first pass (join this layer's body + owned work,
close children, run `onOutcome` then `cleanup`, teardown). This keeps the
per-request hot path lean and dead-lock-free, at two deliberate cost:

- **A failure only rolls back the boundary that owns the failing work and its own
  subtree, bubbling _upward_ to ancestors.** It does not flow _sideways_ into an
  already-closed sibling: a resource on a bare nested `createSession()` child is
  committed on its own terms and is not retro-rolled-back because a _sibling_
  owned-work on the parent later failed. Put transactional resources on the
  boundary that owns them (the `session`), or use a nested `session(fn)` so the
  child settles on its own outcome. Full cross-boundary propagation would need a
  multi-phase close (join subtree → settle → notify → cleanup); rejected as a
  hot-path complexity/perf cost.
- **A session body that awaits its own `close()` is unsupported** (a genuine
  cycle: close joins the body while the body awaits close). It cannot be detected
  without async context (`AsyncLocalStorage` is out — the library targets browser
  and node). A re-entrant `close()` from a teardown hook is safe (returns a
  resolved promise; teardown still runs once).
