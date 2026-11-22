# 0167 An app writes graph rules; tinker check tests them

Date: 2026-11-22. Status: accepted (Duke, 02:57
UTC, option A).
Adds to: ADR 0161 (the committed graph).

## What the user said

- 2026-11-21 23:35: "Cli should not do that by
  itself, writer just need a better use of graph
  output, so, likely improve the skill".
- 23:53: "This is not a new problem in the
  engineering world, how do those normally
  tackle".
- 2026-11-22 02:57: picked "Skill + written graph
  rule".

## Context

The CUJ chain (run 12) gave each writer three
steps on its own code. All of them passed. None
of them put a shared check in one operation. The
archive check was copied into four operations.

A copy is a risk when the rule changes. Step 4
(a viewer role) changes the rule. Each copy that
the writer misses is a bug.

The skill now tells the writer to read
`tinker.graph` before a check. That is a
guideline. A writer can skip it.

The known models put one place in charge, then
check that each action asked it:

- XACML: each action asks one Policy Decision
  Point.
- Pundit: `after_action :verify_authorized`
  fails an action that did not call `authorize`.
- ArchUnit: a test states which classes may use
  which. The build fails when the code breaks it.

The tool does not guess in these models. A person
writes the rule. The tool tests facts against it.

## Decision

1. `tinker.json` takes `graph.rules`. Each rule
   names a cell pattern and an operation:

   ```json
   "graph": { "rules": [
     { "writes": "issues.*",
       "calls": "issues.canWrite",
       "except": {
         "team.create.do": "No team yet."
       } }
   ] }
   ```

2. Meaning: each operation whose `writes{}` has a
   cell that matches must have the operation in
   its `calls{}`, directly or through an op it
   calls.
   - The named operation itself is exempt.
   - `except` names an operation with its reason,
     as every exception in `tinker.json` has.
   - `*` matches one label part or more.
3. The `graph` stage of `tinker check` tests each
   rule. Each operation that breaks one is a
   `tinker/graph-rule` finding:

   ```text
   src/issues/ops.server.ts:88 tinker/graph-rule
     team.archive.do writes{issues.archived.set},
     calls has no issues.canWrite
   ```

4. No rule, no finding. The CLI finds no copy by
   itself.
5. One kind of rule only: `writes` with `calls`.
   The ArchUnit "only read by" form waits for a
   real case.
6. A `?` in the op's graph line (ADR 0161) means
   the stage cannot see its calls. Such an op is
   a finding too: the rule cannot be proved.
7. The operation skill names the rule and shows
   it. The writer of a shared check adds the rule.

## Not chosen

- The CLI finds copies by itself (fan-in, clone
  share). Duke: the CLI does not judge.
- The check as an rpc start hook. It would turn
  `forbidden` from an answer into a refusal.
