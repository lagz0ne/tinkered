# Core closing signal brief (ADR 0104)

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0028, 0050, 0085, 0089, 0090, 0100, and 0104.
Read the Core feedback rows "Graceful close drains work before resource
cleanup" and "No hook when a graceful close begins" in
`docs/roadmap/core-feedback.md`.

## Goal

A resource or extension can end a wait it owns as soon as its layer
begins to close, so a graceful close never hangs on it (ADR 0104).

## Do

1. Each layer (root scope and session) gets a closing signal that aborts
   the moment the layer begins to close, graceful or forced, before Core
   waits for running work. A child layer's signal also aborts with its parent's.
   Create it on first read; a layer that never reads it pays nothing.
2. Expose it as `ctx.closing` on `Resource.Ctx` and `event.closing` on
   extension hook events; the `close` hook event also carries the layer
   (`event.scope`).
3. `ctx.signal` and `ctx.defer` keep their meaning and timing.
4. ADR 0085 rules: a root's close hooks run once; they cannot skip cleanup
   or replace the outcome; a hook's throw becomes a teardown error counted
   by `closed`. Add tests for any rule not yet covered.
5. Types and TSDoc on the public surface; glossary rows for "closing signal".
6. Tests (red on today's code): a graceful root close and a graceful session
   close settle while a resource-owned wait ends on `ctx.closing`; running
   work still finishes; a child session's closing fires with the parent's;
   forced close unchanged; reading `closing` costs nothing when unused
   (`bench/promises.mjs` or the size lane shows no growth).
7. Do not change the scaffold, services, or stack packages here; their
   workarounds come out in follow-up cards.

## Proof, all by exit code

`vp check`, Core tests, `scripts/ticket.sh` (read its quirks in the landing
notes), `pnpm validate` (size and promise lanes), and the Core mutation lane
alone under `flock /tmp/mutation.lock`, floor 85, nothing excluded.

## Limits

- Change only `packages/core/`, `docs/decisions/0104-*`, `docs/glossary.md`,
  and `docs/roadmap/core-v1/`.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs, mutation score.
