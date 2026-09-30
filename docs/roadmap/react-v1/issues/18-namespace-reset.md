# React namespace reset

The user approved this work on 2026-09-30.
The fixed brief is [the contributor brief](../../contributor-brief.md).
Work in `/home/paseo/next/tinkered-react-namespaces`.
Branch: `react/namespaces`.
Writer: `gpt-6-astra`, reasoning `xhigh`.

## Target

A reset in one project must keep the other project's stored values.
Sessions own form and route cleanup.
Namespaces stay reusable keys, with no close method.
Use Core's existing `releaseNs` and session close rules.
Core source does not change.

One React writer owns `packages/react`.
The lead owns this brief, the board, and the track notes.
The Playground writer owns `apps/playground` under the next brief section.
Both writers share this worktree and commit only their explicit paths.
Neither writer pushes or runs the full release or mutation lanes.

## React shape

Keep `ScopeContext` and the identity returned by `useScope`.
Store the selected namespace head in a private React context.
`ScopeProvider` clears that context for an independent root.
`SessionProvider` saves its key with the session when it creates it.
An explicit `options.ns` supplies the head; otherwise inherit the parent's key.
Later ignored options must never change the live session's reset key.

`useRelease()` inherits this key.
`useRelease(project42)` selects an explicit key.
Named cells and session or namespace resources use `releaseNs`.
Scope resources and calls with no known key keep `release`.

`useResource` accepts `ns?: Namespace` in both existing option shapes.
This option selects the read's controller and its refetch key.
Memoize an explicit controller by scope, handle, and namespace.
Use the existing suspense return shapes.
Refetch uses the same reset choice as `useRelease`.

```tsx
const project42 = namespace();
const reset = useRelease(project42);
reset(draft);
const profile = useResource(profileResource, {
  ns: project42,
  suspense: false,
});
```

Core does not expose an opaque scope's ambient namespace.
For those scopes, an explicit hook key makes the choice known to React.
An inherited chain reset clears its head only.
A read can then reveal a fallback value or resource.
Do not clear a fallback key just to force a new build.

## Impact

Public symbols: `useRelease`, `useResource`, and `Query.Options`.
The additions are optional; existing calls stay valid.
`ScopeProvider` and `SessionProvider` gain no public props.
All existing React hook callers remain consumers.
Read callers in `apps/playground`, `apps/issue-tracker`, and `examples/react`.
Read React's browser tests and `packages/sync/README.md`.

Before review, regenerate the React SCIP index and run:

```bash
scripts/scip.sh refs \
  'useRelease|useResource|Query/Options' react
```

## Proof

First add browser checks for the existing wrong reset and refetch.
Run them against unchanged React source and save the failing output.
Then fix the source and run all React browser tests.
Use the public package entry, real Core values, and no mocks or sleeps.

Prove named refetch keeps the sibling resource and default resource.
Prove a named cell reset keeps sibling and default values at the same owner.
Prove inherited sessions, explicit inner keys, and keyed remount cleanup.
Prove later ignored session options cannot change the reset key.
Prove a chain reset keeps its fallback and exposes it.
Prove shared scope refetch still rebuilds.
Prove explicit hook keys work with app-owned scopes.
Prove an independent nested scope cannot inherit an outer reset key.
Keep reset and controller identities stable on ordinary renders.

Update React's README with the usage and each new shipped promise.
Run build, check, React tests, strict census, prose, and Jev.
The lead runs all consumer tests, release lanes, and React mutation alone.

## Playground

Keep the refined ocean as the default example.
Add a focused form view that uses the fixed React adapter.
Show two stable project keys, a route session, and a child form session.
Field reset, whole-form reset, leaving the route, and refetch must be usable.
Resetting or refreshing one project must keep the sibling project's cache.
Leaving a route cleans the form's temporary resources.
Returning reads the retained project resource through the same key.
Use the existing colors, type, buttons, mobile layout, and keyboard access.
Keep the ocean iframe alive when changing shell views.
Avoid changes to the storm engine and benchmark workload.
The lead publishes a browser preview, checks it, and deploys the live Playground.
