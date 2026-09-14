# 0014 `release()` cascades downstream; it is mainly a frontend affordance

Date: 2026-09-14. Status: accepted.

## Context

`release()` deleted only the cached value — no cleanup, no cancel, and no effect
on anything derived from it. We had to decide what release is _for_ and how far
it reaches.

## Decision

- **Release is mainly a frontend affordance** — e.g. resetting a form and
  everything derived from it. Server-side it is rarely used: there the lifetime
  boundary is a `session`, and you `close()` it.
- **Release cascades downstream.** Releasing a node releases the dependency chain
  it caused — its dependents — so they rebuild on the next resolve. It does not
  release upstream dependencies (those may be shared).
- For a resource, release runs its cleanup and uses a **generation** guard: an
  in-flight build is abandoned and a late completion is discarded; a re-resolve is
  a new generation.

## Consequences

- "Reset this and everything computed from it" is a one-call operation on the
  frontend.
- Servers lean on `close()` (ADR 0011) for lifetime; release is the surgical,
  downstream reset.
- Code change in `scratch/tinker.ts`: `release` must run cleanup, cascade to
  dependents, and carry a generation guard — not just delete the cached value.
