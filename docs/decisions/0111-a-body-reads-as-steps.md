# 0111 A body reads as steps

Date: 2026-10-12. Status: accepted (user, 2026-10-12: "yes, the version 3 the one";
"everywhere, mostly changing to that as well as the skill").
Adds coding-convention rule 14 and two lint rules.

## Context

Function bodies were one block of lines with no blank lines.
App code glues many calls, so a reader could not see where one job ends.
Rule 10 bans line comments.
So inside a body, a blank line is the only way to mark a step.

The formatter cannot help.
Oxfmt keeps blank lines but never adds them.
Prettier, Biome and dprint do the same.

The precedent is the paragraph rule in *Code Complete* (McConnell, ch. 31):
group the lines of one step, and put a blank line between steps.
Tests already have a known shape: arrange, act, assert.
When a step needs a name, Kent Beck's Composed Method moves it into a function.

We tried ESLint's `padding-line-between-statements`.
It splits by statement kind: after each `const`, around each multi-line block.
On `changeTodo` it put a `const` in the step before the one that uses it.
So a kind-based rule fights the step rule.

## Decision

- Rule 14: a body reads as steps, one blank line between them.
- Only the writer knows the steps, so the writer places them.
- `vp lint` checks a floor that never fights a good split:
  - `tinker/body-steps`: a block of six or more statements has at least
    one blank line between statements.
    It has no fix.
  - `curly` with `multi-line`: a body on its own line gets braces.
    A guard that is too long for one line keeps its shape clear.
- A step change moves no line. It only adds or removes blank lines.
  So `git diff -w --ignore-blank-lines` of a step change is empty.

## Where ours is simpler

We check only that a long block has some step break.
Where the breaks go is left to the writer and the reviewer.
