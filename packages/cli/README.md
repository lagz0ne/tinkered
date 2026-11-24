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
tinker graph [root] [--write]
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
3. **graph:** the graph of the code must match
   `tinker.graph`, and keep each graph rule.

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

## The graph

`tinker graph` prints the app's graph. It has one
line per operation (ADR 0161), then one per view
(see View lines). An op line holds facts:

- `exits`: each way out, as the exit stage names
  them;
- `reads`: each cell read, and how;
- `writes`: each cell write, and how;
- `calls`: each operation it runs;
- `uses`: each resource its `depends` names.

```text
issue.move.do exits{gone,moved,stale}
  reads{issues.list.of} writes{issues.list.set}
  calls{issues.inTeam} uses{}
members.invite exits{already,invited}
  reads{} writes{} calls{} uses{drizzlePg.tx}
```

- A name is the label, never a local name.
- The sets hold all the code of `run`, callbacks
  too. They do not say which exit a write is on.
- A dep written in place, in a `const`, or spread
  from one reads the same.
- A dep taken apart in the body,
  `const { list } = deps`, reads the same as one
  taken apart in the parameters.
- A bare cell dep, `all: issues`, gives `run` its
  value: that reads `issues.list.get` each run.
- A member of an rpc contract that a capsule
  exports is named: the capsule's label, `.`,
  the export's key, `/`, the contract's key.
  `access.user["users.me"]` gives
  `calls{access.user/users.me}`. The key may be
  a name too: `access.user.list`.
- The `/` marks a contract member: the capsule
  path, then the contract key.
- A member is named only when the capsule's
  `label` is a string and its `exports` object
  is written in the `capsule` call.
- An `atScope` or `atNamespace` controller reads
  and writes as the cell's `controller` does.
- `uses` comes from `depends` alone, never from
  `run`. It names a resource by its own label
  when the dep is the `const` that holds the
  `resource(…)` call (`tx`), a keyed read of it
  (`row({ id })`), or a capsule's export of it
  (`db.pool`).
- The graph reads `src` and `cmds` only.

The graph is facts only. It never judges them.
The reader judges: a person or an LLM reads the
line and its diff, and asks if the change is
meant.

An empty set means "none". A `?` in a set means
"the graph could not see here": it never guesses.
A set gets `?` when the code can touch a dep in a
way the graph cannot follow:

- a dep handed on: passed to a function, put in
  an array or an object, or given another name;
- the deps handed on whole, a rest
  `{ a, ...others }` taken from them, or a key
  the graph cannot read, such as `{ [key]: x }`;
- a call on a dep the graph does not know, such
  as `list.watch(…)`;
- a dep the graph cannot name: a member of a
  bare `rpc` const (`seaApi["clock.now"]`), a
  member through a capsule whose `label` or
  `exports` object is not written in the call,
  a member under a key not written in the code,
  a member under a key not in the contract,
  such as the handle's own `answer` op, any
  other capsule export, or a cell whose label
  is not written as a string;
- a tag dep that holds a unit (ADR 0151), through
  any edge: an operation gives `calls{?}`; a
  cell, a view or a read gives `reads{?}`, and a
  cell `writes{?}` too;
- a `run` passed by name, not written in place.
  With a dep the graph cannot name, every set
  gets `?`.

The `?` goes in each set that dep can touch: a
cell in `reads` and `writes`, a read in `reads`,
an operation in `calls`. For a dep the graph
cannot name, its type in `run` says which.

A tag that holds a union of unit kinds, or a held
cell that `run` never uses, may show no `?`.

Any other resource dep gives `uses{?}`. Some
examples:

- a `const` that holds another `const`;
- a member of a namespace import;
- a label not written as a string;
- a key not written in the code;
- a tag that holds the resource.

A cell, an operation, or a capsule dep is no
resource. It adds nothing to `uses{}`.

The graph reads each op's own body. A resource's
own code is not read: a write inside a
resource's value does not show.

### View lines

After the op lines comes one line per view: a
top-level declaration whose code calls
`useData` or `useRun` from `@tinkered/react`.
The lines are sorted by name.

```text
view src/home/home.tsx#SignIn
  reads{home.signInStep.get}
  runs{home.askAgain,home.askForCode}
```

- The name is the file from the app root, `#`,
  and the declaration's name. A `const` keeps
  its name through `memo(…)`. A default export
  with no name is `default`.
- A function nested in another counts for the
  top-level one. So do callbacks.
- `reads`: each `useData` first argument, in
  the words of an op line: a cell `label.get`,
  a part `label.where` or `label.of`.
- `runs`: each `useRun` first argument: an op
  label, or a contract member
  (`access.user/users.me`).
- A first argument the graph cannot name gives
  `?`: a capsule's cell export, a variable, a
  keyed resource.
- The hooks are found by their import. An alias,
  `useData as read`, counts. A local function
  named `useData` does not.
