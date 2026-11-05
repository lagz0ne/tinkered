# 0125 A capsule exports a foreign value as is

Date: 2026-11-05. Status: accepted.
Accepted: Duke, 2026-11-05 11:00 UTC:
"Then we can just export normal components
rather than making it a factory export ...
only make the exports accepting that".
11:02: "we no longer promote component as
resource and no longer need the render
component".
Replaces: 0124. Amends: 0121 section 7.

## What the user said

- 08:27: can a capsule hold a React component
  that is bound to its own data?
- 08:39: what if we can do the foreign
  export, the Panel?
- 09:21: the factory pattern sits on the
  border of React and tinker.
- 11:00: export normal components; the
  capsule is then a module to use anywhere.

## Words

- **foreign export**: a value in a capsule's
  `exports` that is not a unit, such as a
  React component.

## Precedent

- **ES modules.** A module exports any value,
  next to its functions and types.
- **Elm.** A module exposes `view` beside
  `update`; the model stays hidden.
- **Clerk.** The auth library exports
  `<SignedIn>` and `<SignIn/>`: views that
  already know the auth state.

Where ours is simpler:

- No new unit and no React word in Core.
  Core sees an object and copies it.

## Evidence

A scratch proof outside this repo, three
reviewers, 200 panels per variant:

- A component that reads the capsule's cells
  through hooks follows the session it is
  mounted in. 1 build, 1 render per click.
- A component built by a resource from its
  deps follows where the resource is owned.
  Scope target: 200 renders per click, shared
  state. Session target: 200 builds, and it
  writes to the session that built it.
- React Compiler skips a component written as
  `return function Panel(){}` in a factory.
- 0.11.0 writes a mark on every export, so a
  frozen export throws `TypeError`.

## Decision

1. `Capsule.Exports` also takes a foreign
   value (`Capsule.Foreign`): any object but
   an edge. `draft.controller` stays a type
   error, so no write path leaves (ADR 0123).
2. A foreign value is copied as is onto the
   handle and each binding. Its type is kept,
   and the other exports keep theirs.
3. Core never marks, checks, or resolves it.
   Only ops, resources, and cells get the
   capsule mark.
4. A component reaches the capsule's state
   with the hooks on its raw cells and ops:
   `useData(draft)`, `useRun(say)`.
5. `CapsuleMissing` comes from the exported
   units the component touches.
6. `Render` and the renderable resource
   (0124) are gone.

## Lifecycle

- **Data per mount.** Hooks resolve in the
  nearest scope or session (ADR 0031).
- **A param the graph needs** (a room id):
  the component opens its own
  `SessionProvider` with a tag and
  `key={id}`. A new id closes the old session.
- **Suspense goes inside the session.**
  Outside it, StrictMode builds and closes in
  a loop: card `react/strict-session-suspense`.

## Consequences

- `<talk.Panel/>` renders from the handle.
- A component that touches no exported unit
  gets no `CapsuleMissing`.
