# @tinkered/cli

The `tinker` command (ADR 0156).
It is made for an agent that writes the code.
`tinker check` runs every fast gate.
Each finding prints its fix.
The fix text comes from the skill.

## Install

```bash
bun add -d @tinkered/cli
```

Each release also attaches tarballs to its
GitHub release; the
[changelog](../../CHANGELOG.md) lists them.

## Commands

```text
tinker check [root] [--json]
tinker skill list
tinker skill load <skill>
```

Where only Bun may run, call it with `--bun`:

```bash
bun --bun tinker check
```

## The check loop

`tinker check` runs these stages in order.

1. **types:** the app's `tsc`, the kind gate and
   the cast gate.
2. **rules:** Tinker's rules, then the app's
   other lint.

- Only the first stage that fails prints.
- At most 5 findings print.
- One fault prints once.
- A finding is one line, then its fix.
- The last line is the next step.

```text
src/a.tsx:64 tinker/kind kind "locked" has no case
  Right: a `switch` on `kind`, with a case for
  each kind the check names. Do not add
  `default:`. Do not cast.
  more: tinker skill load @tinkered/react#react

tinker check: types failed.
Next: fix each finding, then run `tinker check`
again. The rules stage runs once types pass.
```

Only this says the work is done:

```text
ran: tsc, lint, rules (66 files)
tinker check: OK
```

`--json` prints the same report as data:
`kind` is `ok` or `failed`.

Exit codes:

- `0`: done.
- `1`: one finding or more.
- `2`: a wrong call, a config it cannot read, a
  tool it cannot run, or a tool with no config.

The check has no lint or type config of its own.
It runs the app's own tools:

- `tsc --noEmit`, when the app has a
  `tsconfig.json`;
- `vp lint`, when the app has a `vite.config`.

A tool with no config is skipped, and the
`skipped:` line says so. Then the answer is
`tinker check: not done`, with exit 2: only a
run of every stage can say OK.

## The tests and the exits

An exit is one way out of an operation: each
`kind` of its answer, a refusal, or a plain
return (ADR 0159). A test must reach each one.

Name the test command in `tinker.json`:

```json
{ "tests": "bun run test" }
```

Then the check runs two more stages:

3. **tests:** the command. Red tests print the
   end of their output.
4. **exits:** each exit that the types declare
   and no test reached is a finding.

```text
src/todos.server.ts:41 tinker/exit `todo.remove.do`
answers `gone`, and no test reaches it
  Right: a test for each exit the check names.
```

A test scope lists the capsule that writes the
exits. A scope with no `exits` reaches none.

```ts
import { exits } from "@tinkered/cli/test";

const scope = createScope({
  capsules: [
    exits({ file: process.env.TINKER_EXITS }),
  ],
});
```

A page has no file. Its scope passes a store:

```ts
exits({ store: localStorage });
```

- The exits go to the key `tinker.exits`, as
  counts by `label<tab>exit`. One write for
  each burst; a run does not wait for it.
- A setup file of the browser tests leaves the
  store's text in `.tinker/exits/`:

```ts
afterAll(async () => {
  const exits = localStorage.getItem("tinker.exits");
  if (!exits) return;
  const name = crypto.randomUUID();
  await commands.writeFile(
    `.tinker/exits/${name}.json`,
    exits,
  );
});
```

- The check empties `.tinker/exits/` before the
  tests. Put `.tinker/` in `.gitignore`.
- The check sets `TINKER_EXITS` for the command.
  In a plain test run it is not set, and the
  capsule writes nothing.
- The check reads the label of an operation as
  a literal, and the return type of its `run`.
- A thrown error is not an exit.

## Where the fix comes from

A skill has a section per mistake. Its heading
holds the rule id:

```md
### HIGH: a cast [tinker/cast]

Right: narrow or parse. Do not cast:
```

The check prints the `Right:` part of that
section. It reads the skills the app has
installed, through Intent. So the fix has the
version of the code you have.

A lint rule with no section prints the lint's own
`help:` line.

## The gates

The package exports one base config. The app
extends it, and says where it applies:

```json
{ "extends": "@tinkered/cli/tsconfig.json" }
```

```ts
import { gates } from "@tinkered/cli/config";

lint: {
  overrides: [{ files: ["src/**"], rules: gates }],
},
```

- **The kind gate, `tinker/kind`.** A `switch` on
  a call's answer has a case for each kind, and
  no `default`. `noImplicitReturns` makes `tsc`
  fail on a kind with no case; the lint rule names
  the kind.
- **The cast gate, `tinker/cast`.** No `as` but
  `as const`. No `!`. No `any`.

## Skills

```bash
tinker skill list
tinker skill load @tinkered/react#react
```

`list` names each skill the app has, with when
to load it. `load` prints the skill's text.
Intent finds them (ADR 0143).

## Tinker's rules

- `tinker/plain` — a named function in `src/`,
  `cmds/` or `tinker/` is an operation.
  A function that passes is not called by name,
  and a flow function passes: see below.
- `tinker/one-wire` — a page file calls no
  `fetch`, `WebSocket`, `EventSource`,
  `XMLHttpRequest` or `sendBeacon`.
  The rpc client is the one wire.
- `tinker/react-state` — a page file calls no
  `useState`, `useReducer`, `useEffect` or
  `useLayoutEffect`.
  State lives in a Core cell.
- `tinker/gap` — a gap marker sits on an open
  row: see below.

A page file is a file in `src/` with no `.server`
in its name.

## A call by name

A function passes `tinker/plain` when something
else calls it: Core, a library, React. So app
code does not call it by name (ADR 0149).

```ts
const add = useCallback(
  (a: number, b: number) => a + b,
  [],
);
add(1, 2);
```

```text
src/page.tsx:1 tinker/plain a helper, called
by name at src/page.tsx:5
```

App code may call by name:

- an operation, through the scope;
- a closure: a function that reads a name of a
  function around it, so it holds that unit's
  state;
- an entry in `tinker.json`.

```ts
factory: () => {
  let n = 0;
  const bump = () => ++n;
  return { bump, twice: () => [bump(), bump()] };
},
```

`bump` reads `n`, so it is a closure. It passes.

The check reads syntax only. It does not see a
function that comes through `depends`, or one a
library hands back. Review looks at those.

## Flow files: the Workflow SDK

The [Workflow SDK](https://workflow-sdk.dev) finds
a workflow and a step by a directive. So they
cannot be operations (ADR 0148).

A flow file is a file whose name ends in
`.flow.ts` or `.flow.server.ts`. In it, a
function passes `tinker/plain` when its body
starts with `"use workflow"` or `"use step"`:

```ts
export async function nameFlow() {
  "use workflow";
  return await suggest();
}

async function suggest() {
  "use step";
  return callOperation("naming.suggest");
}
```

- The directive is first in the body. Only other
  directives, such as `"use strict"`, may come
  before it.
- In any other file, the same function fails.
- A helper in a flow file still fails.
- Only a flow function calls a flow function by
  name. A call from other code is a finding.
  `start(nameFlow, [...])` is no call by name.
- Name it `.flow.server.ts` to keep it out of the
  page rules.

## The app's own exceptions

`tinker.json`, at the app root.
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

`@tinkered/cli/lint` is an Oxlint plugin.

```ts
jsPlugins: [
  {
    name: "tinker",
    specifier: "@tinkered/cli/lint",
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
import { check } from "@tinkered/cli";

const report = check(process.cwd());
```

`check` runs Tinker's rules only.
`report.findings` holds each finding:
`path`, `line`, `rule`, `what`.
