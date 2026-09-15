# 0029 Teardown v1: accepted limitations

Date: 2026-09-15. Status: accepted. Records the edges the teardown/lifetime work (core/lt1–lt4)
deliberately leaves unspecified or unhandled for v1, and why each is safe to ship. Complements
[0026](0026-teardown-is-reverse-registration-lifo.md), [0027](0027-close-returns-a-result-and-never-throws.md),
[0028](0028-close-is-a-shutdown-mode-not-a-wished-outcome.md); bug/requirements ledger
`docs/roadmap/core-v1/teardown-redesign.md`.

## Context

Nine-plus adversarial-review rounds hardened the core teardown contract (close never throws; a
reality-only reducer of `failed > cancelled > success`; forced/graceful shutdown with POSIX-style
resource rollback/commit; real descendant-failure collection at any depth). A handful of edges remain.
Rather than grow bespoke machinery for each — the very pattern that produced the pre-redesign bug
swarm — v1 states them as known, bounded limitations. Each preserves the headline guarantees (close
resolves a truthful `Result`, cleanups run once, no lost error, no hang for cooperative work).

## Decision — accepted for v1

1. **No graceful→forced escalation.** A second/later `close()` returns the in-flight close's `Result`;
   the FIRST call's mode wins. There is no SIGTERM→SIGKILL upgrade of an in-flight graceful close.
   _Safe because:_ forced is the default (non-hanging); graceful is a deliberate opt-in to wait. Force
   from the start if a hang is a concern. Escalation reintroduced mode-loss bugs for marginal value.

2. **A layer's OWN owned-work failure that surfaces only AFTER its child cascade does not roll the
   already-closed children back.** Children close first (ADR 0026), before owned work is joined; a
   failure discovered during that join cannot retro-force children that already committed. _Safe
   because:_ a body failure, or an owned-work / descendant failure ALREADY recorded when the cascade
   starts, DOES force rollback (incl. an earlier sibling's failure, re-checked per child). Only a
   same-layer owned op that fails strictly after the cascade is missed — a narrow race.

3. **Async self-reentry is a footgun, not handled.** A `defer` that `await`s and THEN calls
   `close()`/`release()` on its OWN (or an ancestor's) scope can hang — the sync teardown guard only
   spans the callback's synchronous part. _Safe because:_ awaiting your own scope's full close from
   within its own teardown is circular by construction; distinguishing an async-internal caller from an
   external concurrent close needs `AsyncLocalStorage`, which this design deliberately avoids. Sync
   self-reentry IS acked (Q3, no hang).

4. **Cooperative cancellation is required.** A forced close aborts `ctx.signal` and JOINS in-flight
   owned work; work that honors the signal stops promptly. JS cannot force-terminate a pending promise,
   so a unit that ignores its abort and never settles stalls the join. _Safe because:_ that is the
   caller's bug (like a process ignoring SIGTERM), the same class as any other userland non-cooperation.

5. **Some teardown ORDER is unspecified (not correctness).** Cross-owner `TeardownFailed.causes`
   ordering; a resource-cleanup vs a dependency released by a SEPARATE later `release()`; a superseded
   mid-(async-)build's late cleanup relative to the release cascade. In every case both cleanups run
   exactly once and every error is reported — only their relative ORDER can vary.

6. **Adversarial userland objects are out of scope.** A thenable/`Proxy` whose accessor throws or
   mutates across reads, returned from a cleanup or body (ADR 0027 scope note). Reading it can surface
   its throw or leak an unhandled rejection — the caller's bug; the library does not defend it.

7. **Async dependency-cycle detection has a gap.** A cycle first touched only AFTER an `await` inside an
   async factory is not detected. Note; no coverage. Synchronous cycles ARE detected.

8. **Build-time recursion has finite (unrealistic) stack ceilings.** TEARDOWN, release and session
   nesting are iterative/async and survive very deep trees (>10k — invariant 5). But resolving a deep
   SYNC resource _dependency_ chain recurses on the native stack (`buildResource ↔ resolveDep`, ceiling
   ~1k levels), and `flushTree` through deeply nested sessions recurses by tree depth (ceiling ~5k).
   _Safe because:_ both are absurd depths for real dependency graphs / session nesting; the common case
   is shallow. Measured by `bench/deep.mjs`. Convert to explicit-stack iteration only if a real case
   approaches the ceiling.

## Consequences

- These are documented boundaries, not TODOs blocking v1. Any that a real (non-adversarial) use case
  hits gets promoted to a fix with a regression test. Revisit each if it draws real-world complaints.
