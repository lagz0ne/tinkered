# 0081 A stack piece is an extension; the app sees only authoring units

Date: 2026-09-29. Status: accepted. Builds on: 0060 (an integration is an extension the scope
owns), 0073 (core stays lazy), 0077 (glue lives in its home package), 0078 (a piece is one row
in a root's list). Research: `docs/roadmap/stack-v1/RESEARCH.md`, round 6.

## Context

Each v1 piece wraps an outside library and needs config: mail, jobs, auth, NATS, the migrate
step. Two things were open. What does the app author touch? And when does a missing setting show
up? Libraries load on first use, so a check at first use could fail days after a deploy, on the
first sign-up mail.

**The precedent is a daemon under init,** as in ADR 0060. A daemon checks its own config when it
starts and refuses to run on a bad one (`nginx -t`), and init reports the failure. The scope is
init; each piece's extension is a daemon.

## Decision

1. **Every stack piece has an extension at its heart.** The composition root lists it in
   `createScope({ extensions })`.
2. **The app touches only authoring units:** operations, resources, data, and namespaces. The
   outside library (Upyo, pg-boss, Better Auth, the NATS client) stays behind them.
3. **The extension's `start` checks the piece's config.** A missing or bad setting fails `start`,
   so `scope.ready` rejects and boot stops before any request. The error names every missing key
   of that piece.
4. **The library still loads on first use** (ADR 0073). Checking config needs no library. A piece
   loads its library at `start` only when it must act at boot: the migrate step, a NATS
   subscription.

## Consequences

- Swapping a library touches only its piece's package. The app's code stays.
- If prod never uses a piece, delete its row, and its config is no longer required.
- Boot stops at the first piece that fails. That piece lists all of its own missing keys.
