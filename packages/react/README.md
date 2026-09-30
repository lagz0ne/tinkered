# @tinker/react

A thin React binding for [`@tinker/core`](../core). It is **not a store** — core already owns
state, reactivity, lifetime, and observability. This package only _subscribes_ and _provides_: it
adds no store, no cache, no reducer, no query-key ([ADR 0030](../../docs/decisions/0030-react-is-a-thin-adapter-not-a-store.md)).

- **Reactive reads** → `useSyncExternalStore` over a cell's `watch`/`get`.
- **Scope provision** → the core `Handle` rides on React Context; the nearest one wins.
- **Async** → resources suspend (`use()` + `<Suspense>`); operations are imperative (a mutation).

## Install

```bash
vp install   # react is a peerDependency (>= 19 — the async path uses use())
```

## 60-second example

`examples/react/basic.tsx` is a cast-free tour. The shape:

```tsx
const count = data({ label: "count", initial: 0 });
const profile = resource({ label: "profile", factory: async () => ({ name: "Ada" }) });

function Counter() {
  const value = useData(count); // reactive read
  const control = useController(count); // write handle (subscribes to nothing)
  return <button onClick={() => control.update((n) => n + 1)}>count {value}</button>;
}

function ProfileCard() {
  return <p>{useResource(profile).name}</p>; // suspends until built
}

function App() {
  return (
    <ScopeProvider create={() => createScope()}>
      <Counter />
      <Suspense fallback={<p>loading…</p>}>
        <ProfileCard />
      </Suspense>
    </ScopeProvider>
  );
}
```

## The seam

- `ScopeProvider` puts a scope on context.
  Pass `scope={handle}` for an app-owned scope,
  or `create={() => createScope()}` to close it on unmount.
- `SessionProvider` opens a child session for its children.
  Unmount force-closes it; resources roll back.
  The nearest handle wins, and writes shadow the parent.
- `useScope` reads the nearest scope handle.
  It raises `NoProvider` outside a provider.
- `useData` reads a cell and updates the view when it changes.
  `useData(cell, selector, isEqual?)` reads a slice.
- `useData(cell, { writable: true })` returns `[value, set]`.
  Add a selector as the second argument for `[slice, set]`.
- `useController` reads a cell's controller for writes.
  A view that only writes subscribes to nothing.
- `useResource` reads a resource's built value.
  Async builds suspend; a failed build throws to the error boundary.
- `useResource(handle, { suspense: false })` returns local query state.
  It has `status`, `data`, `error`, and a flag for each status.
  Its `refetch` releases the resource and rebuilds it.
- `useRun` runs an operation without suspending.
  It has `status`, `data`, `error`, `variables`, and a flag for each status.
  Call `run`, `runAsync`, or `reset`.
  Options accept `onSuccess`, `onError`, and `onSettled` callbacks.
- `useRelease` returns `release(cellOrResource)`.
  Release reverts a cell or drops a resource so a retry rebuilds it.
- `useSpans` reads the scope's span history for an inspector.
  Observation must be on.
- `isError` narrows an unknown error to this package's `NoProvider` error.

## Testing

Behavior tests only, at the `src/index.ts` seam, in **vitest browser mode** (real chromium via
Playwright — [ADR 0033](../../docs/decisions/0033-react-tests-run-in-vitest-browser-mode.md)); no
mocks, no sleeps. Presets flow through `createScope({ presets })` in a `create`-mode provider — no
test-only API.

Tests import `@tinker/core` from its **built** `dist`, so build core first. From the workspace root:

```bash
vp run core#build   # then:
vp run -r test
```

## Promises

This appendix states each behaviour the seam tests pin, one line per promise, grouped by hook.
`node tools/jev/promises.mjs react` is its check: every seam-test title names a line below.

### ScopeProvider

- The subtree uses the exact app-owned scope, which the provider never closes.
- Under StrictMode, create mode leaks no scope and never exposes a closed one.

### useScope

- A hook used with no provider raises NoProvider.

### useData

- A controller write re-renders a separate reader.
- A selector with an options object applies its isEqual.
- An isEqual of always-true never re-renders on cell updates.
- useData with only isEqual reads the raw value.
- The view re-renders only when the selected slice changes.
- A kept slice survives a raw change and two parent re-renders.
- A stable object selector without isEqual keeps its result identity across a parent re-render.
- A new inline selector after a parent re-render shows its output and still follows the cell.
- A swapped-in isEqual applies from the next render.
- A custom isEqual suppresses re-render for a new slice it treats as equal.
- The writable setter keeps its identity across a cell update.
- Reading through a new scope shows the new scope's value.
- Reads a cell and re-renders when it is set externally.
- An unchanged object value keeps its identity across a parent re-render.
- A write after unmount neither updates the removed subtree nor breaks the still-open scope.

### useResource

- A rejected build is not rebuilt on the Suspense retry: the original error shows, one build.
- A re-render while pending reuses one build: the factory runs once and Suspense still resolves.
- resolve() hands back one stable promise per owner, while pending and after settle.
- A query reports its status through one flag at a time.
- A synchronous build reports success at once with suspense:false.
- With suspense:false, a synchronous failure stays local and refetch can rebuild it.
- Reading through a new scope builds in the new scope.
- A synchronous build commits on the first flushed render with no suspend.
- The hook returns the exact instance core cached for the owner.

### useRun

- A failing operation stays in error state and does not throw to an error boundary.
- A handled operation panic stays in error state and the root closes successfully.
- Switching providers clears the previous run state.
- Switching providers drops late results and callbacks; the caller still gets its value.
- Switching operations drops late results and callbacks from the old operation.
- Reset from a success clears status, data, and error.
- Reset from an error clears status, data, and error.
- A run from before reset never overwrites a newer run that settled after it.
- Reset during a pending run drops the late result: state stays idle.
- Switching the operation runs the new one, not the stale one.
- Switching the operation rebinds runAsync to the new one.
- A synchronous operation runs to success with its value.
- runAsync returns the value or rejects with the failure while state tracks both.
- Only the latest run publishes: a stale earlier run that settles later is dropped.
- A run with only onSettled reports success without onSuccess.
- A run with only onSettled reports failure without onError.
- A run with empty options resolves runAsync without callbacks.
- onError and onSettled fire with the failure and the call.

### SessionProvider

- Switching the parent scope never exposes the old session, even if the old parent is closed.
- A session-target resource is one instance per SessionProvider; siblings are distinct.
- A scope-target resource is the same instance across sibling sessions.

### isError

- isError matches a NoProvider error from this package.
- isError rejects a plain error without the asked kind.
- isError rejects values that are not errors.

## Decisions & vocabulary

[ADR 0030–0033](../../docs/decisions/) and the React section of the
[glossary](../../docs/glossary.md).
