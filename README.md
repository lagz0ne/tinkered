# Tinker

Tinker is a small set of libraries for apps that
you and an AI agent write together.

- **App logic** is operations and data cells in
  one scope (`@tinkered/core`).
- **The page** reads those cells
  (`@tinkered/react`).
- **The server** runs on Bun (`@tinkered/bun`).
- **The checks** read your code and name the
  skill that fixes each finding
  (`@tinkered/analyze`).

Each package ships its own skills: the rules for
its code, for the version you installed.

## How it fits

```text
you or your agent write code
   |
tinker-analyze check
   |  a finding names a rule and a skill
intent load <skill>
   |  the skill shows the right shape
fix, then check again
```

One turn of the loop, step by step:

1. **Write.** You or the agent add a function.
2. **Check.** `tinker-analyze check` reads the
   files. It runs no app code. Each finding is
   `file:line rule what`.
3. **Read.** After the findings, each broken rule
   prints its next step and a skill name.
4. **Load.** `intent load <skill>` prints that
   skill, from the package version you have.
5. **Fix.** Change the code to the shape the skill
   shows. Check again until it is clean.

The skills come with the package, through
[TanStack Intent](https://tanstack.com/intent)
(ADR 0143). So the advice always matches the code
you have.

## Start a new app

The fastest way in. The
[tinker-app](https://github.com/lagz0ne/tinker-app)
template has the skills, the checks, and the
`AGENTS.md` block set up.

```bash
bunx degit lagz0ne/tinker-app my-app
cd my-app && bun install
bun run dev
```

Before you call a change done:

```bash
bun run check:plain  # Tinker rules
bun run check:style  # format and lint
bun run check        # types, tests, build
```

## Add Tinker to an app you have

### 1. Install the packages

```bash
bun add @tinkered/core @tinkered/react
bun add -d @tinkered/analyze @tanstack/intent
```

Add `@tinkered/bun` for the server half.
All packages share one version.

### 2. Let your agent find the skills

In `package.json`, allow the Tinker skills:

```json
"intent": {
  "skills": ["@tinkered/*"]
}
```

Then write the agent block:

```bash
bunx intent install
```

It writes an `AGENTS.md` block.
The block tells the agent to list the skills and
load the one that fits before it edits code.
For Claude Code, put `@AGENTS.md` in `CLAUDE.md`.

See what you got:

```bash
bunx intent list
```

```text
PACKAGE          VERSION  SKILLS
@tinkered/core   0.19.0   6
@tinkered/react  0.19.0   1
```

### 3. Turn on the checks

```json
"scripts": {
  "check:plain": "bun --bun tinker-analyze check"
}
```

A finding is one line. Then each broken rule
names its next step and its skill:

```text
src/add.ts:1 tinker/plain a plain function

tinker/plain: make it an operation
  read: @tinkered/core#core/operation

1 findings in 1 files
```

Load that skill and fix the code:

```bash
bunx intent load @tinkered/core#core/operation
```

#### What `tinker/plain` asks

Every named function in `src/`, `cmds/` and
`tinker/` is an operation. So each call is a
span in the trace, and what it needs comes
through the scope, not through an import.

Before: a plain function. The check flags it.

```ts
export function add(a: number, b: number) {
  return a + b;
}
```

After: an operation. The check passes it.

```ts
import { operation } from "@tinkered/core";

type Pair = { a: number; b: number };

export const add = operation({
  label: "math.add",
  run: (_deps, { input }: { input: Pair }) =>
    input.a + input.b,
});
```

Call it through a scope:
`await scope.run(add, { input: { a: 1, b: 2 } })`.

These functions pass with no change:

- **Inline:** no name, written where it is used,
  such as a callback or a JSX handler.
- **A body Core calls:** the `run` of an
  `operation`, `resource`, `tag` or `data`, or a
  capsule hook.
- **An option of a library call:** such as a
  handler in `Bun.serve({ ... })`.
- **Owned:** named inside a passing function, and
  returned or handed to a call.
- **A listener:** handed to `addEventListener`.
- **A React component:** a capitalized function
  in a `.tsx` file that returns JSX.
- **Exempt:** `cn`, and each function the app
  lists in `tinker-analyze.json` with a reason.

Workflow SDK flows are next: in a `*.flow.ts`
file, a function that starts with
`"use workflow"` or `"use step"` passes
([PR #36](https://github.com/lagz0ne/tinkered/pull/36),
ADR 0148, not merged yet).

Exit `0` is clean, `1` has findings, `2` is a
bad call or config. So CI can gate on it.

An exception goes in `tinker-analyze.json`, with
its reason as text. A finding that waits on a
Tinker change gets a gap marker. Both are in the
[analyze README](packages/analyze/README.md).

### 4. Add the lint rules (optional)

The same package has an Oxlint plugin. It checks
where a cell write may go, and how a body reads
as steps.

```ts
jsPlugins: [
  {
    name: "tinker",
    specifier: "@tinkered/analyze/lint",
  },
],
```

The rule list is in the
[analyze README](packages/analyze/README.md#lint-rules).

## Your first operation

```ts
import {
  createScope,
  data,
  operation,
} from "@tinkered/core";

const count = data({ label: "count", initial: 0 });

const add = operation({
  label: "count.add",
  depends: { count: count.controller },
  run: ({ count }, { input }: { input: number }) => {
    count.update((n) => n + input);
    return count.get();
  },
});

const scope = createScope();
await scope.run(add, { input: 2 }); // 2
await scope.close();
```

- `data` is a cell: one value.
- `operation` is an action. Its `depends` names
  what it reads or writes.
- The scope owns every cell and every run.
  `close` ends them all.

Next: `bunx intent load @tinkered/core#core`.

## Upgrade

```bash
bun update --latest '@tinkered/*'
```

Then run `bunx intent list` and the checks.
The skills move with the code. What changed is
in the [changelog](CHANGELOG.md).

## The packages

- [`@tinkered/core`](packages/core/README.md):
  scope, operations, data cells, capsules, rpc,
  remote data.
- [`@tinkered/react`](packages/react/README.md):
  hooks that read cells and run operations.
- [`@tinkered/bun`](packages/bun/README.md):
  the server, the socket, and Bun's SQL drivers.
- [`@tinkered/analyze`](packages/analyze/README.md):
  `tinker-analyze check` and the lint plugin.

More to read:

- [Authoring packages and apps](docs/best-practices.md):
  units, owners, and namespace instances.
- [Decisions](docs/decisions/): why each rule
  is what it is.
- [Glossary](docs/glossary.md): the words we use.

## Work on Tinker itself

This repo uses Vite+ (`vp`). The rules for
contributors are in `CLAUDE.md`.

```bash
vp install
vp run -r build   # apps read the built dist
vp run -r test
vp run dev        # the site
```

`vp run ready` runs every gate, mutation too.

Start, the old base and its CLI, was sunset on
2026-11-01 ([ADR 0122](docs/decisions/0122-start-sunset.md)).
Its code is in tag `start-archive`.
