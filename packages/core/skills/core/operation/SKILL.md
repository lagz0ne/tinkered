---
name: operation
description: >
  Use when you add or change an action in a
  Tinker app: its label, input shape, deps, run
  body, how to call it, or how it fails. Also
  when a check prints tinker/plain or
  tinker/floating, or for a Workflow SDK flow.
metadata:
  purpose: >
    How to write, call and fail an operation,
    and why a plain helper function is not
    allowed in app code.
  type: sub-skill
  library: '@tinkered/core'
  library_version: '0.19.0'
requires:
  - core
sources:
  - 'lagz0ne/tinkered:packages/core/src/main.ts'
---

# Operation

An operation is an action: a label, an input
shape, its deps and a `run`. Each call is a span.

## Setup

```ts
import { createScope, data, operation } from "@tinkered/core";
import { z } from "zod";

const hues = data<number[]>({
  label: "wave.hues",
  initial: [],
});

const press = operation({
  label: "wave.press",
  input: z.object({ x: z.number(), y: z.number() }),
  depends: { hues: hues.controller },
  run: ({ hues }, { input, clock, random }) => {
    const hue = Math.floor(random.next() * 360);
    const at = clock.currentTimeMillis();
    hues.update((list) => [...list, hue]);
    return { hue, at, x: input.x };
  },
});

const scope = createScope();
const { hue } = await scope.run(press, {
  input: { x: 1, y: 2 },
});
```

- `label` is the span's name. Write it as a plain
  string, one per operation.
- `input` checks the raw input at the door. Bad
  input fails with `DataValidationFailed`.
- Take time from `clock` and chance from
  `random`. A test swaps both.

## Core patterns

### Call an operation from an operation

Name it in `depends`. Then call it.

```ts
import { operation } from "@tinkered/core";
import { z } from "zod";

const double = operation({
  label: "math.double",
  input: z.number(),
  run: (_, { input }) => input * 2,
});

const quad = operation({
  label: "math.quad",
  input: z.number(),
  depends: { double },
  run: ({ double }, { input }) => {
    const twice = double.run({ input });
    return double.run({ input: twice });
  },
});
```

A dep that is an operation has `run` and
`settle`, as a scope has.

### Read the result without a throw

```ts
import { createScope, operation } from "@tinkered/core";

const risky = operation({
  label: "risky",
  run: () => 1,
});

const scope = createScope();
const result = await scope.settle(risky);
if (result.status === "success") result.value;
if (result.status === "failed") result.error;
if (result.status === "cancelled") result.reason;
```

- `run` answers the value or throws.
- `settle` answers one of three: `success`,
  `failed` or `cancelled`.

### A durable flow: the Workflow SDK

The [Workflow SDK](https://workflow-sdk.dev) finds
a workflow and a step by a directive, so they are
plain functions. Put them in a flow file: a name
that ends in `.flow.server.ts` (or `.flow.ts`).
There, `tinker/plain` lets them pass (ADR 0148).

```ts no-check
// src/naming/naming.flow.server.ts
export async function nameFlow(idea: string) {
  "use workflow";
  return await suggest(idea);
}

async function suggest(idea: string) {
  "use step";
  return callOperation("naming.suggest", { idea });
}
```

- Keep a flow function thin: it awaits hooks,
  sleeps, and calls operations by name.
- The logic stays in operations. A step cannot
  import a cell: the SDK bundles it on its own.
- A step can run again after a crash. Make each
  step safe to repeat.
- The directive is first in the body. A helper
  beside it in the file still fails.

## Common mistakes

### HIGH: a plain helper function [tinker/plain]

A helper has no span and no deps. A trace cannot
show it, and a tool cannot draw it.

Wrong:

```ts no-check
function nextHue(seed: number) {
  return Math.floor(seed * 360);
}
```

Right: make it an operation and name it in
`depends`, as `double` above.

Check: `bun run check:plain` prints the file and
the line of each plain function.

### HIGH: `name` in place of `label`

```ts expect-error
import { operation } from "@tinkered/core";

const bad = operation({
  name: "wave.press",
  run: () => 1,
});
```

### HIGH: a call that nobody awaits [tinker/floating]

A scope answers each call with a promise. A call
with no `await` loses its error.

Wrong:

```ts no-check
scope.run(press, { input: { x: 1, y: 2 } });
```

Right: `await scope.run(...)`, or keep the
promise and await it later.

### MEDIUM: `Date.now()` or `Math.random()` in a run

The run then gives a new answer in each test. Use
`clock` and `random` from the run's second
argument.

## Completion

- `bun run check:plain` prints no line.
- The lint prints no `no-floating-promises`.
- A test calls the operation through a scope.
  Read [testing](../testing/SKILL.md).
