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
    promise: which model and key the judge uses; rebound in tests
- tag:
    name: corpusPath
    promise: the folder of templates; the shipped one by default; rebound in tests
- resource:
    name: corpus
    depends: [corpusPath]
    promise: every template loaded once per scope; a template naming a field the node schema lacks fails the load
    work: read corpus/*.yaml; zod-parse each; check applies and needs against the node schema
- resource:
    name: judge
    depends: [engine]
    promise: one Jev client per scope; asks, never writes
    work: evaluate({ state, questions }) with retry on 429
- operation:
    name: check
    depends: [corpus, judge]
    promise: for one blueprint file, one result line per plain check and per (node, template) pair; exit 1 only on a plain failure or a proven hit
    work: parse the file; plain checks; for each node build state (node, uses, usedBy); ask every applicable template; print
- operation:
    name: explain
    depends: [corpus]
    promise: prints every template verbatim; --md prints the README table
- operation:
    name: suggest
    depends: [corpus, judge]
    promise: for a sentence, which unit fits, with the shape to write
```

## Order & status

| tag           | ticket                                                                                                                                                                                                                                                                            | blockers | status |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| blueprint/t01 | Package + node schema (zod, one object per kind) + `readBlueprint` (yaml → nodes with `uses`/`usedBy`) + plain checks (unknown `depends`, duplicate `name`, `data` with zero writers) + `cli` wiring for `check` (plain results only)                                             | —        | [ ]    |
| blueprint/t02 | Template schema + `corpus` resource (load fails on unknown `applies`/`needs`) + seed templates: `GUIDE` (unit, target, needsDefer), the unit judges of `tools/jev/bank.mjs`, best-practices rules 3–15 that a design shows, hidden node, one writer per data + `explain` (`--md`) | t01      | [ ]    |
| blueprint/t03 | `engine` tag + `judge` resource (`ai` evaluate, 429 backoff) + `check` asks every applicable template per node; result list with `~` for a template not `proven`; exit code; seam tests with a `preset` judge                                                                     | t02      | [ ]    |
| blueprint/t04 | Evals: `evals/<id>/{bad,clean}/*.yaml` + a test that runs them when a key is present and skips when not; each template carries `status: proven \| provisional`; the test fails when a `proven` template misses the bar (bad ≥ 50%, clean < 50%, gap ≥ 30)                         | t03      | [ ]    |
| blueprint/t05 | `suggest "<words>"`; remove `tools/jev/guide.mjs` and the `GUIDE` bank; README (agent loop: write → check → fix → code); `bin`, `files`, size lane; mutation alone ≥ 75; validate lanes                                                                                           | t04      | [ ]    |

## Ticket rules

- One package per contributor, own worktree (`docs/roadmap/contributor-brief.md`).
- Every operation has a seam test: `createScope({ tags: [engine(fake), corpusPath(fixture)], presets })`,
  `scope.run(check, { input })`, assert the result list. No network in tests.
- The corpus is data: a template is YAML, never code. A question a plain check can answer is a plain check.
- Every report ends with **Core feedback** (a failing snippet, not prose).

### Landed

| tag | sha | tests | size (B gzip) | mutation | notes |
| --- | --- | ----- | ------------- | -------- | ----- |

### Impact blocks (ADR 0047)

New package: every ticket's impact is `packages/blueprint/**` until t05, which also removes
`tools/jev/guide.mjs` and `GUIDE` in `tools/jev/bank.mjs` (repo tools; no SCIP table owed).
