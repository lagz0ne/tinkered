# 0159 A test reaches each exit an operation declares

Date: 2026-11-16. Status: accepted (Duke, 05:21
and 06:20 UTC).
Adds to: ADR 0156 (`tinker check`).

## What the user said

- 2026-11-16 03:40: the cli "should be much more
  powerful to support the solid 100% right code".
- 05:21: picked "Spans against the shape".
- 06:13: "let's make it simpler ... NOT making
  things less explicit".
- 06:20: picked "Tests are a stage of the check".

## Context

The CUJ eval gave the proof. The golden code
declared 15 server exits. Its journeys reached 12.
No test reached the `gone` answer of three calls.

We then removed the member check from those three
calls. 14 of 15 journeys still passed. An access
hole passed every gate.

The known model is branch coverage with a floor:
Jest `coverageThreshold` fails the run when a
branch has no test. A line is too small a unit
here. The unit a reader of a Tinker app cares
about is an exit.

## Decision

1. An **exit** is one way out of an operation, as
   the return type of its `run` declares it:
   - each `kind` of an answer;
   - `refused`, for a hook's `refuse(payload)`;
   - `value`, for every other return.
2. `tinker check` reads the declared exits with
   the type checker, from the app's own
   `tsconfig.json`. It reads types, not syntax.
3. A test scope lists the capsule `exits` from
   `@tinkered/cli/test`. It writes the exit of
   each run to a file. A scope that does not list
   it reaches no exit.
4. `tinker.json` names the test command:

   ```json
   { "tests": "bun run test" }
   ```

   With it, the check runs two more stages after
   rules: tests, then exits. The check gives the
   command the file's path in `TINKER_EXITS`.

5. Red tests print the end of their output, and
   no exit finding.
6. Each declared exit that no test reached is a
   finding with the rule id `tinker/exit`. Its
   fix text is in the Core skill `core/testing`.
7. An app with no `tests` runs types and rules
   only, as before.

```text
src/issues/ops.server.ts:41 tinker/exit
`issue.move.do` answers `gone`, and no test
reaches it
```

## Why not

- **Read the test text for each kind.** A test
  can name a kind and not reach it.
- **Read the last run's file** (`nyc
check-coverage`). A stale file says OK for
  code that has changed.
- **A global hook** (React DevTools). A scope is
  seen only when it lists the capsule. Nothing
  is hidden.

## Not decided

- An exit that only a browser test reaches. The
  capsule writes with `node:fs`. A page needs a
  sink of its own.
- Core may put the exit on the operation's span
  (`tinker.exit`). The state map work owns that.
  Then the capsule reads the span, and no longer
  looks for the refusal's brand.

## Consequences

- An operation with a literal `label` is checked.
  A label made at run time is not.
- A file under `src` or `cmds` declares exits. A
  test file declares none.
- The base under `tinker/` declares none. It is
  Tinker's code, and it moves into a package
  with tests of its own. In the template, 13 of
  its exits had no test scope with the capsule.
- A thrown error is not an exit. A fault table
  is a later step.
- `@tinkered/cli` has Core as an optional peer:
  only `@tinkered/cli/test` imports it.
