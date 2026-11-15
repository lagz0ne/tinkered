# 0156 One CLI, and its check corrects the writer

Date: 2026-11-15. Status: accepted in its parts
(Duke, 11:25 to 13:37, quoted below); not built.
Replaces: ADR 0145 decisions 1 and 2 (the package
and the command). Its rules and exit codes stay.
Adds to: ADR 0143 (skills), ADR 0129.

## What the user said

Duke, 2026-11-15:

- 11:25: "Stick to the defensive discriminate
  union where the wrong case unwrap will be failed
  at type level (and we tight the type casting of
  using as so they won't be abused)".
- 11:37: "Should have based off configuration".
- 11:41: "Let's move analyze to cli so that'll be
  a part of that. A house for most of operations
  (including skill)".
- 11:47: "Tinker is agent first. Make it biased as
  such. The ultimate goal is cheaper model is
  capable of writing the code at 100% golden,
  thanks to the correction loop (of the tool),
  based off type error correction and then the
  skill as guideline".
- 13:37: he chose "In the skill, the tool reads
  it" for where the fix text lives.

## Context

Trials on the template, 2026-11-15, found three
things.

1. **A writer runs five commands from three
   tools.** `tinker-analyze check`, `vp check`,
   `tsc`, and two `intent` commands. Some cheap
   writers did not run all of them.
2. **A cheap writer's own report is wrong.** One
   said "failed" and passed the hidden test. One
   said "works" and did not.
3. **Two holes no check saw.**
   - A call answers a union by `kind`. The board
     page showed 1 of the 6 kinds that are not
     success. The rest showed nothing.
   - The board page had 10 casts. One,
     `value as never`, sent any string to the
     server.

The precedents:

- **cargo, deno, `vp`:** one CLI holds check,
  lint and format.
- **rustc, Elm:** an error prints its fix
  (`help:`), and `rustc --explain` prints more.
- **Aider, SWE-agent:** the harness runs the
  check after each edit, not the model.
- **Next.js took `next lint` out:** the wrapper
  hid the lint config. So ours hides none.

## Decision

1. **One package, one bin.** `packages/cli`,
   named `@tinkered/cli`, bin `tinker`. The code
   of `@tinkered/analyze` moves into it. That
   package ends.
2. **Three commands.**

   ```text
   tinker check [root]
   tinker skill list
   tinker skill load <skill>
   ```

   Intent stays the carrier under the two skill
   commands (ADR 0143 decision 2).

3. **`tinker check` runs every fast gate.** In
   two stages:
   - **types:** `tsc`, the kind gate, the cast
     gate.
   - **rules:** the rules of ADR 0145, and the
     app's other lint.

   Tests and the build are not in it.

4. **The output is for an agent.**
   - Only the first stage that fails prints.
   - A finding is one line, then its fix:

     ```text
     src/a.tsx:64 tinker/kind "locked" has no case
       Add: case "locked": return …;
       Do not add `default:`. Do not cast.
       more: tinker skill load react
     ```

   - At most 5 findings. One fault prints once.
   - The last line is the next step.
   - `tinker check: OK` and exit 0 is the only
     sign that the work is done.
   - `--json` prints the same findings.
   - Exit codes stay: 0, 1, 2.

5. **The kind gate, `tinker/kind`.** A call's
   answer is a plain union by `kind`. A page
   reads it through a `switch` with a case for
   each kind, and no `default`. There is no
   helper type and no helper component.
   - `noImplicitReturns` makes `tsc` fail on a
     kind with no case.
   - The lint rule `switch-exhaustiveness-check`
     names the kind.
6. **The cast gate, `tinker/cast`.** No `as`,
   but `as const`. No `!`. No `any`. The writer
   narrows or parses:
   - a form field: `FormData` and `typeof`;
   - an enum: `find` in the list of values;
   - a fault: `api.fault.is(error)`;
   - a payload: a zod `safeParse`.
7. **One base config.** The package exports it.
   An app extends it, and says where it applies:

   ```ts
   import { gates } from "@tinkered/cli/config";

   lint: {
     overrides: [
       { files: ["src/**"], rules: gates },
     ],
   }
   ```

   ```json
   { "extends": "@tinkered/cli/tsconfig.json" }
   ```

   `tinker check` runs the app's own config. It
   has no config of its own for lint or types.

8. **The fix text lives in the skill.** A skill
   already has a section per mistake, with the
   rule id in its heading:

   ```md
   ### HIGH: a cast [tinker/cast]
   ```

   `tinker check` prints the `Right:` part of
   that section. `vp run skills` fails when a
   rule has no section.

9. **Names.** `tinker-analyze.json` becomes
   `tinker.json`. The lint plugin becomes
   `@tinkered/cli/lint`. Rule ids keep the form
   `tinker/<name>`.

## Where ours is simpler

- cargo takes plug-in commands. Ours has a fixed
  list.
- rustc keeps error text in the compiler. Ours
  is in the skill, so the writer and the tool
  read the same words.
- ESLint lets an app switch a rule off in a
  line. A gate is on where the app's config
  places it; an exception is a counted gap row
  (ADR 0145).

## Proof

All in a scratch copy of tinker-app df38f3d.
Nothing is in a repo yet.

- **Kind gate.** A new kind `locked` in the
  contract: `tsc` gives TS7030, lint gives
  `Cases not matched: "locked"`. A read of
  `out.version` in case `gone`: TS2339.
- **Cast gate.** 10 findings on the old board
  page, 0 on the new one. `tsc`, lint and
  `tinker-analyze` clean; browser tests 10 of
  10; server tests 162 pass.
- **Base config.** The same errors arrive
  through an import and an `extends`. With
  `src/**`, tests and `tinker/` are not flagged.
- **One output.** A stand-in ran the three tools
  and printed the format of decision 4, for a
  new kind, a wrong read, a cast, and a clean
  tree.
- **What the gates find today:** template `src/`
  1, `tinker/` 34, tests 57; Hedl `src/` 62.

Files: project files `sure-right/`.

## Not decided

- **A plain type error has no fix text.** For
  example TS2322. It needs a map from common
  TS codes to skill sections.
- **A page that never reads the answer.** The
  kind gate works where a `switch` is. Rust has
  `#[must_use]`; we have no such rule.
- **Which harness runs the check.** A hook per
  agent tool is not chosen.
- **`complexity` max 8** allows a `switch` of
  about 6 kinds. A call with more needs a rule
  for it.
- **Hedl.** Its api does not answer by `kind`.
  The cast gate fits it today; the kind gate
  does not.
- **More commands.** `tinker shape`, `tinker
explore`, `tinker new` are ideas only.
- **Files outside the tsconfig.** `tsc` checks
  only the files its `include` names. The rules
  read `src/`, `cmds/` and `tinker/`. A file the
  tsconfig leaves out gets rules but no types.
- **Which files the gates cover.** The check
  asks only that each gate is at error in some
  part of the lint config. An override can turn
  a gate off for some files, as the site does
  for its bench. The check does not compare
  those files with the files the rules read.
- **The proof of the goal.** "A cheap model
  writes golden code with this loop" is not
  measured. The CUJ eval measures it.
