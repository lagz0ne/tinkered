# 0124 A renderable resource renders through `Render`

Date: 2026-11-05. Status: superseded.
Accepted: Duke, 2026-11-05 08:49 UTC:
"into @tinker/react".
Replaced by 0125 the same day, before any
release: `Render` is gone.

## What the user said

- 08:27: can a capsule hold a React component
  that is bound to its own data?
- 08:31: the app starts once the scope is
  ready; the capsules decide, not the tree.
- 08:40: what if a resource returns the
  component, read with `useResource`?
- 08:46: one component should resolve it, so
  the call site needs no hook. An auth capsule
  can then export views that know its state.
- 08:51: a param from the app reaches the
  capsule by an op or by a tag.
- 08:52: no change needed for that, but mind
  the lifecycle.

## Words

- **renderable resource**: a resource whose
  value is a React component.
- **`Render`**: the component that resolves a
  renderable resource and draws it.

## Precedent

- **`React.lazy`.** A component is a value
  that loads, behind `<Suspense>`.
- **Solid `<Dynamic component>`, Vue
  `<component :is>`.** One component draws
  another, handed in as a prop.
- **Clerk.** The auth library exports
  `<SignedIn>`, `<SignIn/>`, `<UserButton/>`:
  views that already know the auth state.

Where ours is simpler:

- No new unit. A resource already builds a
  value once per owner.
- The capsule rules hold as they are: the
  check, presets, and exports.

## Evidence

A scratch proof on 0.11.0, outside this
repo: no Core change, 31 tests.

- A renderable resource raises
  `CapsuleMissing` when its capsule is not
  installed. A plain component that reads only
  internal cells does not.
- `preset(talk.panel, …)` swaps the whole
  component in a test.
- An async factory splits code, as
  `React.lazy` does.
- A component as a raw capsule export breaks
  every export's type. So the component rides
  in a resource, not in `exports` itself.

## Decision

1. `@tinker/react` exports `Render`:
   `<Render of={talk.panel} title="Talk"/>`.
2. `of` names the resource. Every other prop
   goes to the built component, typed.
   The component may not use `of` as a prop.
3. `Render` reads `of` as `useResource` does.
   An async build suspends. The built
   component keeps its identity for the
   resource's owner, so it does not remount.
4. A resource that builds no component is a
   type error on `of`.
5. A `session` resource builds one component
   per `SessionProvider`.

## Lifecycle

- **Listen to state.** A bare cell dep is a
  snapshot: a write does not rebuild the
  resource (ADR 0010). The component re-renders
  through its hooks (`useData`). A factory
  that must act on a change watches a
  controller and stops in `ctx.defer`.
- **A param from the app.** A prop that only
  draws stays a prop. A param the cells and
  ops need (a room id) goes into a tag: the
  capsule's component opens its own
  `SessionProvider` with that tag and
  `key={id}`.
- **A new id** closes the old session (its
  cleanup runs) and opens a new one.
- **Unmount** closes the session; its data
  goes with it.
- **Boot.** Only a start hook loads before
  `scope.ready`. A per-id load shows its own
  fallback.
- **Suspense goes inside the session.** With
  `<Suspense>` outside a `SessionProvider`
  whose async session resource suspends,
  StrictMode builds and closes in a loop.
  Card `react/strict-session-suspense`.

## Consequences

- React gains one export, `Render`.
- No change to Core.
