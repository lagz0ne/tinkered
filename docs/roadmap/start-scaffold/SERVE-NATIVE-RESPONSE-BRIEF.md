# Serve native Response brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Read ADR 0103 and `tools/writer-trial/README.md`.

## Goal

A writer's route that returns `Response.json(...)` works on the first try.

## Found by

The `trial/reference-0102` review. The reference sets
`overrideGlobalObjects: false` in `tools/flight-trial/reference/scripts/serve.mjs:38`;
the starter's `apps/start-scaffold/scripts/serve.mjs` does not.
Without it, the server's patched globals turn a native `Response.json`
reply into HTTP 500 until the writer finds the setting.

## Do

1. Add `overrideGlobalObjects: false` to the starter's `scripts/serve.mjs`.
2. A test, red before and green after: the built starter serves a route
   that returns `Response.json({ ok: true })` with status 200.
3. Rebuild the registry; the copied starter passes.
4. Rebuild the flight writer image only (services unchanged) and pin it
   in `tools/writer-trial/config.json`; save its tar and keeper.
5. Run the reference through round 1 once on the new image.

## Proof, all by exit code

Red then green; registry; app tests; image build; round 1; build,
`vp check`, all tests, prose, `pnpm validate`.

## Limits

- Change only `apps/start-scaffold/`, `tools/writer-trial/` (not `teacher/`),
  and `docs/roadmap/`.
- Never touch `~/.local/share/tinker-writer-trial/flight-deepseek-01`,
  its images, or `../tinkered-trial-runner`.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs, image ID.
