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

- **blueprint/t01** — [ ]
  Package + node schema (zod, one object per kind;
  `name` without dots; `promise` and `why` required;
  `target` on resource, default `scope`).
  `readBlueprint`: yaml → nodes with `uses` / `usedBy`.
  Plain checks: unknown `depends`, duplicate `name`,
  `data` with zero writers.
  `cli` wiring for `check` (plain results only).
- **blueprint/t02** — [ ]
  Template schema + `corpus` resource
  (load fails on unknown `applies` / `needs`).
  Seed templates: `GUIDE` (unit, target, needsDefer),
  the unit judges of `tools/jev/bank.mjs`,
  best-practices rules 3–15 that a design shows,
  hidden node, one writer per data,
  `why` fulfilled by a dep, same `why` on two nodes.
  `explain` (`--md`).
- **blueprint/t03** — [ ]
  `engine` tag + `judge` resource
  (`ai` evaluate, 429 backoff).
  `check` asks every applicable template per node.
  Result list with `~` for a template not `proven`.
  Exit code. Seam tests with a `preset` judge.
- **blueprint/t04** — [ ]
  Evals: `evals/<id>/{bad,clean}/*.yaml`.
  A test runs them when a key is present, skips when not.
  Each template carries `status: proven | provisional`.
  The test fails when a `proven` template misses the bar
  (bad ≥ 50%, clean < 50%, gap ≥ 30).
- **blueprint/t05** — [ ]
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

- (none yet)

### Impact blocks (ADR 0047)

New package: every ticket's impact is `packages/blueprint/**` until t05, which also removes
`tools/jev/guide.mjs` and `GUIDE` in `tools/jev/bank.mjs` (repo tools; no SCIP table owed).
