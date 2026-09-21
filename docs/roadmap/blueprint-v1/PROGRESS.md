# blueprint v1 — build progress

A blueprint is the `.d.ts` of a tinker app: a YAML list of nodes (kind, `name`, `depends`,
`promise`, `work`) written before code. `blueprint check` judges every node with Jev over question
templates shipped in the package (ADR 0052). Package `packages/blueprint` (`@tinker/blueprint`,
bin `blueprint`), built on `@tinker/core` + `@tinker/cli`; peers `zod`, `yaml`, `ai`; imports
nothing from `tools/jev`.

- **Decision:** `docs/decisions/0052-blueprint-a-declaration-file-for-a-tinker-app-judged-by-jev-over-shipped-templates.md`.
- **Glossary:** `docs/glossary.md` → "Blueprint" (blueprint, node, template, corpus, eval).
- **Gate + tag:** `scripts/ticket.sh blueprint <NN> "<title>"` → `blueprint/t<NN>`; mutation lane alone, floor 75.
- **Key:** `AI_GATEWAY_API_KEY` or `--key-file`; never printed. Model `typesafe-ai/jev` through
  `experimental_evaluate` from `ai` (the call `tools/jev/lib.mjs` makes today, with the same 429 backoff).

## The binary, as its own blueprint

```yaml
- tag:
    name: engine
    promise: >-
      which model and key the judge uses;
      rebound in tests
    why: the one environment choice of the judge
- tag:
    name: corpusPath
    promise: >-
      the folder of templates; the shipped one
      by default; rebound in tests
    why: tests point it at a fixture corpus
- resource:
    name: corpus
    depends: [corpusPath]
    promise: >-
      every template loaded once per scope;
      a template naming a field the node schema
      lacks fails the load
    why: questions are data, loaded once, never code
    work: >-
      read corpus/*.yaml; zod-parse each;
      check applies and needs against the schema
- resource:
    name: judge
    depends: [engine]
    promise: one Jev client per scope; asks, never writes
    why: one client, one key, one retry rule
    work: evaluate({ state, questions }); retry on 429
- operation:
    name: check
    depends: [corpus, judge]
    promise: >-
      for one blueprint file, one result line per
      plain check and per (node, template) pair;
      exit 1 only on a plain failure or a proven hit
    why: >-
      the corpus gives the questions, the judge
      the answers; check only wires them per node
    work: >-
      parse the file; plain checks; per node build
      state (node, uses, usedBy); ask every
      applicable template; print
- operation:
    name: explain
    depends: [corpus]
    promise: >-
      prints every template verbatim;
      --md prints the README table
    why: the questions must be readable without a key
- operation:
    name: suggest
    depends: [corpus, judge]
    promise: >-
      for a sentence, which unit fits,
      with the shape to write
    why: the first question an agent new to the library asks
```

## Order & status

Each ticket blocks the next one.

- **blueprint/t01** — [x]
  Package + node schema (zod, one object per kind;
  `name` without dots; `promise` and `why` required;
  `target` on resource, default `scope`).
  `readBlueprint`: yaml → nodes with `uses` / `usedBy`.
  Plain checks: unknown `depends`, duplicate `name`,
  `data` with zero writers.
  `cli` wiring for `check` (plain results only).
- **blueprint/t02** — [x]
  Template schema + `corpus` resource
  (load fails on unknown `applies` / `needs`).
  Seed templates: `GUIDE` (unit, target, needsDefer),
  the unit judges of `tools/jev/bank.mjs`,
  best-practices rules 3–15 that a design shows,
  hidden node, one writer per data,
  `why` fulfilled by a dep, same `why` on two nodes.
  `explain` (`--md`).
- **blueprint/t03** — [x]
  `engine` tag + `judge` resource
  (`ai` evaluate, 429 backoff).
  `check` asks every applicable template per node.
  Result list with `~` for a template not `proven`.
  Exit code. Seam tests with a `preset` judge.
