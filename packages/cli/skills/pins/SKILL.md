---
name: pins
description: >
  Use when you read what `tinker pins` printed:
  a live swap, empty, drop or fail mutant, its
  reached-by line, or the last count line.
metadata:
  purpose: >
    How to read `tinker pins`: each live mutant
    is a graph fact that no test pins.
  type: core
  library: '@tinkered/cli'
  library_version: '0.35.0'
requires:
  - '@tinkered/core#core/testing'
sources:
  - 'lagz0ne/tinkered:packages/cli/src/pins.ts'
  - 'lagz0ne/tinkered:packages/cli/README.md'
---

# Pins

`tinker pins` breaks one graph fact at a time and
runs the tests that reached it (ADR 0173). A
mutant is that fault. A test pins the fact when
it fails with the mutant in.

It gives facts. It never fails a build.

## Read a line

```text
src/signup/index.server.ts:7
signup.join drop signup.members lives
  reached by: tests/signup.test.ts
```

The real output has the first two parts on one
line:

- `src/signup/index.server.ts:7`: the op's
  `operation({…})` call.
- `signup.join`: the op's label.
- `drop`: the mutant kind.
- `signup.members`: the fact.
- `reached by`: the test files that ran with
  the mutant in, and stayed green.

The last line counts the run:

```text
pins: 16 mutants, 7 live, 2 test files,
  0 not traced
```

`not traced`: the test files whose trace has no
line. A `not traced:` line names them, above
the count. `--json` lists them in `untraced`.

## The kinds and their facts

- `swap sent->idle`: where the op answered
  `sent`, it answered `idle`.
- `empty sent`: the `sent` answer kept its
  `kind`, and each other field went empty.
- `drop signup.members`: the op's write of that
  cell was lost.
- `fail mail.send`: the op's call of that op
  threw.

## Judge a live mutant

A live mutant is one of two things:

- **Dead API.** No caller reads the fact. Remove
  the exit, the field, the write or the call.
- **A missing check.** A caller needs the fact,
  and no test says so. Add the check.

You judge which. `tinker pins` does not.

```ts no-check
// sendOne answers idle | sent | failed.
// The pump never reads it: 6 swaps live.
await sendOne.run();
```

To pin the answers, a test reads them:

```ts no-check
const out = await scope.run(sendOne);
expect(out).toEqual({ kind: "idle" });
```

To pin a write, a test reads the cell:

```ts no-check
const members = scope.resolve(signup.members);
expect(members.get()).toEqual([member]);
```

## Run it

```bash
tinker pins
tinker pins --since origin/main
tinker pins --json
```

- `tinker.json` names the `tests` command.
- Each test scope lists the `exits` capsule
  first. A scope with no `exits` traces nothing,
  and its facts get no mutant.
- A live mutant may still be checked by a file
  that is not traced. Add `exits` to its scopes.
- `--since` keeps the ops whose lines changed,
  and the ops in files git does not track yet.
- Exit 1 means it could not run: no `tests`
  command, or a test file red with no mutant in.
