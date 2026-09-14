# 0011 `close()` is structured, total, and hookable from userland

Date: 2026-09-14. Status: accepted.

## Context

The prototype's `close()` aborted only the current layer, did not close child
sessions, did not join pending factory work, and stopped at the first throwing
cleanup (all verified). A late factory could repopulate a closed layer, and
escaped handles could still act. pumped-fn and tinker-engine both joined children,
executions, and resource resolutions before cleanup.

## Decision

`close(outcome)` is structured and total:

- **Children first.** Close child sessions recursively before the parent tears
  down.
- **Join pending work.** Await in-flight factory/resolution work owned by the
  layer; a late completion must not repopulate a closed layer.
- **Run every teardown, collect errors.** Run all teardown from two sources:
  1. **inside** — `ctx.cleanup(fn)` and `ctx.onOutcome(outcome)` registered by a
     resource in its factory;
  2. **outside** — `scope.onClose(fn)` registered by userland on the handle.
     A throwing hook does not skip the rest; errors are collected and surfaced in the
     outcome, never silently swallowed.
- **Seal the layer.** After teardown the layer is closed: late factories and
  escaped handles no-op (throw the disposed error), so `close()` guarantees owned
  work has ended and handles can no longer act.

Ordering: children before parent (inside-out for lifetime); within a layer,
teardown runs LIFO.

## Consequences

- A session is an owned lifetime boundary, not a detached one.
- Userland gets a first-class external teardown seam (`scope.onClose`) alongside
  resource-internal cleanup.
- `onOutcome` semantics (commit vs notification, and how body/commit/cleanup
  failures combine) are refined in a later decision.
- Code change in `scratch/tinker.ts`: `closeLayer` must recurse into children,
  join `pending`, continue past throwing hooks, and seal the layer; add
  `scope.onClose`.
