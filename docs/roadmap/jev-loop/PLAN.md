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

## React: the component kind + five rules (2026-09-20)

**Analogy: eslint-plugin-react-hooks** — the component is the node. The slicer now marks a
capitalised function (or `const Name = (…) => {`) in a `.tsx` file as `component` and a
`use*` function as `hook`; a component that calls `createScope` is a root and is skipped.
Grep keeps rule 9's smells (`useState` / `useRef` / `useEffect`) and rule 2's
`Scope.Handle` props; Jev gets the five things grep cannot see:

| rule                   | asks (kind: component)                                                                  | from                          |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| readsMoreThanRendered  | reads a whole list from a cell and picks one item by id / key / index, with no selector | rule 10                       |
| subscribesToWriteOnly  | subscribes with `useData` to a cell whose value never renders (setter only)             | README: `useController`       |
| runDuringRender        | calls `run` / `set` / `update` in the render body, outside any handler                  | README: operations imperative |
| domainLogicInRender    | decides a conflict / merge / validity itself instead of rendering a notice cell         | derivation pattern            |
| effectOwnedByComponent | starts a fetch, timer, listener, socket, or stream itself                               | rule 8                        |

The guide gained `view` ("a component: reads cells with `useData`, runs operations with
`useRun`, renders"); the lint expects a component to read like a `view` — which removed the
earlier false "LiveState reads like a resource" note.

Eval, 2026-09-20 (24/24; `readsMoreThanRendered` took one rewording):

| question               | bad | clean    | separation |
| ---------------------- | --- | -------- | ---------- |
| readsMoreThanRendered  | 92% | 43% / 3% | 49         |
| subscribesToWriteOnly  | 94% | 11%      | 83         |
| runDuringRender        | 95% | 19%      | 76         |
| domainLogicInRender    | 93% | 5%       | 88         |
| effectOwnedByComponent | 95% | 5%       | 90         |
| unit → view (2 cases)  | —   | —        | 97%, 100%  |

Lesson: the first wording ("one item or one field") flagged every form that reads a two-field
draft and renders both fields (`IssueForm` 71%, `DraftForm` 78%). Rule 10 is about lists in a
detail view, so the question now says "a whole list … one item by id, key, or index", and the
form draft is the second clean fixture (an eval pair may carry several `clean*` fixtures; the
worst one sets the separation).

Run over `apps/issue-tracker/src/client/*.tsx` + `examples/react/*.tsx` (at `419be02`):

| wording                     | judged | with notes | of which components                                                                           |
| --------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------- |
| first ("one item or field") | 28     | 8          | 6 × readsMoreThanRendered, mostly forms                                                       |
| narrowed (landed)           | 28     | 3          | `DraftView` subscribesToWriteOnly 51% (at threshold; it reads four cells and hands them down) |

The other two notes are `main.tsx` `boot` / `renderDead` (plain functions in the client's
entry file, seen in the first run too).

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

## Trial on the drivers/t03 landing (2026-09-20, lead)

Ran the three advisory tools on the hono-as-extension landing (`419be02..0d17653`):

- `review.mjs`: 1 flag in 9 files — `apps/issue-tracker/src/index.ts` leakedInternal 71%. **Signal**: the
  barrel exports `src`, `viewers`, `drafter`, `wire`, `publishAfterCommit` — internals a test needed; the
  two-hands/docs ticket (drivers/t07) trims the seam. Route hint "correctness 79%" matched the lead's own focus.
- `lint.mjs` (38 units, 17 notes): mostly noise on this code shape. False-positive classes to label for
  `jev/calibrate`: `runForwardsToClosure` fires when a `run` calls a value helper with a delivered dep
  (`loadSaved(tx, id)`, `selectAllIssues(db)`) — allowed by best-practices rule 4/7; "reads like a resource"
  fires on driver internals that ARE the lifetime machinery (`stream`, the session middleware, a drizzle
  frame's `open`); `configNotTag` fired on `readCapability`, whose dep IS a tag. One real hit:
  `startDraft`'s stream closure unwatches in `finally` rather than `ctx.defer` (effectWithoutDefer 81%) —
  fold into the next tracker touch.
- `impact.mjs`: 138 "discrepancies" — a format mismatch, not a finding. The parser reads `scripts/scip.sh refs`
  shaped lines (`symbol -> file:line`, `N symbol file`); the drivers-v1 blocks are prose tables, and apps are
  not SCIP-indexed. **Rule from here:** an `impact` block that Jev should read uses the refs format
  verbatim; prose blast-radius tables get a different fence (`blast`).
- `lint.mjs` crashes with EISDIR when given a directory; pass files (`git ls-files <dir>`).

## Calibration and the promise gap are in the workflow (2026-09-21)

- `scripts/jev/label.mjs <judge> <true|false> <file>[#<unit>] [--ref] [--by] [--why]` appends a labeled case
  (the exact Jev state, inline) to `scripts/jev/cases.jsonl`. Writers label every pre-flight flag they fixed
  (true) or explained (false); the lead labels fix-round nits (true). Seeded with 13 cases from the
  2026-09-20 fix rounds and explained flags.
- `scripts/jev/calibrate.mjs` asks each judge about every case (bank + the seed fixture pairs) and writes
  `scripts/jev/calibration.json`: `proven` (≥ 2 each side, median gap ≥ 30 points, ≥ 90% of pairs ordered),
  `provisional` (thin), `noisy`. `lint.mjs`/`preflight.mjs` print a noisy judge's hit as `~` (a note, no
  fixed/explained line owed). First run on real cases: `configNotTag` proven; `runForwardsToClosure`,
  `effectWithoutDefer`, `handRolledLifetime` **noisy** (the hand-written fixture pairs had passed them all —
  that is what the bank is for); nine judges provisional on fixtures alone. The three noisy judges match
  the "driver internals read like…" noise seen on 2026-09-20; rewording them is the next calibrate step.
- `scripts/jev/promises.mjs <pkg> [--floor 0.7]`: for every `test("…")` title, deterministic narrowing to
  the README lines sharing stems, then one Jev pick with `none`; a confident `none` is a promise gap. First
  run on harness: 20/48 confident gaps, 10 unsure. Of the four gaps the floor-75 writer reported, two are
  real and two were already in the README (line 113) — the tool caught a writer overclaim on its first
  run. One duplicated title got two different picks at ~52% (below the floor: reported as unsure, as it should).
- Brief: `docs/roadmap/contributor-brief.md` steps 2–3; lead rule: CLAUDE.md contributor workflow §3–4.

### harness README gaps (confident, first run)

- a failed approval rejects the turn, and the error is not a TurnFailed
- an unknown message kind still lands in events and the turn resolves
- a turn folds the event stream into the result and the ambient cells
- a failed turn rejects with TurnFailed and the harness turn line says failed
- a rewritten agent text restreams whole and only the last text stays final
- an empty agent update streams nothing and the turn still completes
- a stream that ends with no completion rejects TurnEnded
- a reasoning item records the event phase, not an SDK status
- a failed command item keeps the SDK's failed status
- a turn streams text and fills the ambient cells
- options merge nearest-first and force partial messages
- with observe, the turn span carries the adapter and one harness turn line logs done
- a stream event that is not a text delta adds no text
- an assistant message without a tool call adds no tool item
- the usage cell keeps the result's own cost
- a stream that ends with no result rejects TurnEnded
- a non-init system message leaves the id cell alone
- a user message with plain text adds a tool result item only for tool answers
- a trailing assistant message with no tool call adds no tool item
- a named tool registers under its meta name, not the op label

## Test quality (2026-09-21): `scripts/jev/tests.mjs <pkg | file…>`

The convention's "over-testing is a defect" rules, split the usual way. Deterministic: a private `../src/*`
import, `vi.mock/fn/spyOn`, `setTimeout`, `.only/.skip`, `isError` inside `expect`, internals asserted
(`Object.isFrozen`, prototypes, `error.message`, `toHaveBeenCalled`), helpers > 3 or > 20 lines, an `expect`
re-narrowed by the same `if`, `toBe` then `toEqual` on one subject. Jev, per test `{ title, body }`:
`helperAlone`, `manyCauses`, `typeGuarantee`, `negativeTwin`; pairwise on title-similar tests in one file:
`reprovesSamePromise`. All labelable (`label.mjs <judge> <bool> <file>#<title prefix>`; a pair takes
`#<a>|<b>`) and calibrated by `calibrate.mjs` like every other judge.

First run: **http 24/48 entries flagged**, almost all in the files the floor-75 lift added (`bodies`,
`accept`, `status`, parts of `endpoints`): helper-alone builders and readers, three to four causes per
test — the shape the convention's mutation-score rule warns about. The pre-existing files (`config-merge`,
`transient`, `retry`, most of `observe`) pass. **harness 3/49**: one negative twin ("…and the error is not a
TurnFailed"), one redundant pair (assistant message without a tool call / trailing assistant message
without a tool call), one `error.message` assertion. Two deterministic rules were tightened on the trial:
a promised log line's `message` field is not an error message, and a shared `tests/fixtures.ts` is not a
private module. Eight verified cases labeled.

