# @tinkered/analyze

The checks for a Tinker app (ADR 0129, ADR 0143).
One command reads the app's files.
It prints each broken rule with its rule id.
Then it names the skill to read.
It runs no app code.

## Install

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.18.1
bun add -d $R/tinker-analyze-0.18.1.tgz
```

## Check an app

```bash
bunx tinker-analyze check
```

A finding is one line: file, line, rule id, and
what is there.
After the findings, each broken rule gives its
next step and its skill.

```text
src/a.ts:1 tinker/plain a plain function

tinker/plain: make it an operation
  read: @tinkered/core#core/operation

1 findings in 12 files
```

Load that skill with Intent:

```bash
bunx intent load @tinkered/core#core/operation
```

The command file starts with a `node` line.
Where only Bun may run, call it with `--bun`:

```bash
bun --bun tinker-analyze check
```

Exit codes:

- `0`: no finding.
- `1`: one finding or more.
- `2`: a wrong call, or a config it cannot read.

## The rules it checks

- `tinker/plain` — a named function in `src/`,
  `cmds/` or `tinker/` is an operation.
- `tinker/one-wire` — a page file calls no
  `fetch`, `WebSocket`, `EventSource`,
  `XMLHttpRequest` or `sendBeacon`.
  The rpc client is the one wire.
- `tinker/react-state` — a page file calls no
  `useState`, `useReducer`, `useEffect` or
  `useLayoutEffect`.
  State lives in a Core cell.

A page file is a file in `src/` with no `.server`
in its name.

## The app's own exceptions

`tinker-analyze.json`, at the app root.
Each exception carries its reason as text.

```json
{
  "plain": {
    "entries": {
      "tinker/base/main-host.ts": {
        "runMain": "Owns the exit code."
      }
    }
  },
  "page": {
    "files": ["src/frontend/**"],
    "skip": {
      "src/bench/**": "Other libraries."
    }
  }
}
```

- `plain.entries`: functions that stay plain, by
  file and name. An entry runs before a scope
  exists, so it cannot be an operation.
- `page.files`: where the page's files are.
  Default: `src/**`.
- `page.skip`: globs to leave out of the page.

## Lint rules

`@tinkered/analyze/lint` is an Oxlint plugin.

```ts
jsPlugins: [
  {
    name: "tinker",
    specifier: "@tinkered/analyze/lint",
  },
],
rules: {
  "tinker/blank-lines": "error",
  "tinker/body-steps": "error",
  "tinker/cell-write": "warn",
},
```

- `tinker/cell-write` — warns on a write to a cell
  that another capsule owns (ADR 0123).
- `tinker/blank-lines`, `tinker/body-steps` — a
  body reads as steps (ADR 0111).

## From code

```ts
import { check } from "@tinkered/analyze";

const report = check(process.cwd());
```

`report.findings` holds each finding:
`path`, `line`, `rule`, `what`.
