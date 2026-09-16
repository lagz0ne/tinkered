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
  nearest error boundary. Read-ish and declarative. The `use()` promise must be stable across renders
  **and remounts** (React remounts the suspending reader on a Suspense retry). Stability is delegated to
  core, which builds once per owner and returns the same promise on every `resolve()` — **including a
  rejected build, which is now sticky (cached at the owner until release/close)**, so a retry reuses that
  rejection instead of rebuilding a fresh, never-settling promise (which would hang on the fallback).
  The adapter keeps **no** promise cache of its own: a cache keyed by the reading scope would miss the
  owner (a `target:"scope"` resource read from two sessions) and would go stale on release/close/cascade,
  which core's owner cache already handles. Because react tests load `@tinker/core` from `dist`, the react
  gate rebuilds core first.
- **`useResolve(op, options?)` is imperative, never suspends.** It is shaped like react-query's
  `useMutation`: `{ status, data, error, variables, isIdle, isPending, isSuccess, isError, resolve,
resolveAsync, reset }`. `resolve(input)` fires and forgets from an event handler (the outcome lands in
  state, `variables` is the call); `resolveAsync(input)` also returns the value or rejects, for a handler
  that needs the result; `options.onSuccess/onError/onSettled` fire per run. Errors stay in `error` and do
  **not** throw to an error boundary. (Amended 2026-09-16: was `{ resolve, status, data, error, reset }`
  with `resolve` returning `Promise<void>` — an awaited handle read as a query that runs on first touch.)
- **Options, not more hooks (amended 2026-09-16).** The two shapes users also need are options on the
  existing hooks: `useResource(handle, { suspense: false })` returns a react-query-like
  `{ status, data, error, isPending, isSuccess, isError, refetch }` and never suspends or throws
  (`refetch` releases and rebuilds); `useData(cell, { writable: true })` returns `[value, set]`
  (with a selector, `[slice, set]`). Same subscriptions and caches underneath, one hook per concept.
- **Retry/reset uses `useRelease()`.** A failed resource recovers by resetting the error boundary **and**
  calling `release(handle)` (core drops the failed instance; a re-resolve rebuilds a fresh generation).
  `useRelease()` returns a thin `release(cellOrResource)` over `scope.release`.

## Consequences

- The two hooks read as the two core concepts, so a reader who knows core's resource/operation split
  needs no new model.
- Read errors are declarative (error boundaries); command errors are local (status) — matching where
  each kind of failure is handled in practice.
- Core's sticky rejection is what makes the `use()` promise stable across a Suspense retry's remount; a
  react behavior test pins it — a rejected build under an error boundary must surface the original error
  with exactly one build (a rebuild would hand `use()` a fresh, never-settling promise and hang). Core
  tests pin the lifetime: the sticky rejection clears on release (a re-resolve rebuilds) and is shared at
  the owner across sessions.
