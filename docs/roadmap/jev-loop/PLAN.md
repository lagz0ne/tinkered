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

| Phase          | Script                                 | What it does                                                                                      | Truth still owned by            |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------- |
| Planning       | `plan-check.mjs <file>`                | neutral anti-goals on a plan/ADR/ticket + glossary (uncalibrated)                                 | the human author                |
| Implementation | `preflight.mjs [range]`                | contributor self-check: file judges + per-unit lint on the diff                                   | `vp check` / tests / `validate` |
| Verification   | `review.mjs [range]`                   | judge set per file + gated route + overclaim                                                      | `scripts/ticket.sh` + lead      |
| Writing        | `guide.mjs "<logic>" \| <file#symbol>` | which unit should this be (data / resource / operation / tag / glue), target, needs defer         | the author + the one law        |
| Review / lint  | `lint.mjs [paths]`                     | per declared unit or outermost function: seven anti-goal judges + the unit classifier (see below) | `vp check` / tests / the lead   |

Pre-flight proof (2026-09-20): an untracked `examples/core/jev-proof-tmp.ts` holding a `setInterval`
with no `defer` — the file judges passed it (✓), the per-unit lint caught it (`effectWithoutDefer 95%`).
New untracked files are included since that day.

Key: `AI_GATEWAY_API_KEY` (or `JEV_TOKEN_FILE`); never printed. Cost is ~fractions of a cent per
ticket. Free tier is request-rate capped; paid credits lift it.

## protect-node-0: the SCIP + Jev impact chain — landed (ADR 0047, `scripts/jev/impact.mjs`)

