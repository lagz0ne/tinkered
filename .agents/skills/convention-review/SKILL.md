---
name: convention-review
description: Use when reviewing a change to Core, React, or another package in this repo. Checks the diff against the coding-convention skill and the repo's landing rules, one rule ID per finding, JSON lines out. Read-only. Not for writing code; the writer uses coding-convention.
---

# Review a change

The [coding-convention](../coding-convention/SKILL.md) skill
tells the writer how to write.
This skill checks the same rules.
Each finding names one rule ID from the list below.

```text
write: coding-convention
  |
  v  commit
review: convention-review
  |
  v  findings
fix, or answer with a reason
  |
  v  review the new commits,
     and recheck open findings
out of rounds with an important finding:
the lead checks the approach
```

Rounds: the lead's card loop gives one fix round
(CLAUDE.md). The continuous review job stops
at three rounds.

## Scope

- Review only the change: `git diff <base>..HEAD`.
- A problem in code the change did not touch is `old`.
- Read coding-convention before the diff.
- Do not edit files. Report findings only.
- On a later round, recheck each open finding from
  earlier rounds at HEAD. It stays open until its code
  is fixed or the writer answers it.

## Gates first

Run the gates in CLAUDE.md, in its order:
`vp run -r build`, `vp check`, the package tests,
the strict style census for the changed folders,
and `vp run prose` when a `.md` file changed.
A red gate is finding `G1`, severity important.
Name the gate and its first error.

## Quick scan

These greps point at lines to read.
A hit is not a finding until you read the code.

```bash
D="git diff <base>..HEAD"
$D --name-only
$D | grep -nE '^\+.*process\.|Date\.now'
$D | grep -nE '^\+.*Math\.random|console\.'
$D | grep -nE '^\+.*throw new (Type)?Error'
$D | grep -nE '^\+.*(as unknown as|@ts-)'
$D | grep -nE '^\+.*(vi\.(mock|fn|spyOn))'
$D | grep -nE '^\+.*(\.only|\.skip)\('
$D | grep -nE '^\+.*(\.\./|\binterface |\benum )'
$D | grep -nE '^\+.*(//|get [a-z]+\(\) \{)'
```

## Rules

### G: gates

- `G1` Every gate in CLAUDE.md passes.

### C: coding-convention aims

The number is the aim's number in coding-convention.

- `C1` Trust the types. Check outside data once at the
  door. Effects enter at the seam (ADR 0113): no
  `process.*`, `Date.now`, `Math.random`, bare `fetch`,
  or `console.*` in a unit body.
- `C2` Errors come from the package's `src/errors.ts`.
  No bare `throw new Error`. No dropped promise.
- `C3` Nothing in `src` prints.
- `C4` State is plain records and string unions.
  No `enum`, no tuples read by index.
- `C5` `type`, not `interface`, unless TSDoc names
  the reason.
- `C6` One namespace per concept.
- `C7` `private`, never `#private` or `Reflect.*`.
- `C8` Names say the thing. No layer words.
  A function never returns a scope it made.
- `C9` Infer, do not restate. No facade or
  pass-through variable.
- `C10` TSDoc only. Each doc says what code cannot.
  No `@ts-ignore` or lint-disable line.
- `C11` YAGNI. No option, wrapper, or edge case
  the task did not name.
- `C12` Each handoff has an owner. A root's lifetime
  is Core's; never pass a scope to a helper.
- `C13` A new failure mode or lifecycle change lists
  every caller.
- `C14` A body reads as steps (ADR 0111).
  Wrong step marks are a nit.
- `C15` Imports name a place (ADR 0112): no `../`
  outside the two named exceptions.

### T: tests

- `T1` Package tests import only the package entry;
  app tests may import feature modules.
- `T2` No mocks, spies, global patches, or sleeps.
- `T3` One test names one public cause and one
  outcome. No test of a private helper.
- `T4` `isError` narrows by control flow, never
  inside `expect`.
- `T5` No `.only` or `.skip`.
- `T6` No test that only raises a mutation score
  or re-proves a promise from a second angle.
- `T7` A bug fix has a test that fails without it.

### P: speed (library code)

Use the F rules in coding-convention by number,
`F1` to `F14`. The common ones:

- `F3` Fields set at birth, in the same order.
- `F6` No per-call closures, arrays, or wrappers
  on a hot path.
- `F7` Sync work has no promise hop.
- `P2` No accessor in an object literal.
- `P3` No `Object.defineProperty` on a hot path.
- `P4` Make collections and controllers on first use.

A speed claim needs a flamegraph or a queue verdict.
Raw millisecond numbers are not proof.

### L: landing rules

- `L1` A public symbol changed across packages has an
  impact block and its SCIP `refs` (ADR 0065).
- `L2` A size claim has `pnpm validate` output.
- `L3` The package's mutation floor holds:
  85, or 75 for `@tinker/start`.
- `L4` A `.md` change passes `vp run prose`.

## Judge each finding

1. Read the code at the line, not only the diff.
2. Trace a real path from a caller or input to the
   broken rule. If you cannot, drop the finding.
3. Name the class of the problem, so the writer
   fixes every place, not one line.
4. If the rules do not decide the case, do not
   guess. Report it as a question and name the rule.

Severity:

- `important`: breaks a rule above on changed code,
  or breaks behavior.
- `nit`: style only.
- `old`: real, but the code was there before.
- `question`: the rules do not decide it.

All findings are advice. None blocks a merge.
The writer still fixes or answers each one.

## Report

One JSON line per finding, no other text:

```json
{"id":"slug","rule":"C2",
 "severity":"important",
 "file":"packages/core/src/x.ts",
 "line":12,
 "summary":"one sentence",
 "trigger":"the path that breaks",
 "fix":"one sentence"}
```

No finding: print `clear` and the gates you ran.
