---
name: toolcall-evals
description: Work on the toolcall decision-chain evals — measure where Jev helps (pre-filter, routing) and where it does not (content trimming) on LABELED cases, by SEPARATION. Forces you to dogfood the toolcall chain while you do it. Use when adding or tuning eval cases, changing a Jev question's wording, or deciding whether to trust a chain step. Harness-agnostic (Claude, Codex, pi).
---

# Working on the toolcall evals

The toolcall chain (`[[toolcall]]`, `scripts/jev/toolcall.mjs`) leans on Jev, and
Jev is **jagged** — strong on some judgments, blind on others. You do not guess
which; you **measure it on labeled cases** where the truth is known, and the number
that decides is **separation**: how far apart Jev scores the true-positive cases
from the true-negative ones.

```
separation = (lowest score among "should fire") − (highest score among "should not")
  >= ~50%   strong — trust this step, wire it in
  ~0%       blind  — Jev cannot tell them apart here; do NOT use it, use rules or defer
  route:    trust a `choice` pick only at prob >= 60%; below that, defer to a human
```

## Rule 1 — dogfood: do this work THROUGH the chain

You are working under a goal, so you use the chain on yourself. This is the "force
an agent to use it to answer" rule:

```bash
node scripts/jev/toolcall.mjs frame --json '{"objective":"...","intention":"...","verification":["..."]}'
# then BEFORE each command you run to investigate:
node scripts/jev/toolcall.mjs before --json '{"tool":"...","args":{...},"why":"..."}'
# and pipe heavy command output through:
node scripts/jev/toolcall.mjs after --json '{"tool":"...","why":"..."}' --out <file>
```

If a `before` says ⚠ skip, either drop the command or note in one line why you run
it anyway. This keeps the eval work itself on-objective.

## Rule 2 — the eval loop

The evals live in `scripts/jev/evals/`. Each is self-contained: labeled cases +
the Jev question + a separation report. To work on one:

1. **Add or curate labeled cases.** Realistic, and clearly labeled (the truth must
   be obvious to a human). Keep both positives and negatives; imbalance hides a
   blind spot.
2. **Run it** — `node scripts/jev/evals/<name>.mjs`. It prints per-case scores and
   overall separation.
3. **Read separation, not vibes.** Strong → the step earns its place. Flat/negative
   → Jev is blind; say so and either switch that step to rules or make it defer.
4. **Tune the wording** (the question is at the top of each eval, kept in sync with
   `toolcall.mjs`). Jev is literal: prefer a single positive, concrete question;
   avoid negation and compound "so that…" clauses. Re-run; keep the wording that
   moves separation up.
5. **Record** the run (date, separation, verdict) in the eval header comment and,
   for a shipped change, in `docs/roadmap/jev-loop/PLAN.md`.

## What the evals have already settled (2026-09-18 — do not re-litigate)

| Eval                        | Chain step                      | Result                                                 | Verdict                                                                            |
| --------------------------- | ------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `command-prefilter.mjs` (A) | `before` should-run             | **6/6, 82% separation**                                | **Trust it** — the chain's core value                                              |
| `command-prefilter.mjs` (B) | tool routing (choice)           | **4/4** after wording fix ("which action IS the goal") | Trust the pick at ≥ 60%                                                            |
| `should-trim.mjs`           | `after` whether to trim (whole) | **8/8, 86% separation**                                | **Trust it** — Jev knows if a response carries anything the goal needs             |
| `trim-how.mjs`              | `after` which strategy (choice) | **5/5**                                                | Trust the pick at ≥ 60%; below → keep whole. Script executes; Jev never cuts lines |
| `reading-intention.mjs`     | per-fragment relevance          | **~0% separation**                                     | **Jev is blind** — never ask it which lines to keep                                |

The lesson the numbers teach: **Jev is a gate and a router, not a shredder.** It decides
whether a whole command should run, roughly which lane it belongs to, and — for output —
_whether_ and _how_ to trim the whole response. It **cannot** pick which individual lines
to keep; the chosen strategy is executed in code. Truth still lives in `scripts/ticket.sh`,
the gates, and the human.
