# 0175 tinker check compares the writes of each exit to a committed file

Date: 2026-11-28. Status: accepted (Duke,
2026-11-28 10:58 UTC, option A).
One point is open: see "Open".
Adds to: ADR 0159 (the exit gate),
ADR 0161 (the committed graph).
Uses: ADR 0173 (the `exits` write hook).
Page: Tinker Test Check, v2.

## What the user said

- 10:04: "what is an biased way to drive the
  testing, similar to what we gain with the
  tinker check driving the golden code. let's
  say golden test, non erosion".
- 10:13: "biased toward writing test the optimal
  way to tinker. Because the code is optimized
  in the tinker way with tinker check, I think
  we can do the same for writing test".
- 10:38: "be more in depth to the value of the
  graph, the seam and other current value in
  the scope as devtools".
- 10:58: picked "A": a committed file that
  `tinker check` compares.

## Context

The exit gate counts reach only.
`tinker.graph` has one line per operation.
It does not say which exit writes what.

ADR 0161 first read that from code, per exit.
It was dropped on 2026-11-17: which write runs
before which return was a guess.

A test run is not a guess.
A capsule hook sees each run, its exit, and
each write inside it.

The case that passes every gate today:

- a bug: a stale rename writes the title;
- the 6 assert lines that read the list after
  the stale answer are deleted;
- `tinker graph --write` accepts the change.

Then 223 tests pass and `tinker check` is OK.
The graph diff shows one new read.
The write goes through `issues.record`, which
the operation called before too.

## Precedent

- **Reflexion model** (Murphy and Notkin):
  facts from code against facts seen at run
  time. ADR 0161 names it.
- **API Extractor**: the tool writes a report,
  the build fails on a difference, a person
  reads the diff. ADR 0161 names it.
- **Frame condition** (JML `assignable`, Dafny
  `modifies`): what a call may change, and
  nothing else.
- **Dynamic invariants** (Daikon, Ernst 2001):
  state what held in every run seen.

Ours is simpler: no search for a rule.
One fact per exit: the set of cells written.

## Proof

Lab, project files `plans/test-check/lab2/`.
The golden app of chain step ck12, 0.34.19:
33 operations, 223 server tests.

- 77 lines. Two full runs gave the same file.
- 12 lines hold more than one write set.
- The case above changes one line:

  ```text
  - issue.rename.do stale writes{}
  + issue.rename.do stale
  +   writes{issues.events,issues.list}
  ```

- Test time: no change we could measure
  (16 to 22 s with and without, hand timing).
- All tests stay green with the hooks.

## Decision

1. A file at the app root holds, for each
   operation and exit a test reached, the cells
   written inside that run. The app commits it.
2. One line per operation, exit and write set:

   ```text
   team.create.do created writes{issues.members}
   team.create.do exists writes{}
   ```

3. A write is inside a run when the operation
   makes it, or an operation it runs makes it.
   So the line says what the caller's call
   changed.
4. A cell is named by its label, with no verb.
   The cells of a line are sorted.
5. An exit with two write sets has two lines.
   Example: `team.archive.do archived` writes
   `issues.archived`, or nothing when the team
   is archived already.
6. The file holds only what `tinker.graph`
   names: an operation with a line there, and
   a cell that some line there names.
   So a library's cells and a test's own cells
   have no place in it.
7. The `exits` capsule reports the facts: for
   each run, its exit and the cells written
   inside it. No new export.
8. `tinker check` compares after the `exits`
   stage. Each line that differs is one
   finding, in both directions:

   ```text
   src/issues/ops.server.ts:204 tinker/effect
     issue.rename.do stale:
     writes{issues.events,issues.list},
     file says writes{}
   ```

9. Facts only. The tool does not say which
   side is right. A skill section teaches the
   rule id: if the change is meant, write the
   file again and let the diff be reviewed;
   if not, fix the code.
10. No file is one finding that says how to
    write it, as ADR 0161 point 9.
11. A scope that does not list `exits` gives
    no line, as ADR 0173 point 7.
12. A write is tied to its run as `tinker pins`
    ties it: `AsyncLocalStorage`, made only
    when the check asks for these facts.
    Core gives nothing for this.
    The store keeps the run's own set of cells,
    so one run's exit goes with its writes.
13. A page test gives no line: a page has no
    such store. `tinker pins` has the same
    limit, by design.

## Open

- The command that writes the file, and the
  file's name. Asked on 2026-11-28.

## Not in this decision

- "Answer read" as part of `tinker/exit`:
  asked on 2026-11-28, open.
- Whether a test looks at each written cell:
  a fact line. The lab's rule had 2 false
  alarms in 23.
- The static test rules (`exits` first, no
  mock, no real time, each scope closes).
- A label for a remote copy of a cell.
  Today each copy is `anon`.