Tension to decide, not paper over: deleting or merging the flagged http tests may drop the http lane
below the 75 floor — the convention says a survivor no user can observe is NOT to be tested, and the floor
says 75. If they conflict on http, the floor is the number to revisit for that package, with the reason
written down; the tests are not the place to give.

## Whole-codebase scan (2026-09-21) and the parser decision

Three tools over every package and the tracker, in-container, with the seeded calibration active.

**`tests.mjs`** — 566 tests scanned, 74 flagged:

| pkg          | tests | flagged | classes                                                                           |
| ------------ | ----- | ------- | --------------------------------------------------------------------------------- |
| http         | 48    | 22      | manyCauses 17, helperAlone 6, expectThenNarrow 6, typeGuarantee 4                 |
| core         | 272   | 31      | manyCauses 18, typeGuarantee 4, helperAlone 4, negativeTwin 4, pair 3, isFrozen 1 |
| tracker      | 42    | 8       | manyCauses 8                                                                      |
| hono         | 34    | 6       | manyCauses 5, helperAlone 1                                                       |
| harness      | 48    | 2       | negativeTwin 1, pair 1                                                            |
| react        | 48    | 2       | manyCauses 1, negativeTwin 1                                                      |
| sync         | 27    | 2       | manyCauses 2, helperAlone 1                                                       |
| cli          | 30    | 1       | manyCauses 1                                                                      |
| drizzle, mcp | 17    | 0       |                                                                                   |

