# 0054 A Jev use is earned by calibration: retire plan-check, impact's judge, and three test judges; add `titleVague`

Date: 2026-09-21. Status: accepted. Narrows: 0047 (the impact chain keeps the SCIP diff and drops
the Jev verdict). Builds on: 0052 §5 (a template is `proven` only past a bar with a golden set).

## Context

The first calibration over every labeled case (147, all from one day) read the most-used judges
as noise: `manyCauses` sep 2% / ordered 53% on 44 cases, `helperAlone` sep 16% on 30,
`typeGuarantee` sep −24%, `negativeTwin` 1 true in 18, `reprovesSamePromise` sep −3%. The 31
"fixes" `manyCauses` pointed at came from a human reading every flagged test; the judge did not
tell a split-worthy test from a fine one. Every contributor report of the week spent a
paragraph explaining the same `helperAlone` false hit ("calls the public seam with an inline
literal"). Two tools never recorded a catch: `plan-check.mjs` (uncalibrated) and the Jev half of
`impact.mjs` (21 impact blocks, no mismatch ever judged as real).

Meanwhile the unit judges held (`runForwardsToClosure` 92%, `handRolledLifetime` 73%,
`effectWithoutDefer` 42%, `stateOutsideCell` 32%) and `survivorMatters` earned `proven` on its
first day. Blueprint (ADR 0052) showed why: a question earns its place through a bar, a golden
clean set, and words that carry the definition (`unitFits` went 44% → 92% by restoring examples).

## Decision

1. **A Jev use lives only while calibration says so.** `calibrate.mjs` runs and its output is
   committed at every landing that adds labels (not "every ~10 cases"). A judge `noisy` on ten or
   more labeled cases is reworded once; still noisy, it is retired. Its cases stay in
   `cases.jsonl`; `calibrate.mjs` prints them as `retired` and drops the judge from
   `calibration.json`.
2. **Retired now:** `manyCauses`, `typeGuarantee`, `negativeTwin`, `reprovesSamePromise` (and
   with it the pair loop in `tests.mjs`), `plan-check.mjs`, and the Jev verdict in `impact.mjs`.
   `impact.mjs` stays as plain code: the SCIP diff prints every discrepancy and the lead decides
   the side.
3. **Reworded:** `helperAlone` now defines the seam in the question (a test that calls an
   exported function or resolves a scope through `src/index.ts` is at the seam, inline literals
   included). First run on `packages/blueprint`: 0 flags where the old wording gave 11.
4. **Added:** `titleVague` — does the title fail to name the outcome the decisive assertion
   checks? It replaces a hand job (`tests/core-titles`) with a narrow yes/no over facts
   `tests.mjs` already extracts. `label.mjs` sends a test judge the same facts `tests.mjs` sends
   (title, causes, asserts, narrows, body), so a label reproduces the run.
5. **Next uses, each behind the same bar:** blueprint ↔ code integrity (one node, one unit from
   `extract.mjs`: "does `run` do what `work` says?"), and a pair judge over
   `docs/roadmap/core-feedback.md` rows ("do these two ask for the same change?") to find a
   second asker. Neither ships until its evals pass ADR 0052 §5's bar.

## Consequences

- `tests.mjs` asks two questions per test instead of five; a `⚠` means "move to the seam" or
  "retitle", both concrete.
- The contributor brief's step 3 names the two judges; the README judge table is regenerated.
- ADR 0047's impact block stays required for public-symbol changes; the verdict line
  ("plan wrong / source wrong") is gone from the tool and lives in the lead's review note.

## Alternatives rejected

- More labels for `manyCauses`: 44 cases with 2% separation is not a small sample; the question
  has no crisp `true`.
- Keeping `plan-check.mjs` as "harmless": an uncalibrated `⚠` costs a paragraph per ticket and
  teaches writers that flags are noise.
