# Starter casts brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0099, 0100, and `apps/start-scaffold/AGENTS.md`.

## Goal

A writer who edits the starter's files gets no Jev block
for code the starter shipped.

## Found by

DeepSeek, trial `flight-deepseek-01`, round 1.
It edited `src/server.ts` to bind a settings tag.
Jev rule S17 then blocked two casts it did not write:

- `src/server.ts:22`: `context.router as Awaited<ReturnType<typeof getRouter>>`.
- `src/server.ts:102`: `owned: undefined as ReturnType<typeof start> | undefined`.

The build also warns: `createServerFn().inputValidator()` is deprecated;
use `.validator()`. Four starter files call it.

## Do

1. Remove both casts with real types, no `any`, no new plain function.
   Keep behavior: the router's `close` still runs on every path.
2. Switch every `inputValidator` call in the starter and its skills
   to `validator`, if the pinned TanStack Start has it.
3. Run the app gate on the starter:
   `node tools/writer-trial/app-gate.mjs apps/start-scaffold --json /tmp/gate.json`.
   No blocking item may remain in starter-owned files.
4. Rebuild the registry; keep `check:plain` and the seam check green.

## Proof, all by exit code

1. The app gate before (blocking S17 in `src/server.ts`) and after (none).
2. `check:plain`, seam, registry, build, `vp check`, all tests, prose.

## Limits

- Change only `apps/start-scaffold/` and `docs/roadmap/start-scaffold/`.
- Do not change Core, React, `tools/`, or the flight trial.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
