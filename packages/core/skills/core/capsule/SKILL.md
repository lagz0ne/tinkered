---
name: capsule
description: >
  Use when you add a feature to a Tinker app,
  give it settings, install it in a cmd, or
  import it from other code. Also when start
  fails with MissingConfig, or a check prints
  tinker/seam, tinker/config or tinker/barrel.
metadata:
  purpose: >
    How to write a capsule, fill its config in
    the cmd, and reach its units through the
    binding only.
  type: sub-skill
  library: '@tinkered/core'
  library_version: '0.34.4'
requires:
  - core
sources:
  - 'lagz0ne/tinkered:packages/core/src/main.ts'
  - 'lagz0ne/tinkered:docs/best-practices.md'
---

# Capsule

A capsule holds a feature's config, its exports
and its hooks. A cmd installs it with values.

## Setup

```ts
import {
  capsule,
  createScope,
  data,
  operation,
  tag,
} from "@tinkered/core";
import { z } from "zod";

// src/sea/index.ts
const size = tag<number>({ label: "sea.size" });

const waves = data<number[]>({
  label: "sea.waves",
  initial: [],
});

const press = operation({
  label: "sea.press",
  input: z.object({ x: z.number() }),
  depends: { size, waves: waves.controller },
  run: ({ size, waves }, { input }) => {
    waves.update((list) => [...list, input.x % size]);
    return waves.get().length;
  },
});

export const sea = capsule({
  label: "sea",
  config: { size: size.required },
  exports: { waves, press },
});

// cmds/server.ts
const app = createScope({
  capsules: [sea({ size: 4 })],
});
const live = await app.ready;
live.run(sea.press, { input: { x: 9 } });
live.resolve(sea.waves).get();
await live.close();
```

- `config` names the keys the feature reads. Each
  key is a tag.
- `exports` names what others may touch: an
  operation to call, a cell to read.
- The cmd calls the capsule with values. That
  call is the install.
- `await app.ready` gives the started scope. Its
  sync calls stay sync.
- `await app.settled` gives the same end as a
  value, never a throw: `success` with `handle`,
  `cancelled` with `reason`, or `failed` with
  `error` (ADR 0165).
- `await live.idle()` waits until the scope's
  in-flight work ends.

## Core patterns

### The cmd is the seam

Only the cmd reads env, files and the host clock.
It turns them into config values.

```ts no-check
// cmds/server.ts
export default defineMain(async ({ env, signal }) => {
  const app = createScope({
    signal,
    capsules: [
      sea({ size: Number(env.SEA_SIZE ?? 4) }),
    ],
  });
  const live = await app.ready;
  return { closed: live.closed };
});
```

- One top-level `createScope`. No wrapper
  function builds it.
- A feature never reads `process.env`.

## Common mistakes

### HIGH: root tags fill a capsule key [tinker/config]

Start fails with `MissingConfig`. A capsule reads
its config from its own call only.

Wrong:

```ts no-check
createScope({
  tags: [size(4)],
  capsules: [sea],
});
```

Right: `capsules: [sea({ size: 4 })]`.

### HIGH: a feature reads env [tinker/seam]

Wrong:

```ts no-check
const press = operation({
  label: "sea.press",
  run: () => Number(process.env.SEA_SIZE),
});
```

Right: declare a `config` key, and let the cmd
pass the value.

### HIGH: a barrel [tinker/barrel]

A barrel passes on what other files export. Its
importer cannot see which files it reaches. One
of them can be a `.server.` file, and then the
page build takes server code.

Wrong:

```ts no-check
export * from "./todo-list";
export type { Todo } from "./todo.schema";
```

Right: delete the re-export. Import the name from
the file that declares it, as
`import { TodoList } from "@/todo/todo-list";`.
A file exports only what it declares.

Check: `tinker check` prints each re-export and
its line.

### MEDIUM: a function that makes units

`createSea()` that returns new units makes a
second graph that no tool can read. Declare each
unit once, at module level. Two installs of one
capsule are two bindings; pass the binding as
config.

## Completion

- The app starts: no `MissingConfig`.
- `tinker check` prints no `tinker/barrel`.
- `grep -rn "process.env" src` prints no line.
