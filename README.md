# Tinker

Tinker is a small set of libraries for apps that
you and an AI agent write together.

- **App logic** is capsules. Each one holds its
  operations and data cells, and exports what
  others may use (`@tinkered/core`).
- **The page** reads those cells
  (`@tinkered/react`).
- **The server** runs on Bun (`@tinkered/bun`).
- **The check** runs your types and rules, and
  prints the fix for each finding
  (`@tinkered/cli`, the `tinker` command).

Each package ships its own skills: the rules for
its code, for the version you installed.

## How it fits

```text
you or your agent write code
   |
tinker check
   |  types first, then rules
   |  each finding prints its fix
fix, then check again
   |
tinker check: OK
```

One turn of the loop, step by step:

1. **Write.** You or the agent add a function.
2. **Check.** `tinker check` runs the app's
   `tsc` and lint, then Tinker's rules. Only the
   first stage that fails prints.
3. **Read.** Each finding is `file:line rule
what`, then its fix from the skill.
4. **Load more.** `tinker skill load <skill>`
   prints the whole skill, from the package
   version you have.
5. **Fix.** Check again. Only
   `tinker check: OK` says the work is done.

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
bunx tinker check    # types, then rules
bun run check:style  # format and lint
bun run check        # types, tests, build
```

## Add Tinker to an app you have

### 1. Install the packages

```bash
bun add @tinkered/core @tinkered/react
bun add -d @tinkered/cli
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
bunx tinker skill list
```

### 3. Turn on the check

Extend the base config, and place the gates:

```json
{ "extends": "@tinkered/cli/tsconfig.json" }
```

```ts
import { gates } from "@tinkered/cli/config";

lint: {
  overrides: [{ files: ["src/**"], rules: gates }],
},
```

```json
"scripts": {
  "check:tinker": "bun --bun tinker check"
}
```

A finding is one line, then its fix:

```text
src/add.ts:1 tinker/plain a plain function
  Right: make it an operation and name it in
  `depends`, as `double` above.
  more: tinker skill load @tinkered/core#core/operation

tinker check: rules failed.
Next: fix each finding, then run `tinker check`
again.
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
- **A React component:** a capitalized function
  in a `.tsx` file that returns JSX.
- **An entry:** each function the app lists in
  `tinker.json` with a reason, such as
  shadcn's `cn`.

A function that passes is not called by name.
Only a closure may be: a function that reads a
name of a function around it. A pure function in
`useCallback`, called as `add(1, 2)`, is a
finding (ADR 0149).

Workflow SDK flows are next: in a `*.flow.ts`
file, a function that starts with
`"use workflow"` or `"use step"` passes
([PR #36](https://github.com/lagz0ne/tinkered/pull/36),
ADR 0148, not merged yet).

Exit `0` is done, `1` has findings, `2` is a
bad call, config or tool. So CI can gate on it.

An exception goes in `tinker.json`, with its
reason as text. A finding that waits on a
Tinker change gets a gap marker. Both are in the
[cli README](packages/cli/README.md).

### 4. Add the lint rules (optional)

The same package has an Oxlint plugin. It checks
where a cell write may go, and how a body reads
as steps.

```ts
jsPlugins: [
  {
    name: "tinker",
    specifier: "@tinkered/cli/lint",
  },
],
```

The rule list is in the
[cli README](packages/cli/README.md#lint-rules).

## Build with capsules

An app is capsules. You build capsules, and you
use other capsules. That is all.

- **A capsule** is one feature: its config, its
  units, its hooks, and what it exports.
- **Its units** (operations, data cells,
  resources, tags) are private. Only its
  `exports` are seen from outside.
- **A cmd** installs capsules, with values, in
  `createScope({ capsules })`. Nothing else
  configures them.

The same idea as a Terraform module: inputs
(`config`), outputs (`exports`), and one root
that calls them.

### 1. Build one

```ts
// src/counter/index.ts
import {
  capsule,
  data,
  operation,
  tag,
} from "@tinkered/core";

const step = tag<number>({ label: "counter.step" });
const count = data({
  label: "counter.count",
  initial: 0,
});

const add = operation({
  label: "counter.add",
  depends: { step, count: count.controller },
  run: ({ step, count }) => {
    count.update((n) => n + step);
    return count.get();
  },
});

export const counter = capsule({
  label: "counter",
  config: { step: step.required },
  exports: { count, add },
});
```

- `step` is config: the cmd must fill it.
- `count` goes out as a read view: others can
  `get()` and `watch()`, not `set()`.
- `add` goes out as an operation: the only way
  to change `count` from outside.

### 2. Use another capsule

A capsule that needs another one's work takes it
in a slot: a config key that holds a unit.

```ts
// src/score/index.ts
import type { Operation } from "@tinkered/core";

const bump = tag<Operation.Handle<number, void>>({
  label: "score.bump",
});

const goal = operation({
  label: "score.goal",
  depends: { bump },
  run: ({ bump }) => bump.run(),
});

export const score = capsule({
  label: "score",
  config: { bump: bump.required },
  exports: { goal },
});
```

`score` does not import `counter`. The cmd
decides what fills `bump`.

### 3. Install them in the cmd

```ts
// cmds/main.ts
const scope = createScope({
  capsules: [
    counter({ step: 2 }),
    score({ bump: counter.add }),
  ],
});
await scope.ready;

await scope.run(score.goal); // 2
scope.resolve(counter.count).get(); // 2
await scope.close();
```

A missing key is a type error, and
`MissingConfig` at start.

### 4. See what runs

A capsule is easy to trace, from start on:

- `scope.capsules` lists each install: its
  config, its exports, and each unit its hooks
  loaded, with a `role` and an `explain`.
- Each span of an exported unit carries
  `attributes.capsule`.
- `tinker.graph` has a line per operation and
  per hook, by capsule label.

```ts
scope.capsules[1];
// { label: "score",
//   config: { bump: "counter.add" },
//   exports: ["goal"], ... }
```

### 5. Export more than units

A capsule may export a plain value too, such as
a React component (a foreign export, ADR 0125):

```tsx
export const counter = capsule({
  label: "counter",
  config: { step: step.required },
  exports: { count, add, Badge },
});

// <counter.Badge />
```

### 6. Install one capsule twice

Two installs, each with its own config and its
own state (ADR 0172):

```ts
const mailPace = throttler({ gapMs: 100 });
const slackPace = throttler({ gapMs: 1000 });

capsules: [
  mailPace,
  slackPace,
  smtpMail({ throttle: mailPace.runner }),
  slackPost({ throttle: slackPace.runner }),
];
```

Not built yet: [#73](https://github.com/lagz0ne/tinkered/issues/73).
Today a second install raises `DuplicateCapsule`.

Next: `bunx tinker skill load @tinkered/core#core/capsule`.

## Upgrade

```bash
bun update --latest '@tinkered/*'
```

Then run `bunx tinker check`.
The skills move with the code. What changed is
in the [changelog](CHANGELOG.md).

## The packages

- [`@tinkered/core`](packages/core/README.md):
  scope, operations, data cells, keyed resources,
  capsules, rpc, remote data.
- [`@tinkered/react`](packages/react/README.md):
  hooks that read cells and run operations.
- [`@tinkered/bun`](packages/bun/README.md):
  the server, the socket, and Bun's SQL drivers.
- [`@tinkered/cli`](packages/cli/README.md):
  `tinker check`, `tinker skill`, the gates and
  the lint plugin.

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
