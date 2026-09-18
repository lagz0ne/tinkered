# Jev advisory layer — plan

**Status:** landed (advisory scripts), 2026-09-18.

Jev (TypeSafe's evaluation model, via Vercel AI Gateway `typesafe-ai/jev`) returns typed
probabilistic decisions — no text. We use it as a **fast advisory triage** across the existing
workflow. It never decides pass/fail.

## The one rule everything hangs on

**No self-grading.** The same jagged model must not both guide an edit and verify it — a mistake
it makes at implement time it will miss at verify time (correlated blind spot). So:

- Jev is **advisory on every side**: it flags and routes attention.
- The **only** pass/fail is `scripts/ticket.sh` (check · tests · mutate · size), `pnpm validate`,
  the SCIP set-diff, and the human lead. These do not move.
- The loop is **bounded**: on the Nth red (cap ~3), escalate to the human.

## Anti-goals, not forward goals

Questions are **safety properties** ("is this bad thing present?"), not liveness ("did it achieve
the goal?"). A literal model is strong at narrow yes/no and weak at broad, multi-hop, numeric, or
date judgments — so anti-goals keep us in its strong zone.

Proven on labeled cases (2026-09-18, `pilot/side-projects/jev-probe/eval.mjs`):

- **Judge (boolean):** 11/11 correct; bad vs clean separated by **59–90%**. Trustworthy to start,
  threshold 0.5 (`partialStub`, `memoKeyIgnoresInput`, `leakedInternal`).
- **Classifier (choice/route):** 2/3; the miss (perf) came at 54%, below the **0.6** trust bar,
  so the confidence gate turns a wrong answer into a safe "unclear → human". Never trust route for
  perf; send perf to a structural tool.

## Where it hooks (advisory scripts in `scripts/jev/`)

| Phase          | Script                  | What it does                                                      | Truth still owned by            |
| -------------- | ----------------------- | ----------------------------------------------------------------- | ------------------------------- |
| Planning       | `plan-check.mjs <file>` | neutral anti-goals on a plan/ADR/ticket + glossary (uncalibrated) | the human author                |
| Implementation | `preflight.mjs [range]` | contributor self-check on the working-tree diff before reporting  | `vp check` / tests / `validate` |
| Verification   | `review.mjs [range]`    | judge set per file + gated route + overclaim                      | `scripts/ticket.sh` + lead      |

Key: `AI_GATEWAY_API_KEY` (or `JEV_TOKEN_FILE`); never printed. Cost is ~fractions of a cent per
ticket. Free tier is request-rate capped; paid credits lift it.

## Deferred — protect-node-0: the SCIP + Jev impact chain

Not built yet (needs a plan convention + is the least-proven piece). The idea: cross the plan's
**expected** blast radius (the Anchors/refs table the brief already requires) against SCIP's
**actual** refs of the changed symbols; Jev judges each discrepancy ("does the goal require this
symbol?") to return **source wrong / plan wrong / both / neither** — catching the "wrong thing
built correctly" case a normal gate cannot see. SCIP stays the deterministic sensor; Jev only
judges "should it have". See `TODO.md`.

## Loop shape

```
PLAN (lead) → build implement + protect anti-goal sets (once per ticket)
  → DELEGATE to contributor (runs preflight before reporting)
  → review.mjs on the diff (advisory)  +  REAL GATE (ticket.sh) — the only judge
      green → land, next ticket
      red   → feedback → contributor (cap ~3, then escalate to human)
```
