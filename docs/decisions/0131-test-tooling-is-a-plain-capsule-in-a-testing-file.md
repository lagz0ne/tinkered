# 0131 Test tooling is a plain capsule in a `.testing.ts` file

Date: 2026-11-09. Status: accepted.
Accepted: Duke, 2026-11-09 22:44 UTC: "Yeah, drop the
testCapsule. As long as the treeshaking works, we are good".
Retires: ADR 0127 decision 5 (`testCapsule`).
Its other decisions hold.

## What the user said

- 22:19: "Capsule should have the space on its own, so if
  there are two sockets, that literally mean 2 capsules".
- 22:44: drop `testCapsule`, if tree-shaking works.
- 22:45: "Just don't wrap creation, thats an anti pattern".

## Context

`testCapsule(of, def)` was one line:
`capsule({ ...def, label: of.label + ".testing" })`.

- No app used it. The template and Hedl test with
  `preset`, `makeTestClock` and `memory`.
- The prod guard was never the function.
  tinker-app `scripts/check-no-tests.ts` refuses any
  `*.testing.ts` file in a prod bundle.
- So the function added only a label.

## Precedent

- **Go `_test.go`.** The file name marks test code.
  The build leaves it out.
- **Angular `HttpClientTestingModule`.** A plain module
  that only tests import.

## Decision

1. Test tooling is a plain `capsule()`, declared once at
   module level, in a `*.testing.ts` file.
2. Its label is `<capsule>.testing`, by hand.
3. Only test files import it.
4. An app's build check refuses a `*.testing.ts` file in
   a prod bundle. The template's `check-no-tests.ts` does.
5. `testCapsule` leaves `@tinker/core/testing`.

## Proof

A tinker-app copy, 2026-11-09:

- `greet.testing.ts`, imported by a test only:
  the test passes; the build says
  "prod builds clean".
- The same file, imported by `cmds/server.ts`:
  "test code in dist/meta.json:
  src/backend/greet.testing.ts"; the build exits 1.

## Consequences

- One Core name less.
- A breaking change for an app that imports `testCapsule`.
  None does.
