# 0028 close() is a shutdown mode, not a wished outcome

Date: 2026-09-15. Status: accepted. Supersedes the **wish** of
[0027](0027-close-returns-a-result-and-never-throws.md) (keeps 0027's "close returns a `Result`, never
throws"). Refines [0026](0026-teardown-is-reverse-registration-lifo.md).

## Context

`close(outcome?)` took a wished `Outcome` (`success | cancelled | failed`). ADR 0027 already said
"reality wins; the wish is a fallback." Building lt3 showed the wish is not just a weak input — it is a
persistent source of bugs: a wished `failed`/`cancelled` propagates down to descendants (`inheritedEnd`)
and echoes back up through failure collection, where it competes with — and can mask — a REAL failure.
Nine review rounds of the descendant-collection path kept re-discovering the same theme: telling a real
failure apart from an inherited wish. Provenance-by-value is impossible (rounds 7–9 of lt1), so any
scheme that lets a wished outcome enter the failure lattice is unsound.

The deeper realization: **nobody wishes a lifetime to fail.** A caller closing a scope is choosing HOW
to shut down — let in-flight work finish, or stop it now — not decreeing an outcome. The outcome is a
consequence of the shutdown mode plus what actually happened.

## Decision

**`close(opts?: { graceful?: boolean }): Promise<Result>`** — the argument is a shutdown MODE, never a
wished outcome. There is no `close({ cancelled })` / `close({ failed })`.

- **Forced (default, `close()`):** abort `ctx.signal` so in-flight work stops now, then tear down
  (reverse-registration LIFO, ADR 0026). Result: `failed` if a real error surfaced, else `cancelled`
  if work was interrupted, else `success`. **Cooperative cancellation is a precondition:** the close
  joins in-flight owned work, so a unit that honors its abort signal stops and the close settles
  promptly; JavaScript cannot force-terminate a pending promise, so a unit that IGNORES its abort and
  never settles will stall the join — the caller's bug (like a process ignoring SIGTERM), out of scope.
- **Graceful (`close({ graceful: true })`):** do NOT abort; let in-flight work finish on its own, then
  tear down. Result: `failed` if a real error surfaced, else `success`. May wait indefinitely if work
  never finishes — the caller's choice (POSIX SIGTERM-like; use forced to stop).

The settlement reducer is REALITY-ONLY, applied at every layer:

```
failed     — a real error: this layer's body threw, an owned-work op rejected (not an abort-cancel),
             or a descendant really failed (bubbled up).
cancelled  — no real failure, but the shutdown was not graceful for this layer: a session body settled
             under an abort, OR a bodyless scope was FORCE-closed. (POSIX-style: a forced shutdown rolls
             its resources back — their `defer` end is `cancelled`; a graceful close commits — `success`.)
success    — otherwise (a graceful close, or a session whose body completed).
```

- **No wish tier, no `inheritedEnd`, no severity merge.** A closing ancestor does not push a wished
  end down; it aborts (forced) or waits (graceful). Descendants settle by their OWN reality. A real
  descendant failure bubbles up (`finishLayer` swept-push into a separate `descendantFailure` slot
  ranked below the layer's own failure). Cancellation does not bubble — each layer reports whether its
  OWN work was interrupted.
- **`close()` still never throws (0027 kept).** It resolves to the `Result`. `session(fn)` keeps
  promise semantics: reads its layer's close `Result`, resolves the value or rejects a real
  failure / cancellation.
- **A layer fails only from real work**, so a caller cannot manufacture a failure via `close`. To
  signal failure, throw in a body/op; to react to an outcome, read the `Result`.

## Consequences

- `close(outcome?)` → `close(opts?)`; `close({ status: "cancelled" | "failed" })` is removed. Breaking,
  acceptable pre-v1.
- The lt1 wish/severity machinery (`inheritedEnd`, `moreSevere`, `severity`, `chooseOutcome`'s wish
  branch, `closeLayer`'s r13 more-severe merge) becomes dead once no wish is ever fed, and is removed —
  a net simplification, which is why the redesign was worth it.
- Cancellation follows the shutdown mode: a forced close settles `cancelled` (a session with an
  interrupted body, or a bodyless scope), so its resources' `defer` ends see `cancelled` and roll back;
  a graceful close settles `success` and commits. A failing/forced ancestor force-cascades to its
  subtree, so nested resources roll back too (transaction-abort intuition). A session whose body
  completed stays `success` even though its self-close aborts leftover background work.
- **Deferred to lt4:** graceful→forced ESCALATION (a later `close()` upgrading an in-flight graceful
  close, SIGTERM→SIGKILL-style). For v1 the first close's mode wins and a second close returns its
  Result — so a session's automatic self-close never overrides an in-progress explicit graceful close.
  Also deferred: forcing children on an owned-work failure that surfaces only AFTER the child cascade
  (children close before owned work is joined; a body failure or an already-recorded owned failure DOES
  force the cascade).
- Built as part of core/lt3 against the ledger `docs/roadmap/core-v1/teardown-redesign.md`.