- **blueprint/t04** — [x]
  First: reword `needsDefer` as a defect question
  ("holds something and promise/work never say it
  is released at close") and make `whyUnfulfilled`
  skip a node with no `depends` (or ask only
  "does why repeat promise").
  Evals: `evals/<id>/{bad,clean}/*.yaml`.
  A test runs them when a key is present, skips when not.
  Each template carries `status: proven | provisional`.
  The test fails when a `proven` template misses the bar
  (bad ≥ 50%, clean < 50%, gap ≥ 30).
- **blueprint/t05** — [x]
  `suggest "<words>"`.
  Remove `tools/jev/guide.mjs` and the `GUIDE` bank.
  README (agent loop: write → check → fix → code).
  `bin`, `files`, size lane; mutation alone ≥ 75;
  validate lanes.

## Ticket rules

- One package per contributor, own worktree (`docs/roadmap/contributor-brief.md`).
- Every operation has a seam test: `createScope({ tags: [engine(fake), corpusPath(fixture)], presets })`,
  `scope.run(check, { input })`, assert the result list. No network in tests.
- The corpus is data: a template is YAML, never code. A question a plain check can answer is a plain check.
- Every report ends with **Core feedback** (a failing snippet, not prose).

### Landed

One line per ticket: tag — sha — tests — size (B gzip) — mutation — notes.

- **blueprint/t01** — see the landing sha in `git log` —
  13 tests — 2726 (index + main + chunk) — 80.84 —
  writer-built (pi muse-spark), one fix round
  (a module `let` kept the file text for `respond`;
  now `check` returns `{ nodes, findings }`).
  Lead fix: the size lane summed the dist chunks
  (the entry alone measured a 140 B stub).
  Core feedback: `respond` cannot set the exit code.
- **blueprint/t02** — 24 tests — 4330 — 78.92 —
  writer-built (pi muse-spark, third launch: two
  provider drops before any write), one fix round
  (zod enums instead of casts; `--md` read at the row;
  `kind` in the verbatim print).
  Lead: `InvalidTemplate` message names the file and
  the issue path; discriminated union on `kind`;
  four seam tests for the print formats and the
  schema defaults lifted mutation 69.71 → 78.92;
  two loose `explain` tests deleted (covered exactly).
  Core feedback: sync `resolve`/`run` + `await` trips
  `await-thenable` in tests (first asker).
- **blueprint/t03** — 34 tests — 7155 — 75.09 —
  writer-built (claude/sonnet-5 after one pi drop),
  no fix round. Lead: probability on every template
  line; zod guard for the call; `state[compare]`
  instead of a reader table; root excluded from the
  lane; four seam tests (67.17 → 75.09). The 54
  uncovered mutants are the gateway path; proven by
  one real call (below).
  Real run on `examples/tracker.yaml` (2026-09-21):
  7 provisional findings, exit 0. Two template
  wordings already look wrong — t04 material:
  `needsDefer` fires on `db` and `tx`, which correctly
  need defer (a guide answer, not a defect);
  `whyUnfulfilled` fires on `dbPath`, a tag with no
  `depends` (nothing to fulfil).
  Core feedback: `Operation.Handle<T>` vs
  `Operation.Handle<Promise<T>>` for an async `run`
  compiles either way and mistypes `scope.run`.
- **blueprint/t04** — 57 tests — 10368 — 78.18 —
  writer-built (claude/sonnet-5), two rounds.
  Round 1 was a design change (ADR 0052 §5 amended):
  with 2+2 seed cases every template graded `proven`
  and the ADR's own example failed `check` with
  seven blocking hits at 50–57%. Now `enough` is
  5+5, `evals/golden.yaml` (the example) is a clean
  set for every template, one golden hit reads
  `noisy` whatever the case count, and `proven` is
  set by hand. Round 2: cast-free `target`/`compare`,
  `median` deduped, seam tests (68.82 → 78.18).
  Lead: golden veto before the case count; size cap
  20 kB (a binary, not a library).
  Real grade table (README "What is proven"):
  15 provisional, 2 noisy (`stopOnlyInDefer` 2/2,
  `whyDuplicate` 2/10 golden hits).
  Real `check` on the example: 5 `~` lines, exit 0.
  Core feedback: `label.mjs` cannot record a verdict
  on the GUIDE unit-classifier note ("reads like an
  operation") — second asker after t03.
- **blueprint/t05** — 62 tests — 11823 — 77.22 —
  writer-built (claude/sonnet-5), no fix round.
  `suggest "<words>"`, README rewritten as the agent
  loop, `bin` + `files` + shebang, two validate lanes
  (41/41), `tools/jev/guide.mjs` retired (`GUIDE`
  stays: `lint.mjs` uses it).
  Lead: `unitFits` choices got the GUIDE examples
  back — "a form draft the user edits before saving"
  read `unclear (operation 44%)`, now `data (92%)`;
  jev README judge table regenerated.
  Real `suggest`: "poll the API every 10s…" →
  resource 96%, target scope.
  Core feedback: the unit-classifier note is still
  unlabelable — third asker (card jev/label-unit).

## v1.1 — verify (ADR 0055)

- **blueprint/t06** — [x]
  `src/extract.ts` (oxc-parser): per declared unit
  `kind`, `label`, depends values as identifier
  roots, `target`, `body` text of `run`/`factory`.
  `verify <file> <dir>`: the five plain checks,
  same line format and exit codes as `check`.
  `packages/blueprint/blueprint.yaml`: every unit
  in `src`, `verify` on the pair prints nothing
  (a test, no key).
- **blueprint/t07** — [x]
  `body` as a state field; `check` skips templates
  that need it, `verify` asks them.
  `corpus/bodyStraysFromWork.yaml` (provisional).
  Eval schema gains `source:`; ≥ 2 bad + 2 clean;
  the golden pair's nodes are the clean cases.
  README: the loop's last step.

### Landed (v1.1)

- **blueprint/t06** — 73 tests — 14779 — 77.95 —
  writer-built (claude/sonnet-5), no fix round.
  `src/extract.ts` (oxc-parser through the catalog),
  `verify` with the five plain checks, the golden
  pair `packages/blueprint/blueprint.yaml` (11 nodes,
  `verify` prints `ok: 11 nodes, 11 units,
0 findings`; real `check` on it: 10 `~` lines).
  Lead: the golden-pair test finds the pair through
  the repo root — under Stryker the sandbox's `src`
  is instrumented, so `readUnits` saw no labels and
  the dry run failed; a stale `.stryker-tmp` copy
  then made vitest run the sandbox's test file too
  (`rm -rf .stryker-tmp` after every lane).
  Core feedback: `@tinker/cli` has no helper for
  "every non-flag positional, in order" — every
  two-argument command filters argv by hand
  (first asker).
- **blueprint/t07** — 81 tests — 16216 — 77.17 —
  writer-built (claude/sonnet-5), no fix round.
  `body` in the state; `verify` asks the templates
  that need it (a `bodyJudge` resource that is
  `undefined` with no key, so `verify` works
  without one); `corpus/bodyStraysFromWork.yaml`;
  evals with `source:`; the golden pair's bodies
  are its clean cases. Writer caught a real gateway
  reject (`body: undefined` in the state) only by
  running the real grade.
  Lead: `verify --key-file <path> file dir` read the
  key path as the file — one `positionals` reader
  for both rows now (the cli feedback row, proven).
  Real grade: bad 3 (med 87%), clean 14 (med 60%),
  sep 27%, golden 7/12 → `noisy`. Real `verify` on
  the golden pair with the key: 8 `~` lines at
  50–84%, exit 0. Next corpus job: split the ask
  (a step `work` names with no code / an effect the
  body has that `work` never says) and thicken the
  golden `work` lines.
  Core feedback: a cli `respond` cannot write to
  stderr on a code-0 outcome (first asker).

## v1.1 complete (2026-09-21)

`verify <file> <src>`: node ↔ unit by label, five
plain checks, then the body templates with a key.
The binary verifies itself: 12 nodes, 12 units,
0 plain findings. Open: the body template's wording
(`noisy`), `blueprint/devtool` (Parked).

## v1 complete (2026-09-21)

Five tickets, one day. What ships in `@tinker/blueprint`:
`suggest`, `check` (plain checks + 17 templates),
`explain`, `evals`; corpus and evals inside the
package; everything `provisional` until 5+5 labeled
cases and a clean golden set say otherwise.
Open: `blueprint/devtool` (Parked), `jev/label-unit`
(Ready), the two `noisy` templates' wording.

### Impact blocks (ADR 0047)

New package: every ticket's impact is `packages/blueprint/**` until t05, which also removes
`tools/jev/guide.mjs` and `GUIDE` in `tools/jev/bank.mjs` (repo tools; no SCIP table owed).
