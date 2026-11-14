---
name: data
description: >
  Use when you add or change state in a Tinker
  app: a data cell, a keyed cell with members,
  a read of one member or one part, or where a
  write lands (session, namespace, scope). Also
  when a check prints tinker/cell-write.
metadata:
  purpose: >
    How to declare a cell, read it, write it
    through a controller, and keep an exported
    cell read only.
  type: sub-skill
  library: '@tinkered/core'
  library_version: '0.23.0'
requires:
  - core
sources:
  - 'lagz0ne/tinkered:packages/core/src/main.ts'
  - 'lagz0ne/tinkered:packages/core/README.md'
---

# Data

A cell holds one value. A keyed cell holds members
under keys. A write wakes only the readers of what
changed.

## Setup

```ts
import { createScope, data, operation } from "@tinkered/core";

const theme = data({ label: "theme", initial: "light" });

const flip = operation({
  label: "theme.flip",
  depends: { theme: theme.controller },
  run: ({ theme }) => {
    theme.update((t) => (t === "light" ? "dark" : "light"));
    return theme.get();
  },
});

const show = operation({
  label: "theme.show",
  depends: { theme },
  run: ({ theme }) => `theme is ${theme}`,
});

const scope = createScope();
await scope.run(flip);
```

- `depends: { theme }` gives the value.
- `depends: { theme: theme.controller }` gives
  `get`, `set`, `update` and `watch`.

## Core patterns

### Keep members under keys

```ts
import { data, operation } from "@tinkered/core";
import { z } from "zod";

const wave = z.object({
  room: z.string(),
  id: z.string(),
  hue: z.number(),
});

const waves = data({
  label: "sea.waves",
  mode: "keyed",
  parse: wave,
  key: (w) => ({ room: w.room, id: w.id }),
});

const press = operation({
  label: "sea.press",
  input: wave,
  depends: { waves: waves.controller },
  run: ({ waves }, { input }) => {
    waves.set(input);
    const { room, id } = input;
    waves.update({ room, id }, (w) => ({ ...w, hue: 1 }));
    const one = waves.of({ room, id }).get();
    const here = waves.where({ room }).get();
    waves.delete({ room, id });
    return { one, count: here.length };
  },
});
```

- `set(member)` adds or replaces one member.
- `of(key)` reads one member.
- `where(part)` reads the members whose key
  holds those fields.
- `where(part, window)` names a window, such as
  `{ order: "-created", limit: 50 }`. The board's
  `load` gets the part and the window, and the
  store sorts and cuts. Core does not sort, so a
  window needs `remoteData` with a `load`.
- A write to one member wakes the readers of that
  member and of its parts. No other reader runs.

### Compute a value from sources

A `derived` computes a value from cells, reads,
capsule exports, and resources. Its `config` is
its key, as a capsule's config is. Every reader
of the same config shares one entry.

```ts
import { data, derived, tag } from "@tinkered/core";

const waves = data({
  label: "sea.waves",
  mode: "keyed",
  key: (w: { room: string; id: string }) => w,
});

const room = tag<string>({ label: "sea.room" });

const count = derived({
  label: "sea.count",
  config: { room: room.required },
  depends: (c) => ({
    here: waves.where({ room: c.room }),
  }),
  factory: ({ here }) => here.get().length,
});

const read = count({ room: "a" });
```

- The call is the read: `scope.resolve(read)`
  gives a reader. React reads it with `useData`.
- It computes again only when a source changed.
- A config value is a string, a number, or a
  slot: a cell, a read, a capsule export, a
  resource, or an operation.
- An operation in a slot is a caller. It runs
  only when the factory calls it. It must not
  write a cell: that raises `WriteInDerived`.
- With no required key, the bare unit reads too.
- The last reader leaves, and the entry goes.

### Say where a write lands

A write from a session stays in that session. The
edge says when it must go up.

```ts
import { data, operation } from "@tinkered/core";

const token = data<string | null>({
  label: "auth.token",
  initial: null,
});

const save = operation({
  label: "auth.save",
  depends: {
    own: token.controller,
    ns: token.atNamespace.controller,
    all: token.atScope.controller,
  },
  run: ({ own, ns, all }) => {
    own.set("this call only");
    ns.set("the caller's namespace");
    all.set("the whole scope");
  },
});
```

## Common mistakes

### HIGH: a write through a capsule export [tinker/cell-write]

A cell that a capsule exports is read only. The
feature's own operations write it. Others call
those operations.

```ts expect-error
import { capsule, data, operation } from "@tinkered/core";

const waves = data<number[]>({
  label: "sea.waves",
  initial: [],
});
const sea = capsule({ label: "sea", exports: { waves } });

const sneak = operation({
  label: "other.sneak",
  depends: { waves: sea.waves.controller },
  run: ({ waves }) => waves.set([]),
});
```

Right: export an operation that does the write.
Read the cell with `depends: { w: sea.waves }`.

Check: the lint rule `tinker/cell-write`, and the
error `InvalidDependency` when the scope builds.

### HIGH: a mutation in place

`update` must return a new value. A cell compares
by identity, so a changed old value wakes nobody.

Wrong:

```ts no-check
list.update((items) => {
  items.push(next);
  return items;
});
```

Right: `list.update((items) => [...items, next])`.

### MEDIUM: one big cell for a list

A reader of a single cell wakes on each change.
For rows that change one at a time, use
`mode: "keyed"` and read with `of` or `where`.

## Completion

- The lint prints no `tinker/cell-write`.
- A test writes through an operation and reads
  the cell after. Read
  [testing](../testing/SKILL.md).
