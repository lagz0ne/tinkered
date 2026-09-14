# 0013 Resource `target` is `scope` or `session`; deps bind at the owner

Date: 2026-09-14. Status: accepted.

## Context

The resource knob was `unmount: "root" | "session"`, which named the _cleanup
moment_, not the resource's _lifetime and sharing_. That framing forced a guess
about which context a shared resource's dependencies resolve in: a root-owned
singleton is shared by every session, so it cannot see any one session's tags or
data.

## Decision

- **Rename the knob to `target: "scope" | "session"`** — it says where the
  resource lives, so nothing is guessed:
  - `"scope"` — one instance for the whole (root) scope, shared across sessions.
  - `"session"` — one instance per session.
- **Dependencies bind at the owner.** A resource resolves its `depends` and tags
  at its owning layer: a `"scope"` resource reads scope-level context; a
  `"session"` resource reads that session's context. This is what keeps a shared
  instance sound.
- **A `"scope"` resource may not depend on session-only context.** Depending on a
  tag/data override that only a session provides is a declared error; if a
  resource needs per-session context it must be `lifetime: "session"`.
- **Default is `"scope"`** — the common shared singleton (pool, client).

## Consequences

- The word carries the meaning; no "which context?" guessing remains.
- Ambient read-through applies to operations and session resources; a scope
  resource is deliberately outside any single session.
- Code change in `scratch/tinker.ts`: rename `unmount`→`lifetime`, values
  `root`→`scope`; resolve resource deps at the owner layer (already so); add the
  scope-resource-needs-session-context error.