- A view line holds no writes. `useController`,
  `useResource` and the `set` of
  `useData(…, { writable: true })` are not read.
- It does not say which case of a cell's `kind`
  runs which op.
- No graph rule reads a view line.

`tinker graph --write` writes the graph to
`tinker.graph`. Commit that file. Then the check
builds the graph again and compares. Each line
that differs is a finding at the operation or
the view:

```text
src/issues/ops.server.ts:80 tinker/graph
issue.move.do: writes{issues.list.set},
tinker.graph says writes{}
```

- Meant the change? Run `--write` again. The
  reviewer reads the diff of the file.
- Did not mean it? Fix the code.
- No `tinker.graph` is one finding, when the app
  has an operation or a view.
- A `tinker.graph` written before `uses{}` gives
  a finding on each line. Run `--write` once.

### Graph rules

A graph rule says: each op that writes these
cells, or uses these resources, must call this
op (ADR 0167). Write it in `tinker.json`:

```json
{ "graph": { "rules": [
  { "writes": "issues.list",
    "calls": "issues.canWrite" },
  { "writes": "issues.members",
    "calls": "issues.canWrite",
    "except": {
      "team.create.do": "No team yet."
    } },
  { "writes": "issues.archived",
    "calls": "issues.canWrite" },
  { "uses": "drizzlePg.tx",
    "calls": "perm.canLead",
    "except": {
      "workspace.create.do": "No lead yet."
    } }
] } }
```

- `writes`: a cell pattern. A pattern names a
  cell, never a method: `issues.list` holds
  `issues.list.set` and `issues.list.delete`.
- `uses`: a resource pattern, in place of
  `writes`. It matches the whole label. A server
  op that keeps its rows in a database writes
  through a resource, so its `writes{}` is empty.
- A rule has `writes` or `uses`, never both.
- `*` stands for one label part or more:
  `issues.*` holds `issues.archived`, not
  `issues`.
- A `*` pattern holds every cell under it, the
  page's own cells too. `issues.*` holds
  `issues.me`, which `issues.signIn` writes in
  the page: a finding. Name the server cells, as
  above, or put the page op in `except` with its
  reason.
- `calls`: the op each writer must reach in its
  `calls{}`, directly or through the ops it
  calls.
- An op the graph has no line for, such as an
  rpc member, ends the way: the graph does not
  follow the call to the server.
- The rule's own op is exempt.
- `except`: an op, with its reason. That op is
  no finding.

The graph stage tests each rule on the code's
graph. Each op that breaks one is a finding:

```text
src/issues/ops.server.ts:88 tinker/graph-rule
team.archive.do writes{issues.archived.set},
calls has no issues.canWrite
```

A `uses` rule says the same with its part:

```text
src/members/ops.server.ts:12 tinker/graph-rule
members.invite uses{drizzlePg.tx},
calls has no perm.canLead
```

A `?` in `calls{}` of the op, or of an op on the
way, is a finding too. The rule cannot be
proved:

```text
src/issues/ops.server.ts:88 tinker/graph-rule
team.archive.do writes{issues.archived.set},
calls{?} in team.archive.do cannot prove
issues.canWrite
```

A write or a resource the graph marks `?` is not
tested: it is not known. No rule, no finding: the
check finds no copy by itself.

## The tests and the exits

An exit is one way out of an operation: each
`kind` of its answer, a refusal, or a plain
return (ADR 0159). A test must reach each one.

Name the test command in `tinker.json`:

```json
{ "tests": "bun run test" }
```

Then the check runs two more stages:

4. **tests:** the command. Red tests print the
   end of their output.
5. **exits:** each exit that the types declare
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
- `tinker/barrel` — a file in `src/` or `cmds/`
  exports only what it declares. A re-export is
  a finding: `export … from "…"`, of values or
  types, or `export { name }` of an imported
  name (ADR 0160).
- `tinker/link` — a page has no plain `<a>` to
  a path in the app: `/issues`, `./next`. A
  click loads the whole page, so the app state
  is lost. Use the router's `Link`.
  A server path, such as `/auth/login`: add `rel="external"`.
  A link to another site or to a file, `#top`,
  a download, a new tab, or what the rule
  cannot read passes.

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
- `graph.rules`: see Graph rules above.

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

## The page guard

A page build can take server code by accident,
through an import or a re-export. `pageGuard()`
stops it (ADR 0160).

```ts
import { pageGuard } from "@tinkered/cli/vite";

export default defineConfig({
  plugins: [pageGuard()],
});
```

It runs only where the page is built: in dev, in
the build, and in browser tests. It refuses an
import of:

- a file with a `.server.` part in its name;
- a `node:` or `bun:` name;
- `@tinkered/entry`, or one of its entries;
- `@tinkered/bun`, but not `@tinkered/bun/client`.

The build error names the import and its file:

```text
page imports server code "./db.server"
from src/todo/barrel.ts
```

An `import type` is gone before the build reads
imports. So a page may take types from a server
file.

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
