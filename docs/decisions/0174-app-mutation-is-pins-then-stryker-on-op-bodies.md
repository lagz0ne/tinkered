# 0174 app mutation is pins, then Stryker on op bodies

Date: 2026-11-28. Status: accepted (Duke,
2026-11-28 06:26 UTC, option A).
Adds to: ADR 0173 (`tinker pins`).
Keeps: ADR 0170 (package mutation in CI).
Page: Graph Mutants, v3.

## What the user said

- 2026-11-28 01:04: "With this, how far might
  we go to eliminate stryker (or we should use
  a combined technique with much more
  meaningful Stryker)".
- 2026-11-28 06:26: picked "A: Split, on
  changed ops".

## Context

Graph mutants check the seams of an op:
its answer, its writes, its calls.
They cannot see logic inside the op body:
`<` for `<=`, `*` for `/`, a flipped test.

Most app ops have few seams:

- Hedl: 536 of 683 ops answer one `value`
  and write nothing.
- acountee: 230 of 383.

So in an app, Stryker still owns the body.
Today it mutates whole files, and runs a big
part of the suite for each mutant.

## Precedent

- **Sufficient mutation operators**
  (Offutt et al. 1996): a few operator kinds
  give almost the full score.
- **Arid nodes, mutants on changed lines**
  (Petrović, Google 2021).
- **Safe test selection** (Google TAP):
  a test with unknown reach counts as
  affected.

## Proof

Probe, project files
`plans/graph-mutants/combo/`.

Lab, 118 Stryker survivors:

- 92 on declarations, 5 on message text;
- 5 on seams (graph mutants find them too);
- 16 on logic in a body.

Logic mutators on op bodies only:
84 mutants, not 389; 12 of the 16 found.

Hedl, 6 random ops, body only:

- All mutators: 123 mutants.
- Logic mutators: 52 mutants.
- Tests from the trace only: 46.2%.
  Not safe: 83 of 188 test files use
  `createScope({})` and leave no trace.
  3 of 3 survivors died in those files.
- Trace files plus the 83: 82.7%,
  24 s a mutant. 2 of 2 survivors checked
  also live under the whole suite.
- Whole suite: 634 s a mutant.

## Decision

1. App mutation runs on the ops that a change
   touches, in two steps.
2. Step 1: `tinker pins --since <base>`.
   Facts only, as ADR 0173 says.
3. Step 2: Stryker on the `run` body of each
   changed op (`mutate: ["file.ts:30-50"]`).
4. Logic mutators only. These are excluded:
   `ArrayDeclaration`, `ArrowFunction`,
   `BlockStatement`, `ObjectLiteral`,
   `StringLiteral`, `Regex`.
5. Tests for an op: the files whose trace
   reached it, plus every file with no trace.
6. `tinker pins --json` gives step 2 its input:
   each changed op's path, body lines, and
   test files. No new flag.
7. The app floor stays 60, on these mutants.
8. A test scope lists `exits` first, as the
   app rules say. Each one that does shrinks
   the set of files with no trace.

## Not in this decision

- Core, React, CLI: ADR 0170 stays.
- A whole-app nightly Stryker run.
- Mutant switching in one process.
