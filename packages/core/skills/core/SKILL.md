---
name: core
description: >
  Use when you write or change app logic with
  @tinkered/core: an operation, a data cell, a
  resource, a capsule, rpc, remote data, or a
  test of them. Start here, then load one task
  skill. Also when a check prints tinker/cast
  or tinker/gap.
metadata:
  purpose: >
    Entry skill for Tinker Core. It names the
    units, the rules with their checks, and the
    task skill to load next.
  type: core
  library: '@tinkered/core'
  library_version: '0.34.10'
sources:
  - 'lagz0ne/tinkered:packages/core/src/main.ts'
  - 'lagz0ne/tinkered:docs/best-practices.md'
---

# Tinker Core

An app is a graph of small units. Core runs the
graph, makes a span for each call, and closes it.

Load one task skill. Load a second one only when
the task crosses two of them.

## Task skills

- An action, its input, its deps:
  [operation](./operation/SKILL.md)
- State, keyed members, where a write lands:
  [data](./data/SKILL.md)
- A feature's capsule, config, install:
  [capsule](./capsule/SKILL.md)
- A call or a live read between server and page:
  [rpc](./rpc/SKILL.md)
- A test of any unit:
  [testing](./testing/SKILL.md)

## Setup

```ts
import { createScope, data, operation } from "@tinkered/core";

const count = data({ label: "count", initial: 0 });

const add = operation({
  label: "count.add",
  depends: { count: count.controller },
  run: ({ count }) => {
    count.update((n) => n + 1);
    return count.get();
  },
});

const scope = createScope();
const total = await scope.run(add);
await scope.close();
```

- A unit is declared once, at module level.
- `depends` names each thing a `run` reads or
  writes. The run gets them as its first argument.
- A scope runs the graph. Close it when done.

## The rules

Each rule has an id and a check. When a check
fails, it prints the id. Read the skill beside the
id, fix the code, and run the check again.

- `tinker/seam`: only a cmd reads env, files or
  the host clock. Skill: capsule.
- `tinker/config`: config goes in the capsule
  call. Check: `MissingConfig` at start.
  Skill: capsule.
- `tinker/barrel`: a file exports only what it
  declares. Check: `tinker check`. Skill:
  capsule.
- `tinker/cell-write`: an exported cell is read
  only. Check: lint and `InvalidDependency`.
  Skill: data.
- `tinker/plain`: every named function is an
  operation. A Workflow SDK workflow or step in a
  `*.flow.ts` file passes. Check:
  `tinker check`. Skill: operation.
- `tinker/floating`: a root answers each call
  with a promise; await it. Check: lint
  `no-floating-promises`. Skill: operation.

- `tinker/cast`: no `as` but `as const`, no `!`,
  no `any`. Check: `tinker check`. Skill: this
  one.
- `tinker/gap`: a gap marker sits on an open row
  of the app's gaps doc. Check: `tinker check`.
  Skill: this one.

The page rules (`tinker/kind`,
`tinker/react-state`, `tinker/one-wire`)
are in the
`@tinkered/react` skill.

## Common mistakes

### HIGH: a cast [tinker/cast]

A cast tells the checker to trust you. Then a
wrong value gets through: `value as never` sends
any string to the server.

Wrong:

```ts no-check
const state = form.get("state") as State;
const issue = data!.issue;
const raw: any = message;
```

Right: narrow or parse. Do not cast:

- a form field: `new FormData(form).get("x")`,
  then `typeof value === "string"`;
- a value of a list: find it in the list,
  `states.find((s) => s === value)`;
- a fault: `api.fault.is(error)`;
- a payload: `schema.safeParse(payload)`;
- a value that can be absent: `if (value)`;
- a cast you cannot remove yet: a gap row and
  its marker, never a `lint-disable` comment.

`as const` is not a cast. It may stay.

### HIGH: a gap marker off its row [tinker/gap]

Wrong:

```ts no-check
// tinker-gap: G9
fetch("/auth");
```

Right: put the marker on the line above the
finding. Name an open row of the gaps doc. Keep
the marked lines within the row's `Lines:` count.
Better: fix the finding and remove the marker.

### HIGH: a gate off by a `lint-disable` comment [tinker/gap]

The comment hides the cast or the missing case
from the check. Nobody counts it.

Wrong:

```ts no-check
// eslint-disable-next-line no-non-null-assertion
const issue = data!.issue;
```

Right: remove the comment and fix the line. When
it cannot be fixed yet, mark it with a gap row:
`// tinker-gap: G<n>` on the line above, and a
row `## G<n>: <why>` in the gaps doc that
`tinker.json` names, with `- Status: open` and
`- Lines: <count>`.

## Completion

1. Run `tinker check`.
2. For each finding, do what its fix says. To
   read more, load the skill it names.
3. Run `tinker check` again.

Only `tinker check: OK` with exit 0 says that the
work is done.
