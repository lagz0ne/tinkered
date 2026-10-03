# Flight integration brief

Owner: lead (Claude, Start scaffold session); Sol integration writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Read ADR 0097 to 0100 and `tools/writer-trial/README.md`.

## Goal

Join the reviewed trial parts on top of `main` and prove the whole trial.
After this, the DeepSeek run can start round 1 with nothing missing.

## Start

Your branch starts from `origin/main`, which has the scaffold,
the strict check, the flight data, and the services.
Merge, in this order, resolving conflicts by keeping both sides' intent:

1. `trial/flight-rounds` (reviewed READY at `10ff6e72`).
2. `trial/flight-harness` (reviewed READY at `6a2209ea`).

Never use `git stash`. Check every merge's exit code.

## Do

1. The harness copies `tools/writer-trial/flight-services.md`
   into the writer's folder as `SERVICES.md`.
2. Rebuild the writer image from the landed scaffold.
   It must include `check:plain`, `PLAIN.md`, the skills, and the tests.
   Rebuild the services image from the landed services.
   Follow the image keeper rule; save each image's tar.
3. Put `WEBHOOK_SECRET` in the teacher's `grader.env`,
   with the same value the app receives.
4. Fix the two `vp check` warnings at
   `tools/writer-trial/flight-scaffold.mjs:21`: sort with a compare function.
5. Remove the `--teacher-dir` option; teacher files come from the repo only.
6. Remove the old flight trial images and proof folders this replaces,
   but only after the new run passes.

## Running beside you

`trial/services-routing` moves the services' routes into Hono at the same time.
It keeps the wire contract: paths, bodies, status codes, headers.
Build the services image from a script, so the lead can rebuild it
after routing lands with one command. Name that command in your report.

## Proof, all by exit code

1. `create --suite flight` and `stage 1` give the scaffold, its skills,
   `SERVICES.md`, and packet 1 only.
2. The isolation proof passes: no internet, no control API, no Mailpit Chaos.
3. The reference answer passes rounds 1 to 5 through the full flight gate,
   including `check:plain` and the seam check, twice in a row.
4. One planted break per round fails that round by name.
5. Workspace build, `vp check`, all tests, prose, and `pnpm validate` pass.

## Limits

- Work only in your worktree; commit per step.
- Change only `tools/writer-trial/`, `tools/flight-trial/reference/`,
  `docs/roadmap/flight-trial/`, and the lockfile.
- Do not change Core, React, `apps/`, or `tools/flight-trial/services`.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs, image IDs.
