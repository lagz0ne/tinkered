# 0061 In the writer loop, a proven Jev hit and a plain shape finding block "done"

Date: 2026-09-23. Status: accepted. Narrows: 0054 (it said only a `proven` judge could ever
block; this is the first place one does). The repo's own tools stay advisory.

## Context

Three writer trials (bookings, stock moves, a learning plan) ran four models under one set of
rules. Jev was advice only. Each time, the gaps were found by the lead reading code or by a
hand-written browser probe, not by Jev:

- the React state rule, found by reading; now plain code in `tools/jev/shape.mjs`;
- a view writing cells straight through `useData(…, { writable })`, missed by Jev in three
  first attempts; now plain code too;
- an operation rejecting a repeat request that changes nothing, missed by Jev and the tests;
- an old error notice left on screen after typing or filtering.

A writer model stops when it believes it is done. Advice it may skip does not change where it
stops. A rule it cannot pass does.

## Decision

1. **One gate rule, two places.** The worker's `jev` tool and the teacher's
   `review.mjs check` use the same function (`tools/writer-trial/gate.mjs`):
   - a plain shape finding blocks;
   - a Jev answer blocks when its judge is `proven` in the trial's frozen `calibration.json`
     and the probability reaches the judge's threshold;
   - any other Jev hit is advice: printed, never blocking;
   - an unavailable check (no key, an error, the call limit) is `unavailable`, never a pass.
2. **`machine-pass` needs the gate.** `review.mjs check` records `jevExit` beside the own and
   teacher exits. The lead review still decides acceptance.
3. **A question earns blocking only through calibration** (ADR 0054: 5 real cases a side,
   30 points separation, 90% ordered). Real cases come from trial code: labeled blind, every `true` label reviewed by the lead.
   The questions stay domain-neutral: a question that names a trial's domain is rejected.
4. **The repo's own tools do not change.** `lint.mjs`, `tests.mjs`, `preflight.mjs`, and
   `review.mjs` in `tools/jev` still exit 0 on a finding.
5. **First hardening run (2026-09-23).** 1,695 items from 21 saved trial snapshots in three
   domains; 835 labeled blind (the labeler never saw a Jev score), 4 lead overrides, 5 seeded
   cases (a real unit with one guard moved or one input rule planted in a view).
   - **Added, `proven`:** `inputDefaultMasks` (14 true / 33 false, sep 55, ordered 98%,
     threshold 0.7) and `noOpRejected` (6 / 44, sep 67, ordered 100%, threshold 0.6).
   - **Reworded, now `proven`:** `domainLogicInRender` names input checks in a view
     (6 / 43, sep 81, ordered 100%, threshold 0.6). The old wording scored its three real
     cases at a median of 19%.
   - **Reworded:** `configNotTag` names environment settings only; clean trial units fell
     from a median of 26% to 5%.
   - **Retired:** `titleVague`, noisy on 120 labeled tests with both wordings
     (sep 27 / ordered 60%, then sep 19 / ordered 68%).
   - **Rejected candidates:** `unknownErrorSwallowed` (sep 6: a catch hands the error to a
     helper outside the unit, so the unit cannot show the defect) and `staleNotice` (the bug
     is a notice the unit never names). Both need more than one unit; the browser checks
     keep them.
   - **Still `provisional`:** every other judge. Where they have true cases they separate by
     45–90 points, but trial apps hold 0–3 real true cases per judge.

## Consequences

- A writer learns which findings it must fix before it reports, so it stops later but
  closer to the bar; the teacher spends fewer repair rounds on rules a check can see.
- A trial freezes its calibration, so a judge promoted mid-trial does not change that
  trial's gate.
- A noisy judge never blocks. If a blocking judge starts misfiring, the fix is a new label
  and a new calibration, not a waiver.

## Alternatives rejected

- **Block on every Jev hit.** Most judges are `provisional`; `titleVague` sits at 14 points
  separation. Blocking on noise teaches writers to rename good tests.
- **Make the repo's own tools blocking too.** The repo has `vp check`, tests, mutation, and a
  lead for every ticket. The writer loop has only what the writer can run.
