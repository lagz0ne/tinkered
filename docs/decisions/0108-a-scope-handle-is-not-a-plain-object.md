# 0108 A scope handle is not a plain object

Date: 2026-10-08. Status: accepted
(user, 2026-10-08: "should not let users copy that,
that's not a good practice at all").
Uses: 0016, 0028.
Evidence: [the perf case study](../roadmap/perf/CASE-STUDY.md).

## Context

A scope, a session, and a `session(body)` handle
each hold 12 closures today: one per verb.
That costs about 736 B per live handle,
and 803 B per scope open and close.

A class with shared methods removes the closures.
A prototype measured 1,827 → 1,024 B per open and close,
and `benchctl ab` said b is faster: 354 → 279 ms.

Two habits would break with a class:

- Copying a handle with `{ ...scope }`:
  a spread copies own fields, not class methods.
- Pulling out a verb with `const { run } = scope`:
  the verb loses its handle.

No app or package code does either.
One test spreads a root handle
and only reads an own field from the copy.

## Precedent

Built-in objects with hidden state work the same way.

- `{ ...new Map() }` copies no entries.
- `const { get } = new Map()` throws when called.
- An `AbortController`, a `Response`, or a DOM node
  is passed by reference, never copied.

## Decision

- A scope handle is an object you pass, not data you copy.
- Spreading a handle and destructuring its verbs
  are not supported.
- Core builds handles from one class.
  Each verb is a shared method, not a closure per handle.
- `release` stays safe to pass on its own
  (`list.forEach(scope.release)`),
  because callers already do that.

## Consequences

- About 800 B less per scope and session,
  and fewer objects for the garbage collector.
- Code that spread a handle or pulled out a verb fails.
  The TSDoc on the handle type says so.
- Card `core/handle-proto` makes the change
  through the Core lane: `scripts/ticket.sh`,
  `N=61 bench/queued.sh`, and mutation floor 85.
