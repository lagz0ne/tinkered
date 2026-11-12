# 0143 useData holds its scope; a new scope mounts the subtree again

Date: 2026-11-12. Status: proposed; it waits
for Duke's pick. Built on the work branch.
Adds to: ADR 0030 (React is a thin adapter)
and ADR 0031 (a session is a React subtree).

## What the user said

Duke, 2026-11-12 02:15: "analyze what might we
do to get closer to the preact performance?"

Duke, 2026-11-11 13:17: "Without changing api".

## Context

The site bench has 50 components. Each reads
its own cell and one shared cell.
Chromium, median, Tinker against Preact Signals:

- one update: 6.4 µs against 4.4 µs;
- a fan-out (one write, 50 renders):
  47.0 µs against 25.0 µs;
- a mount: 123 µs against 88 µs.

The largest part of the gap is one fact:

1. `useData` read the scope from context on
   each render.
2. So React kept a context item on each
   component that calls `useData`.
3. For each sibling that does not render,
   React copies that item and checks it.

Preact Signals reads no context. A signal is a
module value.

## Precedent

- **React, a key resets a subtree.** A new key
  on an element mounts all below it again
  (react.dev, "Resetting state with a key").
- **React, `use(Context)`.** It is the one
  context read that may sit in a condition.
- **Our own providers.** Create mode and
  `SessionProvider` render nothing between two
  scopes (ADR 0031). So their subtree mounts
  again for a new scope already.
- **react-redux, to version 5.** Its
  `<Provider>` said: "does not support
  changing `store` on the fly".

Where the precedent stops:

- react-redux from version 6 takes a new store.
  Its hooks read the context on each render.
- Jotai's `useStore` reads the context on each
  render too.
- So no current library holds its store in the
  component. We do, and the remount rule is
  what we pay for it.

## Decision

1. A `useData` call reads the context in its
   first render only. It holds the result for
   the life of its component.
2. Each provider keys its subtree with what it
   provides. A new scope mounts the subtree
   again.
3. Each render still asks the scope for its
   controller. So a render after the scope
   closed raises `Disposed`, as before.

```ts
const provide = (bound, children) =>
  createElement(ScopeContext.Provider, {
    key: bound.key,
    value: bound,
    children,
  });
```

```ts
function useHeld() {
  const own = useRef(undefined);
  const held = own.current;
  if (held !== undefined) return held;

  const bound = use(ScopeContext);
  if (!bound) raise("NoProvider", { hook });
  return (own.current = { bound });
}
```

## What changes for an app

One case only:

```tsx
<ScopeProvider scope={scope}>
  <Page />
</ScopeProvider>
```

- Before: when `scope` became another scope,
  `Page` stayed and read the new scope.
- Now: `Page` mounts again. Typed text, focus,
  and scroll below it start fresh.

No change for create mode, a starting scope,
or `SessionProvider`.
No name or type in the API changes.

## Cost

Old tree against new, turn by turn.
`benchd` does not run in a cloud session, so no
row is a `bench/queued.sh` row.

- Fan-out, Chromium: 47.2 µs to 40.3 µs.
  Three runs agree (41.4, 40.3, 40.0).
- Fan-out, instructions: 867.2k to 789.1k.
- One update, instructions: 142.3k to 135.9k.
- One update, Chromium: 6.3 µs to 6.1 µs. This
  is inside the noise.
- Mount: no change we can see.
- Size: the adapter grows 104 B minified,
  70 B gzip.

After it, Tinker against Preact Signals is
1.42 for an update and 1.55 for a fan-out.

## Not done

- **Hold the controller too.** Fan-out goes to
  36.6 µs. But a render after the scope closed
  then shows the cell's first value, with no
  `Disposed`. A test now fails for that form.
  It needs a cheap "is open" read on the
  scope. That is a Core change, and Core is at
  its size cap.
- **The other hooks.** `useScope`, `useRun`,
  and `useResource` read the context on each
  render, as before. They are not on the bench
  path.
- **No context at all.** It would equal Preact
  Signals on an update. It needs a new API:
  the scope would not come from a provider.
- **One subscription for each component.**
  Preact Signals does it with a Babel
  transform. It needs a new API.
