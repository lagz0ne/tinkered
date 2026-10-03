# Jev link brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Read `tools/writer-trial/README.md`.

## Goal

A running trial never depends on the checkout that created it.

## Found by

Trial `flight-deepseek-01`, round 1.
`create` made `frozen/jev/node_modules` a symlink into
the creating worktree's `tools/jev/node_modules`.
The lead removed that worktree after launch.
The writer's Jev tool then failed: `Cannot find package 'ai'`.

## Do

1. At `create`, give the frozen Jev its own packages:
   copy them, or link to a stable store under
   `~/.local/share/tinker-writer-trial/` keyed by the lockfile hash.
   Never point into a git checkout.
2. At `create` and before `check`, prove the frozen Jev loads
   (import `frozen/jev/lib.mjs`). A failure is "unavailable", never a pass.
3. Find any other trial path that points into a checkout
   (`readlink`, config paths) and fix it the same way.
4. A test: create into a temp root, delete the source copy of
   the packages, and the frozen Jev still loads.
5. Do not change grading: `review.mjs check` results must not change
   for an existing trial. Do not touch `teacher/`.

## Proof, all by exit code

1. The new test fails on the old code, passes now.
2. Writer-trial tests, `vp check`, prose.

## Limits

- Change only `tools/writer-trial/` (not `teacher/`) and `docs/roadmap/flight-trial/`.
- Do not touch the running trial `flight-deepseek-01` or its containers.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
