# Start refine brief

Owner: lead (Claude, Start scaffold session); Sol refine writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.

## Goal

`apps/start-scaffold` becomes the scaffold a new project starts from.
It keeps only what a new project needs.
It ships its own skills that teach how to write code in it.
A model writer will build a large app from it (ADR 0097, 0098).

## Part 1: stop the waste found in the spans

Lead span check, two tabs, 18 seconds:

- `sync.liveAccount` ran 63 times for 9 streams.
  Each stream pull checks the session against the database.
  Check once per wake, not once per pull.
- One sign-in loaded the snapshot three times:
  the sign-in action, the stream's account change, and the loader.
  Load it once per sign-in.
- A signed-out visit to `/profile` loads it twice:
  once for the redirect, then again on `/`.
  Load it once.

First write a test that counts these, at the public seam.
It must fail on today's code, then pass.
Count spans or calls; do not time anything.

## Part 2: keep only what belongs

- Keep `src/scaffold/`, the starter wiring, and both seam files.
- Keep auth, the public counter, private todos, and profile.
  Profile shows mail and the partial result.
- Remove proof mode from the running app.
  `src/proof.ts` and `START_PROOF_MODE` go.
  App code never imports `@tinker/core/testing`.
- Development runs against one compose file:
  Postgres, Mailpit, VictoriaTraces, and VictoriaLogs.
  Settings come from `.env`; `.env.example` lists every key.
- Tests may still use presets and PGlite.
- Ship what a project needs to test:
  `vitest.config.ts`, the tests, and the `package.json` scripts.
  Each shipped test is an example of testing through a scope.
- Ship project gates as scripts:
  the seam check, the browser import check, and the schema check.
- Maintainer-only proofs move to `apps/start-scaffold/maintain/`.
  They are never shipped:
  registry publishing, middleware internals, the note fixture, lazy imports.
- `README.md` speaks to a project owner: start, layout, rules.
  Our build history stays in `docs/roadmap/start-scaffold/`.

## Part 3: skills inside the scaffold

Ship `.agents/skills/<name>/SKILL.md` files with the starter.
`AGENTS.md` lists them and says when to use each.
Keep each skill short and concrete, with real file paths.

- `tinker-forms`: tags for settings, data for changing state,
  resources for app and session lifetimes, operations for actions.
  Code outside these needs a TSDoc reason.
- `tinker-seams`: never edit `src/scaffold/`.
  Reach it through `@/lib/tinker`, `@/lib/tinker.server`, and `Register`.
- `tinker-feature`: add one feature end to end.
  Table, migration, operation, server function, sync record, page.
  Use todos as the worked path.
- `tinker-sync`: when to use sync and when to use a mutation.
  Execution ID, waits, complete, partial, and failed results.
- `tinker-testing`: test operations through a small scope.
  Presets for the database and mail; no mocks; count, never time.

## Proof, all by exit code

1. The waste test fails before Part 1 and passes after.
2. A clean consumer installs the starter through shadcn.
   Core and React come from packed tarballs, never the workspace.
   It runs install, build, type check, the shipped tests,
   and the seam check with no manual step.
3. The consumer has every skill file and `AGENTS.md`.
   It has no maintainer file and no proof mode.
4. With the compose stack up, the app signs up, saves a todo,
   and sends a mail that Mailpit shows.
5. Existing gates stay green: workspace build, `vp check`,
   all workspace tests, every app check, strict census, prose,
   and `pnpm validate`.

## Limits

- Work only in this worktree; commit per step.
- Change only `apps/start-scaffold`, this track's docs, and the lockfile.
- Do not change Core or React.
- Do not use `git stash`.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
