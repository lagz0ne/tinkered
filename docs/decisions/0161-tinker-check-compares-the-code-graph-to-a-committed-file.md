# 0161 tinker check compares the code graph to a committed file

Date: 2026-11-16. Status: accepted (Duke, 14:42
UTC, option A).
Adds to: ADR 0156 (`tinker check`), ADR 0159 (the
exit gate).

## What the user said

- 13:12: the CUJ check "also want to check the
  graph of primitives because that's the most
  important part. Secondly, the span will indicate
  the correctness of implementation."
- 13:15: "if we are able to detect that off the
  cli, won't that be way better and faster the
  iteration?"
- 13:43: "Yes, surely" (the graph goes into the
  CLI).
- 14:42: picked "Committed graph file".

## Context

The CUJ eval audit (2026-11-16) seeded wrong apps.
Two of them passed every gate: the journeys, the
types, the exit gate, and the shape print.

- A stale move wrote the issue anyway.
- `team.create` on a team that exists added the
  caller to it.

The exit gate proves a test reaches each exit. It
does not prove what the exit wrote.

A scratch script read the code only. For each
operation and each exit it listed the cell writes
that run before that return. It caught both bugs
as a one-line change:

```text
issue.move.do  stale  writes{}
issue.move.do  stale  writes{issues.set}
```

It does not catch logic inside a condition (`>`
in place of `!==`). Journeys and spans keep that.

An earlier proof on Hedl (2026-11-09) read 800
operations from code in 3 s. Of the ops that ran
in 1,462 tests, 97% matched the static shape.

The known models:

- API Extractor writes an `.api.md` report. The
  build fails when the code and the file differ. A
  reviewer reads the diff.
- A Jest snapshot works the same way for a value.
- The reflexion model (Murphy and Notkin) checks
  facts from code against facts seen at run time.

## Decision

1. `tinker graph --write` writes the app's graph
   to `tinker.graph` at the app root. The app
   commits it.
2. `tinker check` gets a stage `graph`. It runs
   after `rules` and before `tests`, because it
   needs no run.
3. The stage builds the graph from the code and
   compares it to the file. Each line that
   differs is a `tinker/graph` finding:

   ```text
   src/issues/ops.server.ts:88 tinker/graph
     issue.move.do stale: writes{issues.set},
     tinker.graph says writes{}
   ```

4. One line per operation and exit. An exit is
   the word of ADR 0159: each answer `kind`,
   `refused`, or `value`.
5. Each line lists, for the path to that exit:
   - `reads`: the cells and reads it reads;
   - `writes`: the cells it writes;
   - `calls`: the operations it runs.
6. A cell or op is named by its label, from the TS
   checker, never by a local name.
7. A write counts for an exit when it runs on the
   way to that return: in a statement before it,
   in a block that holds it.
8. The graph reads `src` and `cmds` only, as the
   exit gate does.
9. No `tinker.graph` file is a finding that says
   to run `tinker graph --write`.
10. The skill section `tinker/graph` says what to
    do: if the change is meant, run `--write` and
    let the diff be reviewed; if not, fix the code.
11. In the eval, the kit's golden is the golden
    app's `tinker.graph`. The scorer builds the
    writer's graph from code and compares it to
    the kit's file, not to the writer's file.

## Amended 2026-11-17: facts only, one line per op

What the user said:

- 05:39: "The read should have only unified way."
- 05:44: "let the tool, be a tool, giving a result
  based off what is written for, cannot be wrong.
  The judgement is for the reader of the graph,
  which is LLM."
- 05:46: "There might be more than a way to
  organize the states and the flows. And the CUJ
  needs to say if the graph looks ok … and when
  not (violations in place)."

Why: the review of the first build found two
wrong paths. Each was a guess about which write
runs before which return. A guess can be wrong.

This replaces points 4, 5, 6, 7 and 11:

1. One line per operation, not per exit.
2. Each line holds only what Tinker declares or
   the code says:
   - `exits`: the exit words of its answer type;
   - `reads`, `writes`, `calls`: every one in
     the body, with no path;
   - deps come from the op's type, by the TS
     checker, so `depends: shared` and
     `...shared` read the same.

   ```text
   issue.move.do exits{gone,moved,stale}
     reads{issues.list.of}
     writes{issues.list.set}
     calls{issues.inTeam}
   ```

3. The graph never guesses which write comes
   before which return. That judgement is the
   reader's: a person or an LLM reads the line
   beside the code.
4. The stage still compares the code to the
   committed file. A change is a finding, so it
   gets read.
5. The eval does not match a golden file. There
   can be more than one good shape. The CUJ lists
   rules, and each rule answers OK or names a
   violation at a file and line:
   - a rule the facts decide is plain code over
     the graph ("every call that names a team
     calls `issues.inTeam`");
   - a rule that needs reasoning goes to the LLM
     reader, with the graph and the code ("a
     `gone` answer writes nothing").
6. The golden passes every rule. Each seeded
   fault gives a violation.

What it costs: a stale move that writes is no
longer a one-line diff, since the op writes that
cell on another exit. A judged rule finds it, and
later the spans, which record the exit that ran.

The known models:

- dependency-cruiser and ArchUnit: rules over a
  fact graph, each broken rule named.
- The reflexion model: a stated model against
  the facts, with each mismatch listed.

## Later, not in this step

- The spans cross-check: the test run's spans
  against the graph (reflexion model). A
  divergence becomes a finding.
- Units and capsule exports in the graph.

## Where ours is simpler

- One text file, one line per operation, sorted.
- No new API in Core or in the contract.
