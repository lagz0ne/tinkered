# Flight harness brief

Owner: lead (Claude, Start scaffold session); Sol harness writer.
Built on the services branch; the lead rebases after services lands.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0097, ADR 0098, and `tools/writer-trial/README.md`.

## Goal

Add a `flight` suite to `tools/writer-trial`.
The writer starts from the Start scaffold, not a blank Vite app.
The app talks to real local services on a private network.
No internet reaches the writer's container.

## Delivery order (staged start)

Round 1 must run first: `create`, `stage 1`, and `check` for round 1.
Commit with the subject `trial(flight-harness): stage 1 ready`.
Then finish later stages and the score record.

## What changes

- **Image.** A new trial image holds a project made from the
  Start registry: the starter item, its skills, and its tests.
  Core and React come from packed tarballs.
  Follow the existing image and keeper rules.
- **Network.** One private Docker network per trial:
  Postgres, Mailpit, suppliers A, B, C, and payment.
  The writer's container joins it with no outside route.
  The payment webhook reaches the writer's app on that network.
- **Staging.** `create --suite flight` and `stage` work as today.
  Packets come from `tools/writer-trial/flight/`.
- **Check.** `review.mjs check` starts a fresh network,
  runs the writer's own check, test, and build,
  then the teacher checks from `teacher/flight/`.
  Teacher checks reach the services' control APIs; the writer cannot.
- **Gate.** The Jev gate reads the writer's `src/` and `tests/` as today.
  Add one blocking rule: no file under `src/scaffold/` changed,
  and the scaffold's seam check passes.
- **Score.** Record the first failed round. The baseline is the count before it.

## Proof, all by exit code

1. `create --suite flight` and `stage 1` give a workspace with the
   scaffold, its skills, and only packet 1.
2. The writer's container cannot reach the internet or the control APIs;
   it can reach the service APIs, Postgres, and Mailpit.
3. `check` on the reference answer for round 1 passes;
   on an edited `src/scaffold/` file it fails at the gate.
4. Saved attempts, hashes, and image IDs work as in other suites.
5. Workspace build, `vp check`, tests, prose, and `pnpm validate` pass.

## Limits

- Work only in your worktree; commit per step.
- Change only `tools/writer-trial/`, `docs/roadmap/flight-trial/`, and the lockfile.
- Leave other suites working unchanged.
- Do not change Core, React, `apps/`, or the services.
- Do not use `git stash`.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
