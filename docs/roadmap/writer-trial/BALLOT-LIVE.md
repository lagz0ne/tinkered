# Second live gate trial (ballot-01)

One fresh task (a team poll), four writers, gate on.
New since loans-01: plain census rules block, and every
block carries a fix line.
Bottom line: all four accepted. The gate raised 6 blocks,
all `inputDefaultMasks`. Two repairs were still needed;
both were the same payload-type miss, which neither plain
rules nor Jev can see.

## Setup

- **Task:** `tools/writer-trial/ballot/01-team-poll.md`.
  Every filter and status is defined (loans-01 left
  the Available filter open).
- **Checker:** 57 cases; 13 canaries (3 good apps,
  10 planted bugs) behave as expected.
- **Gate proof:** the reference app passes; a planted
  blank-limit default blocks at 0.93; a planted
  same-vote-after-closed guard blocks at 0.78.

## Results

- **DeepSeek Flash** — accepted first try. 12 min.
  Gate never blocked.
- **MiMo Flash** — accepted first try. 89 min.
  Gate blocked 3 input defaults; cleared all three the
  way the fix line says, with no rule traded away.
- **GLM Flash** — accepted after 1 repair. 25 min.
  First try: a cast (`value as string`) let a non-text id
  into `NotFound` (teacher 56/57), and it cleared a block by
  throwing the raw filter value.
- **MiMo Pro** — accepted after 1 repair. 102 min
  (includes one resumed gateway stream error).
  First try: `raise` typed every payload field `unknown`,
  so a non-text id reached `NotFound` (teacher 56/57).

Every final app: own check, test, and build exit 0;
57/57 teacher cases; gate `pass` on the teacher side.

## Compared with loans-01

- **First-try accepts:** 2 of 4 in both runs.
- **Repairs:** 2 in both runs.
- **Blocks during writing:** 9 in loans-01 (6 plain,
  3 Jev); 6 here (all Jev). No writer broke a plain rule.
- **Trading one rule for another:** 1 case here (GLM's raw
  throw), the same as loans-01. The fix line helped
  MiMo Flash; it did not stop GLM.

## What this run found

- **Jev is not steady at the threshold.** DeepSeek's
  `idText` scored 0.82 for the writer and 0.85 for the
  teacher. Fixed: the teacher reuses the writer's answer
  for unchanged bytes (`tools/writer-trial/answers.mjs`,
  6db1985). DeepSeek's recheck reused 13 of 13 reports.
- **Jev cannot see how a helper is used.** `String(id)`
  built only for an error payload looks the same as a
  default that keeps going. GLM's repair was blocked for
  it and switched to `{ id: "" }`, which is allowed but
  worse. Card `jev/caller-context`.
- **The payload-type miss has no check.** Twice MiMo Pro,
  once GLM: keep the raw value, break the exact payload
  type. A cast or an `unknown`-typed parameter hides it
  from `tsc`; only the teacher case caught it.
  `writers/cast-rule` adds S17: a cast in writer source
  blocks (GLM's `value as string` does). Widening the
  registry or a parameter to `unknown` (MiMo Pro) has no
  cast and still needs the teacher case.

## Where things live

- Trial folder: `~/.local/share/tinker-writer-trial/ballot-01/`
  (archives, sessions, events, checks, `lead-notes.md`).
- Projects, workspaces, containers, volumes: removed;
  `workers.mjs cleanup` exit 0.
