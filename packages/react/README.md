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

| export                                     | what it does                                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ScopeProvider`                            | Puts a scope on context: `scope={handle}` (app-owned) or `create={() => …}` (owned, closed on unmount).                                                                                                            |
| `SessionProvider`                          | Opens a child session for the subtree; **unmount force-closes it** (resources roll back). Nearest `Handle` wins; writes shadow the parent.                                                                         |
| `useScope`                                 | The nearest scope `Handle` (raises `NoProvider` outside a provider).                                                                                                                                               |
| `useData`                                  | Reactive read of a cell; `useData(cell, selector, isEqual?)` reads a slice.                                                                                                                                        |
| `useData(cell, { writable: true })`        | `[value, set]`, a `useState`-like pair; add a selector as the second argument for `[slice, set]`.                                                                                                                  |
| `useController`                            | A cell's read/write controller for writes; a write-only view subscribes to nothing.                                                                                                                                |
| `useResource`                              | A resource's built value; async builds **suspend**, a failed build throws to the error boundary.                                                                                                                   |
| `useResource(handle, { suspense: false })` | No Suspense: react-query-like `{ status, data, error, isPending, isSuccess, isError, refetch }`; `refetch` releases and rebuilds.                                                                                  |
| `useRun`                                   | Run an operation imperatively, react-query mutation shape: `{ status, data, error, variables, isIdle/isPending/isSuccess/isError, run, runAsync, reset }` + `onSuccess/onError/onSettled` options. Never suspends. |
| `useRelease`                               | `release(cellOrResource)` — revert a cell, or drop a resource so a retry rebuilds it.                                                                                                                              |
| `useSpans`                                 | A snapshot of the scope's span history (for an inspector; observation must be on).                                                                                                                                 |
| `isError`                                  | Narrow an unknown error to this package's registry (`NoProvider`).                                                                                                                                                 |

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

## Decisions & vocabulary

[ADR 0030–0033](../../docs/decisions/) and the React section of the
[glossary](../../docs/glossary.md).
