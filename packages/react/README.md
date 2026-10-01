# @tinker/react

A thin React binding for [`@tinker/core`](../core). It is **not a store** — core already owns
state, reactivity, lifetime, and observability. This package only _subscribes_ and _provides_: it
adds no store, no cache, no reducer, no query-key ([ADR 0030](../../docs/decisions/0030-react-is-a-thin-adapter-not-a-store.md)).

- **Reactive reads** → `useSyncExternalStore` over a cell's `watch`/`get`.
- **Scope provision** → the core `Handle` rides on React Context; the nearest one wins.
- **Async** → resources suspend (`use()` + `<Suspense>`); operations are imperative (a mutation).

## Install

```bash
vp install
```

## 60-second example

`examples/react/basic.tsx` is a cast-free example. The shape:

```tsx
const count = data({ label: "count", initial: 0 });
const profile = resource({
  label: "profile",
  factory: () => Promise.resolve({ name: "Ada" }),
});

function Counter() {
  const value = useData(count);
  const control = useController(count);
  const increment = () => control.update((n) => n + 1);
  return <button onClick={increment}>count {value}</button>;
}

function ProfileCard() {
  return <p>{useResource(profile).name}</p>;
}

function App() {
  return (
    <ScopeProvider create={createScope}>
      <Counter />
      <Suspense fallback={<p>loading…</p>}>
        <ProfileCard />
      </Suspense>
    </ScopeProvider>
  );
}
```

## The seam

- `ScopeProvider` supplies an app-owned scope with `scope={handle}`.
  Its `create` form owns the scope and closes it on unmount.
- `SessionProvider` opens a child session for its subtree.
  Unmount force-closes that session.
  Writes stay in the session.
- `useScope` returns the nearest Core handle.
  Without a provider, it raises `NoProvider`.
- `useData(cell)` reads a cell and follows its changes.
  A selector reads part of its value.
- `useData(cell, { writable: true })` returns the value and a setter.
- `useController` supplies writes without subscribing the component.
- `useResource` reads a built resource.
  Async builds suspend; failures reach the error boundary.
- `useResource(handle, { suspense: false })` returns local query state.
  It includes `status`, `data`, `error`, and `refetch`.
- `useRun` runs an operation and reports the latest result.
  It supplies `run`, `runAsync`, `reset`, and result callbacks.
- `useRelease` resets a cell or releases a resource.
- `useSpans` reads the scope's span history when observation is on.
- `isError` checks errors from this package.

## Project keys and reset

Declare a namespace once and reuse its identity.
Use an explicit key when the scope belongs to the app:

```tsx
const project42 = namespace();
const draft = data({ label: "draft", initial: "" });
const profile = resource({
  label: "profile",
  target: "namespace",
  factory: () => ({ name: "Ada" }),
});

function ProjectTools() {
  const reset = useRelease(project42);
  const resetField = () => reset(draft);
  const query = useResource(profile, {
    ns: project42,
    suspense: false,
  });
  return (
    <>
      <button onClick={resetField}>Reset field</button>
      <button onClick={query.refetch}>Refresh</button>
    </>
  );
}
```

`useResource` accepts `ns` with either suspense mode.
The key selects both the read and its refetch.
Changing that option selects the new key on the next render.
`useRelease(key)` selects only the reset key.
An explicit key wins over an inherited session key.

Inside `SessionProvider`, omitted hook keys use its saved namespace head.
A child session inherits that key unless its own `options.ns` replaces it.
Reads still follow Core's full namespace chain.
Reset clears only the chain's first key.
A read may then expose a fallback value or reuse a fallback resource.
Refetch never clears fallback keys to force a new build.

A scope resource is shared across keys.
Reset and refetch still use Core's broad release for that resource.
With no known key, the hooks keep their existing broad release behavior.
Core handles do not expose their ambient namespace.
React cannot infer a key from an app-owned scope alone.
Use explicit hook keys or `SessionProvider` options in that case.
An independent `ScopeProvider` clears any outer React namespace key.

## Form and route lifetimes

A namespace is a reusable key.
Its session owns the temporary state and resources.
Use nested sessions for a route and its form:

```tsx
<ScopeProvider create={createScope}>
  <SessionProvider key="42" options={{ ns: project42 }}>
    <SessionProvider key="form:1">
      <ProjectTools />
    </SessionProvider>
  </SessionProvider>
</ScopeProvider>
```

Inside the form, `useRelease()` resets one field in its session.
Other fields and the form's session stay live.
Change the form key to discard all of that form's local state.
Unmount the route to close its form and route sessions.
Both actions stop owned work and clean session resources.
Returning with the same namespace key starts fresh session state.
Namespace resources remain owned by the root and can be reused.

Session options apply when the session is created.
Changing them for the same parent does not change a live session's reset key.
Remount the provider to apply new options.
Reset callbacks and cell controllers stay stable on ordinary renders.
An explicit resource controller is reused while scope, resource, and key stay the same.

## Testing

Behavior tests only, at the `src/index.ts` seam, in **vitest browser mode** (real chromium via
Playwright — [ADR 0033](../../docs/decisions/0033-react-tests-run-in-vitest-browser-mode.md)); no
mocks, no sleeps. Presets flow through `createScope({ presets })` in a `create`-mode provider — no
test-only API.

Tests import `@tinker/core` from its **built** `dist`, so build core first. From the workspace root:

```bash
vp run core#build
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

- A data write under a session stays local and does not reach the parent scope.
- Switching the parent scope never exposes the old session, even if the old parent is closed.
- A session-target resource is one instance per SessionProvider; siblings are distinct.
- A scope-target resource is the same instance across sibling sessions.

### Namespace reset

- A session refetch keeps sibling and default namespace resources.
- An explicit field reset keeps sibling and default values at the same owner.
- Explicit resource reads and refetch follow the current key on an app-owned scope.
- A nested session inherits its parent's reset key.
- An inner session's explicit key replaces its parent's reset key.
- An explicit reset key overrides the React session's key.
- Changing session options without remounting keeps the live reset key.
- A chain refetch clears its head and reuses its fallback.
- A named session can still refetch a shared scope resource.
- An independent borrowed scope clears an outer session's reset key.
- An independent owned scope clears an outer session's reset key.
- A field reset keeps the form owner, other fields, and hook identities.
- A keyed form reset cancels its work and keeps the route alive.
- Leaving a route cleans its form and returning reuses the project key.

### isError

- isError matches a NoProvider error from this package.
- isError rejects a plain error without the asked kind.
- isError rejects values that are not errors.

## Decisions & vocabulary

[ADR 0030–0033](../../docs/decisions/) and the React section of the
[glossary](../../docs/glossary.md).
