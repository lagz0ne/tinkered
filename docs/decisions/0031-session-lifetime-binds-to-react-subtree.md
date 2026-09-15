# 0031 A session's lifetime binds to a React subtree's mount

Date: 2026-09-15. Status: accepted. Builds on
[0030](0030-react-is-a-thin-adapter-not-a-store.md).

## Context

Core has two lifetime layers: the root `scope` and child `session`s (an owned lifetime boundary closed
structurally). React has its own lifetime unit: a mounted subtree. The adapter must map one onto the
other so resources and `defer` cleanup feel native, without leaking core's imperative `close()` into
component code.

React's StrictMode and concurrent rendering deliberately run mount -> unmount -> mount and may render a
tree that is then discarded. Anything that creates a session must survive that faithfully, not merely
tolerate it.

## Decision

- **`<ScopeProvider>`** puts a scope `Handle` on Context. Two modes: `scope={handle}` (the app owns and
  closes an externally created scope — the production path) or `create={() => createScope(opts)}` (the
  provider creates, owns, and closes on unmount — the ergonomic/test path).
- **`<SessionProvider>`** creates a child session on mount via `scope.createSession()` and closes it on
  unmount. **A React subtree's mount lifetime is a core session lifetime.** Unmount is a **forced**
  close by default (aborts `ctx.signal`, rolls resources back — the "user navigated away" intuition,
  [0028](0028-close-is-a-shutdown-mode-not-a-wished-outcome.md)).
- **Nearest `Handle` wins.** Hooks resolve `getController` against the nearest provider's `Handle`; core
  routes by `target` — a `target: "scope"` resource is shared app-wide even when first touched inside a
  session; a `target: "session"` resource is one instance per `SessionProvider`.
- **Creation is effect-based and ref-guarded**, never during render (render must stay pure; a session
  has side effects). On a StrictMode remount the prior session is already closed, so a fresh one is
  created. The dev-only create/close/create cycle is accepted as the price of StrictMode correctness.

## Consequences

- Component code never calls `close()`; unmounting a `<SessionProvider>` is the close. Cleanup (`defer`,
  `onClose`) runs in core's reverse-registration LIFO ([0026](0026-teardown-is-reverse-registration-lifo.md)).
- Because unmount forces, in-flight work under a removed subtree is aborted and rolled back; a caller
  wanting graceful teardown drives it outside the mount lifecycle.
- A session created during a discarded concurrent render is closed by its cleanup like any other, so no
  session leaks; the guard only prevents double-creation within a single committed mount.
