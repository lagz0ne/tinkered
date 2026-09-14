# 0012 Tag lookup semantics

Date: 2026-09-14. Status: accepted.

## Context

Tags are ambient metadata read through the scope→session layer chain. The
prototype diverged from both predecessors on four small but observable points,
each hard to change once code depends on it.

## Decision

Match the prior art:

- **Duplicate bindings are preserved.** A layer may hold more than one binding for
  a tag; lookup order is nearest-first (session before scope). The prototype's
  single-`Map`-per-layer (last wins) is wrong; keep all bindings.
- **`.all` returns bindings only.** It collects every binding up the chain and
  does **not** append the tag's default. The default is a fallback for
  `required`/`optional` when no binding is present, not a member of `.all`.
- **`undefined` default is present.** A tag declared with `default: undefined`
  resolves as present with value `undefined`; absence is a distinct state.
- **Levels: scope + session only, for now.** Operation-local and
  resource-local tag levels (a third precedence layer) are deferred; the two
  layer kinds we have are enough for v1.

## Consequences

- Reversing any of these later would break consumers, so they are fixed now.
- The `ambient` scratch demo's `.all` expectation (which included the default)
  must be corrected to bindings-only.
- Storage per layer becomes a multimap (or list) rather than a last-wins `Map`.
