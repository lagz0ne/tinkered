# 0055 `verify` links a blueprint node to code by label, diffs the shape in plain code, and asks Jev about the body

Date: 2026-09-21. Status: accepted. Builds on: 0052 (a blueprint is the `.d.ts` of a tinker app;
"integrity is a later decision"), 0054 (a Jev use is earned by calibration; blueprint ↔ code
integrity named as the next use).

## Context

After `check`, the blueprint is a judged design; then code gets written, and nothing looks back.
A node's `work` line can drift from its `run` body the day after. ADR 0052 said the parsed node
tree makes integrity cheap. What was missing: how a node finds its unit, and which questions are
plain code versus Jev.

**The analogy is `tsc` checking a `.d.ts` against its `.js`: by name.** A declaration and its
implementation are matched by the exported name, the shapes are compared by the compiler, and
nothing else is inferred. Ours is simpler: the match key is the unit's `label`, and there are
only two shapes to compare (kind and edges).

## Decision

1. **Link by label.** A blueprint node named `x` is the unit whose `label` is `"x"`
   (`data({ label: "x" })`, `resource({ label })`, `operation({ label })`, `tag({ label })`).
   No registry, no comment, no decorator. A frame's part (`store.tx`) is not a unit of its own;
   the blueprint rule stands (a name is a node), so a dotted dependency in code reads as a
   `dependsMismatch` until the app names that part as its own unit.

2. **`blueprint verify <file.yaml> <src-dir>`.** The binary parses every `*.ts` under the dir with
   its own extractor (`oxc-parser`, a dependency of the package): per declared unit, `kind`,
   `label`, the `depends` values (identifier roots: `engine.optional` → `engine`), `target`, and
   the body text of `run` / `factory`. `tools/jev/extract.mjs` stays repo tooling; the package
   imports nothing from it.

3. **Plain checks first, all blocking.** `missingUnit` (a node with no unit of that label),
   `undeclaredUnit` (a `data`/`resource`/`operation`/`tag` unit with no node; plain functions and
   glue are ignored), `kindMismatch`, `dependsMismatch` (the node's `depends` set against the
   labels the unit's `depends` values resolve to, in the same source set), `targetMismatch`.
   Same line format and exit codes as `check`.

4. **One Jev question per node, from the corpus.** A template may name `body` in `needs`; the
   state field `body` is the unit's `run`/`factory` text. `verify` asks the templates that need
   `body`; `check` skips them (it has no code). The first: `bodyStraysFromWork` — "does the body
   do something `work` does not say, or skip a step `work` names?" It ships `provisional` and
   earns `proven` only past ADR 0052 §5's bar.

5. **The binary is its own golden pair.** `packages/blueprint/blueprint.yaml` describes every
   unit in `packages/blueprint/src`; `verify` on that pair must print zero plain findings (a
   test, no key), and its nodes are the golden clean cases for `bodyStraysFromWork` (as
   `evals/golden.yaml` is for `check`). An eval for a `body` template carries a `source:` block
   beside its blueprint.

## Consequences

- The agent loop gains a last step: `suggest` → write the file → `check` → write code →
  `verify`. A drifted `work` line, a renamed unit, or an edge added in code without a node is a
  blocking line.
- `label` becomes a contract, not a log string: renaming a unit's label is renaming a node.
- The plain diff is cheap enough to run in CI without a key; the Jev half stays advisory until
  proven.

## Alternatives rejected

- A registry or a `blueprint:` comment on each unit: a second name to keep in sync; the label
  already exists and already means "this unit".
- Reusing `tools/jev/extract.mjs` from the package: ADR 0052 §6 — the package imports nothing from
  the repo's tools; and the extractor there reads depends *keys*, the blueprint needs the values.
- One broad question ("does this code implement this design?"): a multi-hop read Jev is weak at;
  five plain diffs and one narrow body question cover it.
