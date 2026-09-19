# 0049 The playground is the golden example: every effect is a resource, every action an operation, the view only reads and runs

Date: 2026-09-19. Status: accepted. Builds on: 0030 (react is a thin adapter, not a store), 0031 (a
subtree's lifetime is a session lifetime), 0032 (`useResolve`/`useRun` shapes), 0034 (ambient
clock), 0044 (a resource dep is its value). Applies to: `apps/playground` (the shell and the default
"Ripples" example); a recommendation, not a rule, for any app built on `@tinker/*`.

## Context

The playground exists to show the library. Its first shell did the opposite: one component read every
cell, so a tab switch re-rendered the whole tree, and its compile effect depended on the active tab
and the theme, so switching either **recompiled and reloaded a running preview**. The first
"impressive" example (an update storm) kept its model in module-level `Map`s of cells and controllers,
a `hot` `Set`, a render tally and a module-level scope — state nothing owned, nothing could clean up,
and nothing could test. Both were built _beside_ the library: cells and hooks for the easy part,
React effects and handlers for everything that mattered. The user named it: dogfooding that stays at
the glue level teaches the wrong lesson.

**The analogy** is a DI container that owns lifecycle plus the command/projection split:

- **Effect's `ManagedRuntime` / NestJS bootstrap**: services are _acquired_ at one composition root,
  released when the root closes; nothing acquires a service by reaching for a global.
- **Redux's discipline**: the view dispatches, reducers own transitions, the view never mutates.
- **Command handlers (CQRS)**: a user action is a named command with a validated payload.

Ours is simpler: the scope is the only container, an operation is the only command, there is no
middleware, and the view's subscriptions are per cell, so "projection" needs no selector library.

## Decision

1. **Every effect is a resource.** Anything that subscribes, listens, polls, boots or writes outside
   the graph — booting esbuild-wasm, the debounced bundler, persistence, the iframe listener, the
   game's frame loop — is a `resource`: built once per scope, its inputs declared as deps, its cleanup
   a `defer` the scope runs on close. Resolving it starts it. Nothing is stopped by hand.
2. **Every user action is an operation.** `editFile`, `addFile`, `closeFile`, `renameFile`,
   `selectFile`, `setTheme`, `setView`, `reset`; the game's `press` and `clear`. Typed input is
   admitted at the door (a throwing parser becomes core's `DataValidationFailed`); the cells an action
   touches are declared as controller deps. `scope.run(addFile)` in a test does exactly what the
   button does. Even a one-line write (`setView`) is an operation: the uniformity is the point.
3. **Config is a tag.** `storage`, `entry`, `debounce`; the game's `grid` and `physics`. What a scope
   binds, a test rebinds — `storage` is `localStorage` in the browser and a `Map` in a test.
4. **The view reads and runs, nothing else.** Components read exactly the cells they render —
   `useData(cell, select, isEqual)` where they want a slice — and run operations for what the user
   does. **No `useEffect` in the shell.** DOM side effects that React owns natively stay declarative
   (`<iframe srcDoc>`), not imperative.
5. **One composition root owns the scope.** `main.tsx` creates the scope, resolves the services, and
   hands the scope to `ScopeProvider`. Hydration (persistence) runs there, _before_ the first paint,
   so no cell is written during a render. The preview (the game) uses `ScopeProvider create` instead:
   its scope's lifetime is the document's, and unmount closes it.
6. **Fan-out granularity comes from the read side.** The game's board is one cell written at most
   once per frame; each tile reads its slice with a selector and a field-compare `isEqual`. A resource
   writes what it declares (one controller), and only tiles whose look changed re-render. Not 84
   controller deps.
7. **Pure derivations are functions.** A tile's look is `shadeAt(x, y, waves, now, physics)`: no
   hidden state, assertable with a fixed clock. Core has no computed-cell node and this is why it does
   not need one for a view: derive in the selector or in a pure function the effect calls.

## Consequences

- The app is testable **without React**: create a scope with a fake `storage`, run operations,
  resolve `bundler`, assert the `bundle` cell. Every headless check in the commit was written
  against the running app; every unit-level one is possible against the scope alone.
- Fine-grained re-render by construction: a tab switch touches the editor and the tabs, a theme
  change the editor and the select, a keystroke the editor and (debounced) the preview — never the
  tree. Verified: with a wave travelling, two tab switches and a theme change left the same preview
  document alive.
- More files and more names than a `useState` app: eight small operations where a handler object
  would do. Accepted for the golden example; a tiny app may keep handlers, but it should still keep
  effects as resources — that is where the cleanup and test wins are.
- The pre-commit hook and `vp check` cover the shell like library code (it has an `errors.ts`
  registry and follows the coding convention), so the example cannot drift into glue silently.

## What we learned building it

- **A cell's equality is a policy, and it surfaces invariants.** The bundle cell dedupes identical
  code, so a whitespace edit no longer reloads the preview — correct — but the bundler had already
  written "running…" and only the iframe ever wrote "ready". Whoever writes "in progress" must be
  able to write "done"; the bundler now reports an unchanged bundle as ready itself. The old shell
  hid this by reloading every time.
- **`isEqual` can express "my own echo".** A controlled editor re-renders on its own keystroke because
  the content it wrote comes back through the cell. `(prev, next) => prev === next || next ===
lastEmitted` makes that a non-change while a reset or a tab switch still swaps the document. The
  keystroke echo was the last "unhealthy" re-render, and it fell to the hook's existing surface.
- **Tree-shaking is a dedupe too.** An appended unused `export` compiled to the identical bundle; the
  test had to add a side-effecting statement to force a reload. The headless suite is only honest when
  its edits change emitted code.
- **Hydrate before the first paint, from the root.** A resource that writes cells during a React
  render would notify subscribers mid-render. Resolving `persistence` in `main.tsx` before
  `createRoot` sidesteps the whole class of "setState during render" problems; `ScopeProvider
create` (built in an effect, StrictMode-safe) is the right tool only when nothing must run before
  paint.
- **A resource's frame handle must be the last thing mounted before it is used.** Both the `useState`
  control row in the benchmark and the game's engine capture something from "the latest mount";
  warm-up mounts must precede the live one. Written down because it bit twice.
- **Module state is the tell.** Every "impossible to clean up or test" smell traced to a value with
  no owner: a `Map` of controllers, a render tally, a scope created at import time, `localStorage`
  read at import time. The fix was never a helper; it was giving the value an owner (a cell, a
  resource, the root).
- **Bundle the core you think you are bundling.** The playground bundles the workspace `@tinker/core`
  from its local `dist`; this checkout's base predates ADR 0044, so an operation's async resource
  dep was still typed as a promise and needed an `await` that `origin/main` no longer requires.
  Rebuild `dist` after pulling; the `await es` in `compiler.ts` becomes a no-op and can go.
- **The benchmark taught the same lesson from the other side.** Every competitor's "slow" number was
  a handle resolved per render or per update (Legend's proxy, Zustand's inline selector, Preact's
  unmanaged mode); the fix was always "resolve once, declare it" — which is what a controller dep is.

## Vocabulary

- **composition root** — the one place an app creates its scope and resolves its services (`main.tsx`).
- **action** — a user-facing operation: typed input at the door, controller deps, no React.
- **effect resource** — a resource whose value is incidental and whose job is to subscribe/listen/loop,
  torn down by `defer`.
- **golden example** — the playground shell and its default example: the code that shows how an app
  on `@tinker/*` should be shaped.