Deterministic hits (trust these): `Object.isFrozen` in core `index.test.ts:2511` (the convention names it);
six `expect(x).toBe("…"); if (x !== "…") throw` re-narrowings in http; helper counts over 3 in seven test
files and three helpers over 20 lines (`client.test.ts` `readRoutes` 41). `manyCauses` is the big class
(52) and needs reading: on the http lift files it is real; on core it mostly marks tests whose titles
already join three promises with commas — real by the convention's letter ("one public cause") but older
than the rule; on the tracker it fires on flow tests that exercise a whole request path. `negativeTwin`
misfires on the deep-chain "does not overflow" regression tests (a promised budget, negatively worded) —
labeled false. **Card:** `tests/floor-75-cleanup` covers http/harness; a second card `tests/core-many-causes`
should read the 18 core hits and split or explain.

**`promises.mjs`** — confident gaps: core 151/272, harness 20/48, react 16/48, http 15/48, cli 9/30, hono 7/34,
sync 6/27, mcp 4/9, drizzle 4/8. Core's README states about half of what its tests prove; the tests are the
truer spec. **Card:** `docs/core-promises` (large; the lead should first decide whether every core test title
belongs in the README or whether a "promises" appendix is the right home).

**`lint.mjs`** on every driver, frame, and the tracker source — 238 units, 65 notes, near zero actionable:
`stateOutsideCell` (18) fires on driver internals and parsers that keep private bookkeeping (the judge's own
`false` criterion), `stopOnlyInDefer` on resources with no in-flight work, `configNotTag` on cells that are
user state. One true hit: the tracker's reconnecting transport, accepted by rule 13's exception. Eight
verdicts labeled → next `calibrate.mjs` run should demote two more judges.

**Parser decision (research, 2026-09-21):** TypeScript 7 here is the native port and exposes no JS compiler
API (`require("typescript")` fails), so `ts-morph`/`typescript-estree` are out; `@babel/parser` is present only
as Vite's transitive dependency. **Recommendation: add `oxc-parser` as a root dev dependency** — the same
Rust parser family as the Oxlint `vp check` runs, full TS syntax, standard ESTree output, fastest of the set —
and put all extraction in one `scripts/jev/extract.mjs`: units (kind, label, `depends` keys, body), tests
(title, causes = top-level subject-producing calls, assertions as subject/matcher/argument, `if … throw`
narrowings, awaited calls), exports and imports; SCIP stays for cross-file refs. Judges then see structured
facts, not prose; the regex rules (`expectThenNarrow`, `toBeThenToEqual`, helper counts, private imports)
become exact. Fallback if a native binding is unwelcome: `@babel/parser` declared as a dev dependency.
**Card:** `jev/ast-extraction`, awaiting the dependency decision.

Docs: `scripts/jev/README.md` (plain words per tool and per judge; the judge table is generated by
`scripts/jev/explain.mjs --md`).
