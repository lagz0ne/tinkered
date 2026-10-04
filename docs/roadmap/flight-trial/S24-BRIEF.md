# S24 on brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Read ADR 0102 and `tools/writer-trial/README.md`.

## Goal

Jev rule S24 blocks a bare built-in `fetch` in every suite again,
and its fix line names the Start scaffold's `httpRequest`.

## Today

- `tools/jev/plain.mjs:51` and `:68` say to use "a copied HTTP endpoint
  operation" in `src/tinker/http/index.ts`, which no longer ships.
- `tools/writer-trial/broker.mjs:124` drops S24 for the flight suite.
- `tools/writer-trial/README.md:251-254` explains that skip.

## Do

1. S24's message and fix line: depend on `httpRequest.controller` and run it
   (ADR 0102); never call the built-in `fetch` in app code.
2. S24 must not fire on the scaffold's own `src/scaffold/http-backend.ts`,
   which wraps the built-in on purpose.
3. Remove the flight skip in `broker.mjs` and its README lines.
4. Keep S24 working for the older suites as today.
5. Tests: S24 fires on bare `fetch` in a flight app file; it does not fire
   on `src/scaffold/http-backend.ts`; a flight gate on an app with a bare
   `fetch` blocks; the older suites' S24 tests still pass.
6. A trial frozen before this change keeps its frozen Jev; do not change
   frozen trial folders.

## Proof, all by exit code

1. Each new test fails on the old code (red log), passes now.
2. Jev tests, writer-trial tests, `vp check`, prose, `pnpm validate`.

## Limits

- Change only `tools/jev/`, `tools/writer-trial/` (not `teacher/`),
  and `docs/roadmap/flight-trial/`.
- Do not touch `~/.local/share/tinker-writer-trial/` or its containers.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
