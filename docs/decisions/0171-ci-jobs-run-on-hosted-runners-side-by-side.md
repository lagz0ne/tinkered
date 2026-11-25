# 0171 CI jobs run on hosted runners, side by side

Date: 2026-11-25. Status: accepted; built.
Accepted: Duke, 2026-11-25 04:31 UTC, option A
(hosted runners, side by side;
B: two more runners on the box;
C: keep one box runner).
Partly undoes: the 2026-11-06 move of `ci.yml`
to the box runner (hosted minutes stopped then).
Goes with: ADR 0170 (mutation in CI).

## Context

On main `721be1a0`, 2026-11-24, `ci` took
17 minutes: three jobs, one after another,
on the box's one runner.

- bun: 1.3 minutes.
- gates: 8.0 minutes, tests 6.0 of that.
- validate: 7.2 minutes.

The box also runs the model runs and the
bench queue, so a busy box slows each job.

tinkered is public. GitHub's standard
hosted runners cost nothing on a public repo.
The release's `npm` job already runs on one.

## Decision

1. `bun`, `gates` and `validate` in `ci.yml`
   run on `ubuntu-24.04`, side by side.
2. `ubuntu-24.04`, not `ubuntu-latest`:
   `ubuntu-latest` is Ubuntu 26.04, and
   Playwright 1.55 has no Chromium for it.
3. The box keeps what needs it:
   the playground deploy (Docker socket),
   the release's box job, trunk status,
   and timing (`benchd`).

## Precedent

- **Continuous Delivery** (Humble and Farley):
  the commit stage gives a verdict in minutes;
  independent checks run in parallel.
- **ADR 0170**: the same move for mutation,
  for the same reason (load on the box).

## Cost

- Each run starts on a clean machine:
  install takes longer than on the warm box.
- The fast-code lane in `validate` pins the
  Node version from its baseline, not the
  machine, so it still holds.
