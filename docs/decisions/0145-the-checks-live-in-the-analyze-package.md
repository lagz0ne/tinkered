# 0145 The checks live in `@tinker/analyze`

Date: 2026-11-12. Status: accepted (Duke, 03:33:
he chose "A. Package @tinker/analyze"); the first
part is built.
Adds to: ADR 0129 (decision 10), ADR 0143
(decision 5).

## What the user said

Duke, 03:08: "we are able to deliver that (skill
and tool for verification)".

## Context

The rule checks were copied files.

- The plain-function check: 700 lines, in the
  template, the site and Hedl. Hedl's copy differs.
- The page rules (no `useState`, no `fetch`): only
  in Hedl. The guide said the template had them.
- The lint rules: one copy here, one in the site,
  one in Hedl.

A finding did not say which rule broke, or what
to read.

The precedent is ESLint: the rules live in one
package, the app holds only its config, and each
finding prints a rule id.

## Decision

1. **One package.** `packages/analyze`, named
   `@tinker/analyze`, as ADR 0129 placed it. It
   ships in the same release as Core.
2. **One command.** `tinker-analyze check [root]`.
   It reads files. It runs no app code.
3. **A finding has a rule id.** One line each:

   ```text
   src/a.ts:1 tinker/plain a plain function
   ```

4. **A broken rule names its skill.** After the
   findings, per rule: the next step, and
   `read: @tinker/core#core/operation`.
   The agent loads it with `intent load`.
5. **Three rules in the command today.**
   `tinker/plain`, `tinker/one-wire`,
   `tinker/react-state`.
6. **The app holds only its exceptions.** In
   `tinker-analyze.json`. Each exception has its
   reason as a value, so no exception is silent.
   - `plain.entries`: a function that runs before
     a scope exists.
   - `page.files`, `page.skip`: where the page is.
7. **A page file** is a file in `src/` with no
   `.server` in its name, unless the config says
   another place.
8. **The lint rules** are `@tinker/analyze/lint`:
   `tinker/cell-write`, `tinker/blank-lines`,
   `tinker/body-steps`. The `cell-write` message
   names its skill.
9. **Exit codes.** 0 clean, 1 a finding, 2 a wrong
   call or a config it cannot read.

## Where ours is simpler

- ESLint loads a config module. Ours is JSON: the
  check runs no app code.
- No rule switches. A rule is on. The config only
  names exceptions.

## Proof

- The site runs the package: `no findings in 79
files`. Its script copy and lint copy are gone.
- On the template, with no config, the command
  prints the 16 entry functions. With the config,
  none.
- A planted case per rule prints its id and its
  skill (`tests/main.test.ts`).

## Added: gap markers

Hedl allowed a page-rule finding with a
`// tinker-gap: G<n>` line, tied to an open row
of a doc. The package now does the same for
any rule, when `tinker-analyze.json` names the
doc in `gaps`. A row allows at most its
`Lines` count, so the count only goes down.
Broken markers break `tinker/gap`.

Proof: on Hedl 295c3b4, the package gives the
same counts as Hedl's script (G1 3/3, G3 5/5,
G5 1/1). It also finds two raw `fetch` calls in
`src/routes.tsx`, outside the folder Hedl's
script reads.

## Not decided

- **SARIF out.** ADR 0129 wants findings in SARIF.
  The command prints text today.
- **`tinker/seam`, `tinker/config`.** They have no
  static check yet.
