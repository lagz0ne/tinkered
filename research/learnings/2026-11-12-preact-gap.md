# The gap to Preact Signals (2026-11-12)

Duke: "analyze what might we do to get closer to the preact performance?"

The bench: `apps/site/src/bench`. 50 components.
Each reads its own cell and one shared cell.
Preact Signals runs as `@preact/signals-react` 3.12.0 with `useSignals(1)`.

## The numbers

Chromium, median, Tinker 0.17.8 against Preact Signals:

- One update: 6.44 µs and 4.38 µs (1.47).
- A fan-out: 47.0 µs and 25.0 µs (1.88).
- A mount: 123 µs and 88 µs (1.41).

A `useState` control with one context: 4.75, 15.3, and 72 µs.

Instructions for one update:

- Preact Signals: 95.4k.
- The control: 114.6k.
- Tinker: 142.3k.
- Jotai: 148.8k.

## Where the gap is

React keeps a `dependencies` object on each fiber that ever read a context.
`createWorkInProgress` copies it for each sibling that does not render.
`propagateParentContextChanges` then walks up from each such sibling.
A render with no context read keeps the object, with an empty list.

So "read the context one time" removes the read and the check.
It does not remove the object.
Only a component that never reads a context has none.

The split of 46.9k instructions, from builds that each remove one cost:

- 27.8k: the context item on each sibling.
- 7.0k: the read and the controller lookup in each render.
- 5.5k: the provider, two more tree levels.
- 6.6k: two subscriptions for each component, and Core's write.

A profile with inlining off gives the same picture:

- react-dom: 8.8 µs for Tinker, 6.2 µs for Preact Signals.
- `createWorkInProgress`: 1,866 ns and 904 ns.
- Core and the adapter: 0.63 µs. The signals code: 0.35 µs.

## What we built (ADR 0143, proposed)

- `useData` reads the context in its first render only.
- A provider keys its subtree. A new scope mounts it again.
- Fan-out: 47.2 µs to 40.3 µs (41.4, 40.3, 40.0 in three runs).
- Instructions: fan-out 867.2k to 789.1k, update 142.3k to 135.9k.

## Two mistakes, and the rules they give

1. **One browser run is not a result.**
   A watcher change showed a mount of 125 µs to 106 µs in one run.
   A second run showed no gain.
   Rule: repeat a Chromium gain, or count instructions, before you report it.
2. **A cache can hide an error.**
   The first form held the controller as well as the scope.
   It was faster (36.6 µs). All 115 tests passed.
   But `scope.controller()` is also the check that the scope is open.
   A render after close showed the first value, where main raises `Disposed`.
   Rule: before you cache a call, list all that the call does.

A precedent to check in the source, not from memory:

- react-redux `<Provider>` refused a new store only up to version 5.
- From version 6 it takes one. Its hooks read the context on each render.
- Jotai's `useStore` reads the context on each render too.

## Not built

- No context at all: 107.5k instructions, equal to Preact Signals in time.
  The scope would not come from a provider. That is a new API.
- One subscription for each component: Preact Signals uses a Babel transform.
- A reducer in place of `useSyncExternalStore`: Duke said no on 2026-11-11.
- A cheap "is open" read on the scope would let the hook hold the controller.
  It is a Core change, and Core is at its size cap.
