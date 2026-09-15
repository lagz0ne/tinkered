# 0032 Resources suspend; operations are imperative

Date: 2026-09-15. Status: accepted. Builds on
[0030](0030-react-is-a-thin-adapter-not-a-store.md).

## Context

Core already splits async work into two kinds: a **resource** is build-once/cached per owner
(query-like — a value you read), and an **operation** is an imperative, effectful command that runs on
each `resolve(input)` and is not memoized (mutation-like — a thing you do). React Query draws exactly
this line between a query (declarative, suspends) and a mutation (imperative, status object). Forcing
both kinds through one hook shape would misrepresent core's own semantics.

`use()` requires a referentially stable promise across renders, or it suspends forever / warns.

## Decision

- **`useResource(handle)` suspends.** It returns the built value; when the build is async it hands the
  promise to `use()`, so a `<Suspense>` fallback shows while pending, and a rejected build throws to the
  nearest error boundary. Read-ish and declarative. Stability of the `use()` promise is delegated to
  core's build-once caching (the same owner+handle yields the same promise), not re-memoized in React.
- **`useResolve(op)` is imperative, never suspends.** It returns `{ resolve, status, data, error, reset }`.
  You call `resolve(input)` from an event handler; `status` (`idle`/`pending`/`success`/`error`) drives
  local UI; errors stay in `error` and do **not** throw to an error boundary. This is the mutation shape.
- **Retry/reset uses `useRelease()`.** A failed resource recovers by resetting the error boundary **and**
  calling `release(handle)` (core drops the failed instance; a re-resolve rebuilds a fresh generation).
  `useRelease()` returns a thin `release(cellOrResource)` over `scope.release`.

## Consequences

- The two hooks read as the two core concepts, so a reader who knows core's resource/operation split
  needs no new model.
- Read errors are declarative (error boundaries); command errors are local (status) — matching where
  each kind of failure is handled in practice.
- If core's resource caching ever returned a fresh promise per `resolve()`, `useResource` would suspend
  forever; that invariant is load-bearing and is asserted by a behavior test.
