---
name: core
description: >
  Use when you write or change app logic with
  @tinkered/core: an operation, a data cell, a
  resource, a capsule, rpc, remote data, or a
  test of them. Start here, then load one task
  skill.
metadata:
  purpose: >
    Entry skill for Tinker Core. It names the
    units, the rules with their checks, and the
    task skill to load next.
  type: core
  library: '@tinkered/core'
  library_version: '0.18.0'
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
- A feature's one door, config, install:
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
- `tinker/one-door`: reach a feature as
  `@/<feature>`. Check: lint. Skill: capsule.
- `tinker/cell-write`: an exported cell is read
  only. Check: lint and `InvalidDependency`.
  Skill: data.
- `tinker/plain`: every named function is an
  operation. Check: `bun run check:plain`.
  Skill: operation.
- `tinker/floating`: a root answers each call
  with a promise; await it. Check: lint
  `no-floating-promises`. Skill: operation.

The page rules (`tinker/react-state`,
`tinker/one-wire`) are in the `@tinkered/react`
skill.

## Completion

1. Run the app's `bun run check`.
2. Run `bun run check:plain`.
3. For each id a check prints, load its skill.

A typecheck alone does not prove the rules.