Landed 2026-09-18 (eval `scripts/jev/evals/impact.mjs`: clean block → neither, no model call; under-scoped block → plan wrong at 82–87% once the file's diff hunk rides in the state). Decided (ADR 0047: an `impact` block per ticket in `PROGRESS.md`; one boolean per discrepancy; a fixed mapping to source/plan wrong). The idea: cross the plan's
**expected** blast radius (the Anchors/refs table the brief already requires) against SCIP's
**actual** refs of the changed symbols; Jev judges each discrepancy ("does the goal require this
symbol?") to return **source wrong / plan wrong / both / neither** — catching the "wrong thing
built correctly" case a normal gate cannot see. SCIP stays the deterministic sensor; Jev only
judges "should it have". See `TODO.md`.

## lint + guide — the ESLint-shaped bank (2026-09-20, `scripts/jev/bank.mjs`)

**Analogy: ESLint.** A deterministic selector finds one node, a rule asks one narrow question
about it, code applies the threshold and prints. Jev replaces only the rule's yes/no. It never
locates, counts, or gates.

- **Selector (`slice`, no model):** every `data` / `resource` / `operation` / `tag` /
  `extension` declaration, plus each outermost `function` that declares none (a function that
  declares units is a root or a tour). Brace-matched with strings and comments skipped. Default
  lint skips `data` / `tag` one-liners and functions under 150 chars (`--all` includes them).
- **State:** `{ kind, name, source }` of that one unit — the fields the decision depends on,
  nothing else (TypeSafe: pass the fields, not the record).
- **Lint judges:** one boolean anti-goal per rule grep cannot see, with a per-question kind
  filter and threshold (probabilities are not comparable across questions). Rules from
  `docs/best-practices.md` and the core README: `runForwardsToClosure` (rule 4, operations),
  `effectWithoutDefer` (rule 8), `stateOutsideCell` (rule 9), `configNotTag` (rule 11),
  `handRolledLifetime` (rule 13), `stopOnlyInDefer` (README "Resource cleanup"),
  `ignoresAbortAfterAwait` (README, resources only, threshold 0.7). Greppable smells (the rules'
  "Smell" column) stay in code, not in Jev.
- **Guide classifier:** `unit` (choice: the one-law table as criteria; trusted at ≥ 0.6, else
  "unclear, decide with the table"), `target` (scope / session), `needsDefer` (boolean). Lint
  also runs `unit` on every judged node: a declared kind that reads like another kind, or a
  function that reads like a primitive, is a note.
- **Entry bar (the RuleTester analogue):** every question ships with a labeled bad/clean pair in
  `evals/fixtures/lint.mjs`; `evals/lint.mjs` requires ≥ 30 points of separation with bad ≥
  threshold and clean < threshold, and every guide case at ≥ 0.6. A question that drops below
  leaves the bank.

Eval, 2026-09-20 (17/17 after two rounds of wording; the first round's two misses were a fixture
that itself broke rule 4 by handing `tx` to a helper, and a negation-heavy abort question):

| question               | bad | clean | separation |
| ---------------------- | --- | ----- | ---------- |
| runForwardsToClosure   | 95% | 38%   | 57         |
| effectWithoutDefer     | 94% | 4%    | 90         |
| stateOutsideCell       | 88% | 6%    | 82         |
| configNotTag           | 98% | 14%   | 84         |
| handRolledLifetime     | 95% | 7%    | 88         |
| stopOnlyInDefer        | 85% | 9%    | 76         |
| ignoresAbortAfterAwait | 82% | 25%   | 57         |
| needsDefer             | 96% | 7%    | 89         |
| unit (7 cases)         | —   | —     | all ≥ 90%  |
| target (2 cases)       | —   | —     | both 100%  |

Wording lessons that moved numbers: name the concrete artifacts ("a timer, interval, listener,
subscription, poll, socket, or connection"); say "is any await followed by … with no check
between" instead of "without checking"; put the rule's own nouns in the criteria (rule 9's "form
field, draft, filter, selection, notice" lifted `data` from 74% → 93%); keep `glue` defined by
what it touches, not by "pure".

Lint run over `examples/` + `apps/issue-tracker/src` (2026-09-20 at `ab6b4dd`, 39 files, one call per unit,
same answers recounted after the root filter was added — Jev answers are per unit and independent):

| selector                                                                   | judged | with notes |
| -------------------------------------------------------------------------- | ------ | ---------- |
| declared units + functions ≥ 150 chars                                     | 182    | 49         |
| + composition roots skipped (functions calling `createScope`; the default) | 174    | 41         |

By question (root-filtered): runForwardsToClosure 11, stateOutsideCell 8, handRolledLifetime 8,
effectWithoutDefer 7, configNotTag 4, stopOnlyInDefer 4, ignoresAbortAfterAwait 1; 23 "reads
like" notes from the unit classifier.

Worth a look (they match the rules' letter, the lead decides):

- `apps/issue-tracker/src/server/operations.ts`: `editIssue` 86%, `addComment` 74%,
  `listIssues` 90% forward `tx` / `db` to helpers; those helpers (`loadSaved` 91%,
  `writeIssue` 94%, `recordActivity` 92%) read like operations. The helper law says helpers
  take values only and `tx` / `db` stay in the body. `guide.mjs …#loadSaved` → operation 91%.
- `apps/issue-tracker/src/tools/issues.ts`: the five `*Remote` operations forward 53–80%;
  `serveIssues` reads like a resource (97%) with effectWithoutDefer 83% / handRolledLifetime 86%.
- `apps/issue-tracker/src/tools/main.ts#readBaseUrl` reads like a tag (77%; rule 11).
  `guide.mjs` on it → tag 67%.
- `apps/issue-tracker/src/server/store.ts#openDatabase` reads like a resource (93%).
- `apps/issue-tracker/src/client/connection.ts#reconnectingTransport`: 94 / 93 / 94% and
  resource 100% — the documented rule-13 exception; expected, and the lint says so loudly.

Known noise: the `tour` / `main` roots (now filtered); `examples/core/basic.ts` `store` "reads
like data" 63% (an in-memory rows array); `stopOnlyInDefer` 52% on operations whose `defer`
is a rollback (at the threshold; noted, never blocking).

Guide demo: "poll the API every 10 seconds and keep the latest issue list" → resource 99%,
target scope 83%, needs defer 94%.

## toolcall chain — tried and removed (2026-09-19)

A `scripts/jev/toolcall.mjs` wrapper (frame → before/gate → after/trim) was built to keep tool
calls on-objective and prune raw output out of the context, then removed. The durable findings,
proven on labeled cases (2026-09-18):

- **Jev is a gate/router, not a line-shredder.** As a whole-call judge it separates well
  (should-run 6/6 @ 82%, tool-route 4/4, whether-to-trim 8/8 @ 86%, how-to-trim 5/5). Asked which
  individual output lines to keep it is **blind** (per-line relevance ~0% separation) — never use it
  for per-line filtering; a deterministic strategy must do the cut.
- **Advisory only; the harness owns permission.** A should-run gate that blocks execution just
  false-skips harmless reads (a real `git log` scored 37%); deciding whether a command may run is
  the harness's job, not a jagged model's.
- **Why removed:** in real use the wrapped outputs were tiny (max 1.5 KB, none > 4 KB), so the trim
  had nothing to shrink, while every wrapped call cost a ~1.7 s round trip. Net negative; adoption
  went to zero. Revisit only if a workflow routinely produces large, noisy output worth pruning.

## Loop shape

```
PLAN (lead) → build implement + protect anti-goal sets (once per ticket)
  → DELEGATE to contributor (runs preflight before reporting)
  → review.mjs on the diff (advisory)  +  REAL GATE (ticket.sh) — the only judge
      green → land, next ticket
      red   → feedback → contributor (cap ~3, then escalate to human)
```
