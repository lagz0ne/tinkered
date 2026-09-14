# 0018 Resolution binds at the owner and bubbles up

Date: 2026-09-14. Status: accepted. Refines: 0013.

## Context

ADR 0013 said a `scope` resource may not depend on session-only context and that
this is a "declared error", but not how it is detected — and it must not break
ordinary child data shadows.

## Decision

- **Resolution bubbles from the owner.** A node resolves its dependencies (and
  registers cleanup) at its owning layer, and lookups bubble up the parent chain
  from there:
  - a `target:"scope"` resource resolves at the scope (root); deps and cleanup
    register at root and bubble from root.
  - a `target:"session"` resource resolves at the layer where it is requested;
    deps and cleanup register there and bubble from there.
  - data and tags read through parents; data always falls back to `initial`.
- **"Session-only context" needs no special machinery.** Because a scope resource
  bubbles from root, a **required** tag with no root binding and no default
  surfaces as the ordinary `MissingTag` error — that _is_ the session-only-context
  error. `optional` returns `{present:false}`; `.all` returns root bindings. Data
  never trips it (it is always defaulted), so child shadows are unaffected. If a
  resource needs per-session context, declare it `target:"session"`.

## Consequences

- No static analysis; the error falls out of owner-context resolution.
- Cleanup ownership follows resolution: a scope resource's cleanup lives at the
  scope; a session resource's at the session.
- Tickets "resource targets + owner-context" and "resource observation" rely on
  this.
