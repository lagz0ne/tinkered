# @tinkered/analyze

The checks for a Tinker app (ADR 0129, ADR 0143).
One command reads the app's files.
It prints each broken rule with its rule id.
Then it names the skill to read.
It runs no app code.

## Install

```bash
bun add -d @tinkered/analyze
```

Each release also attaches tarballs to its
GitHub release; the
[changelog](../../CHANGELOG.md) lists them.

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

- `gaps`: the path of a gaps doc. A finding
  is allowed when the line above it is
  `// tinker-gap: G3` and row `G3` is open.
  See below.
- `plain.entries`: functions that stay plain, by
  file and name. An entry runs before a scope
  exists, so it cannot be an operation.
- `page.files`: where the page's files are.
  Default: `src/**`.
- `page.skip`: globs to leave out of the page.

## Gaps: a finding you cannot fix yet

A gap is a finding that waits on a Tinker
change. Mark it, and give it a row in the
gaps doc.

```ts
// tinker-gap: G3
const answer = await fetch("/api/auth");
```

```md
## G3: the auth library's own HTTP

- Status: open
- Lines: 5
```

- The marker is on the line directly above.
- The row must be open.
- A row allows at most `Lines` marked lines,
  so the count can only go down.
- A marker with no finding below it breaks
  `tinker/gap`.

Each run prints the counts:
`gaps: G1 3/3, G3 5/5`.

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
