# 0173 tinker pins names the graph facts no test pins

Date: 2026-11-28. Status: accepted (Duke,
2026-11-28 00:53 UTC, option A).
Adds to: ADR 0159 (the exit gate),
ADR 0161 (the committed graph).
Page: Graph Mutants, v2.

## What the user said

- 2026-11-27 06:37: "this should be a thread
  for testing anti errorsion. With capsule and
  graph, we actually have way more efficient way
  to know whether a test is an efficient".
- 2026-11-28 00:53: picked "A: tinker pins,
  facts only".

## Context

The exit gate counts reach only.
A test that runs an exit and checks nothing
about it passes the gate.

Stryker finds such tests, at a high cost:

- Hedl CI: 81 mutants took 2 h 50 min.
- Hedl's weekly full run stops at 6 h,
  and has not finished.

A capsule hook sees each run, write and call.
`tinker.graph` names each exit, write and call.
So one fault can go at one graph fact,
with no source edit and no rebuild.

## Precedent

- **Extreme mutation** (Descartes,
  Niedermayr 2016): empty a method's answer;
  if tests pass, the method is pseudo-tested.
- **Interface mutation** (Delamaro 2001):
  a fault at the call between two units.
- **Test impact analysis** (Google TAP):
  run only the tests that touch the change.
- **Mutants in code review** (Petrović,
  Google 2021): mutants on changed lines only,
  shown to the reader, never a gate;
  arid lines get no mutant.

Ours is simpler: the graph already names the
seams, so there is no parser of expressions.

## Proof

Probe, project files `plans/graph-mutants/`:

- Lab: 43 mutants, 51 s, 1 process.
  Stryker: 389 mutants, 13 CPU-min.
- Where the probe found a live mutant,
  Stryker had survivors on the same lines.
- Hedl: 8.5 s a mutant, 1 test file (median).
- acountee: 9.0 s a mutant.
- It found #74 (fixed, ed150600).

## Decision

1. A new command of `@tinkered/cli`:

   ```sh
   tinker pins [root] [--since ref] [--json]
   ```

2. It reports facts. It never fails for a live
   mutant. Exit 1 only when it cannot run:
   no `tests` in `tinker.json`, or a test file
   that is red with no mutant.
3. The hook is the `exits` capsule of
   `@tinkered/cli/test`. No new export.
   Tests already list it first.
   It gains a `write` hook.
   It reads two values that `tinker pins`
   sets: `TINKER_TRACE` and `TINKER_MUTANT`.
   With neither, it does what it does now.
4. Trace: one run of each test file, with
   `TINKER_TRACE`. Each line is a fact the file
   reached: `exit`, `write`, `call`, and one
   sample answer for each exit.
5. A mutant is made only for a fact that
   `tinker.graph` states. The tool guesses
   nothing:
   - **swap**: the op answers another of its
     declared exits (a sample from the trace)
     where it answered this one;
   - **empty**: the op's answer keeps its
     `kind`; each other field is emptied;
   - **drop**: one write of a cell the op's
     `writes{}` names is lost;
   - **fail**: one call that the op's
     `calls{}` names throws.
     A `slot:` call is the op the trace shows.
     A hook's write or call (#72) has no line,
     so it gets no mutant.
6. `--since <ref>`: only ops whose lines
   changed since `ref`. With no `--since`,
   every op.
7. Each mutant runs the test files whose
   trace has its fact.
   A file whose run wrote no trace line is
   unknown, not "reaches nothing".
   It runs for every mutant (TAP: unknown
   means affected).
   Proof (2026-11-28, Hedl): 83 of 188 files
   use `createScope({})`. One of them killed
   a mutant the traced files left alive.
   A scope in a traced file that does not list
   `exits` is still not seen: a known limit.
8. Line shape, one per live mutant:
   `<path>:<line> <op> <kind> <fact> lives`,
   then `  reached by: <files>`.
   The last line counts: mutants, live, files,
   and files not traced.
9. A scope with no capsule stays as it is:
   a capsule would give it a start.
   Its runs are not traced.

## Not in this decision

- Mutant switching in one process (Stryker's
  switch): a later card, when time says so.
- Faults inside one op (`>` for `>=`):
  Stryker's job, on op bodies.
- A gate: Duke picked facts only.
